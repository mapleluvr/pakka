import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationRef, Runtime, RuntimeStoreOptions } from "@pakka/agent";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketApprovals, approvalTool, type PocketApprovals } from "../src/pocket-approvals.ts";

async function setup(options: { failAfterEffect?: boolean; pauseStart?: boolean } = {}) {
	let approvals!: PocketApprovals,
		target!: ConversationRef,
		began = false,
		release!: () => void;
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const m = await runtimeFixture(
		{
			tools: [
				approvalTool(
					{
						name: "approved_write",
						description: "Write exact host-selected file after human approval",
						parameters: {
							type: "object",
							properties: { text: { type: "string" } },
							required: ["text"],
							additionalProperties: false,
						},
						execute: async (args: Record<string, unknown>) => {
							assert.equal(typeof args.text, "string");
							await writeFile(join(m.f.cwd, "approved.txt"), String(args.text));
							if (options.failAfterEffect) throw Error("External write completed but receipt lost");
							return "APPROVED-EFFECT-DONE";
						},
					},
					() => ({ approvals, target }),
				),
			],
		},
		undefined,
		(payload) =>
			payload.messages.some((row) => row.role === "tool")
				? { text: "NATIVE-CALL-FINISHED" }
				: { tool: "approved_write", args: { text: "EXACT-MODEL-ARGUMENT" } },
	);
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "approval.people" }),
			session = await people.initializeOwner("Owner"),
			owner = await people.authenticate(session.token);
		const workspace = createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog: { namespace: "approval.workspace", maxDeliveries: 16, maxPending: 4 },
				profileCeiling: () => ["default"],
			}),
			client = workspace.bind(owner);
		target = await client.create({ requestId: "approval-main", name: "Approved work", profile: "default" });
		const hidden = await client.create({ requestId: "private", name: "Private", profile: "default" });
		const runtime: Runtime = Object.freeze({
			...m.runtime,
			store: (configuration: RuntimeStoreOptions) => {
				const actual = m.runtime.store(configuration);
				if (configuration.namespace !== "approval.calls" || !options.pauseStart) return actual;
				return Object.freeze({
					snapshot: actual.snapshot,
					compareAndSet: async (...args: Parameters<typeof actual.compareAndSet>) => {
						const saved = await actual.compareAndSet(...args);
						if (
							Array.isArray(args[1].rows) &&
							args[1].rows.some(
								(row) => row && typeof row === "object" && !Array.isArray(row) && row.state === "running",
							)
						) {
							began = true;
							await gate;
						}
						return saved;
					},
				});
			},
		});
		approvals = await createPocketApprovals({
			runtime,
			people,
			namespace: "approval.calls",
			timeoutMs: 5000,
		});
		const invite = await people.invite(owner, {
			requestId: "viewer",
			role: "viewer",
			resources: [target.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const viewerSession = await people.redeem(invite.token, "Viewer"),
			viewer = await people.authenticate(viewerSession.token);
		return {
			m,
			approvals,
			people,
			owner,
			viewer,
			workspace,
			client,
			target,
			hidden,
			session,
			release,
			began: () => began,
		};
	} catch (error) {
		release();
		await m.close();
		throw error;
	}
}

for (const allow of [true, false])
	test(
		`Pocket approvals: real native tool ${allow ? "allow executes once" : "deny has no external effect"}`,
		{ timeout: 15000 },
		async (t) => {
			const f = await setup();
			try {
				const admission = await f.client.submit(f.target, {
					requestId: "actual-tool",
					text: "REQUEST-APPROVED-WRITE",
					mode: "prompt",
				});
				await t.waitFor(async () => assert.equal((await f.approvals.bind(f.owner).list(f.target)).length, 1));
				const pending = (await f.approvals.bind(f.viewer).list(f.target))[0]!;
				assert.equal(pending.state, "pending");
				assert.equal(pending.tool, "approved_write");
				assert.deepEqual(pending.arguments, { text: "EXACT-MODEL-ARGUMENT" });
				assert.ok(Object.isFrozen(pending.arguments));
				await assert.rejects(readFile(join(f.m.f.cwd, "approved.txt")), { code: "ENOENT" });
				await assert.rejects(
					f.approvals.bind(f.viewer).decide(f.target, { id: pending.id, allow: true }),
					/denied/i,
				);
				await assert.rejects(f.approvals.bind(f.viewer).list(f.hidden), /denied/i);
				await assert.rejects(
					f.approvals.bind(f.owner).decide(f.hidden, { id: pending.id, allow: true }),
					/denied|conflict/i,
				);
				const outcome = await f.approvals.bind(f.owner).decide(f.target, { id: pending.id, allow });
				assert.equal(outcome.state, allow ? "allowed" : "denied");
				assert.equal((await f.client.wait(admission.id)).status, "done");
				const saved = (await f.approvals.bind(f.owner).list(f.target))[0]!;
				assert.equal(saved.state, allow ? "done" : "denied");
				if (allow)
					assert.equal(await readFile(join(f.m.f.cwd, "approved.txt"), "utf8"), "EXACT-MODEL-ARGUMENT");
				else await assert.rejects(readFile(join(f.m.f.cwd, "approved.txt")), { code: "ENOENT" });
				await assert.rejects(
					f.approvals.bind(f.owner).decide(f.target, { id: pending.id, allow: !allow }),
					/conflict|denied/i,
				);
				const native = await f.m.runtime.readConversation(f.target, () => {});
				assert.ok(
					native.entries.some((row) =>
						row.messages.some(
							(message) =>
								message.role === "toolResult" &&
								JSON.stringify(message).includes(allow ? "APPROVED-EFFECT-DONE" : "APPROVAL-DENIED"),
						),
					),
				);
				assert.equal(f.m.f.requests.length, 2);
				assert.deepEqual(f.m.f.errors, []);
			} finally {
				f.release();
				await f.m.close();
			}
		},
	);

test(
	"Pocket approvals: aborting the native call seals a late decision and unresolved restore never replays",
	{ timeout: 15000 },
	async (t) => {
		const f = await setup();
		try {
			const admission = await f.client.submit(f.target, {
				requestId: "abort-native",
				text: "WAIT-FOR-HUMAN",
				mode: "prompt",
			});
			await t.waitFor(async () => assert.equal((await f.approvals.bind(f.owner).list(f.target)).length, 1));
			const pending = (await f.approvals.bind(f.owner).list(f.target))[0]!;
			await f.client.abort(f.target);
			await f.client.wait(admission.id);
			await assert.rejects(
				f.approvals.bind(f.owner).decide(f.target, { id: pending.id, allow: true }),
				/denied|conflict/i,
			);
			await assert.rejects(readFile(join(f.m.f.cwd, "approved.txt")), { code: "ENOENT" });
			const recovered = await createPocketApprovals({
				runtime: f.m.runtime,
				people: f.people,
				namespace: "approval.calls",
				timeoutMs: 5000,
			});
			assert.equal((await recovered.bind(f.owner).list(f.target))[0]!.state, "unknown");
			await assert.rejects(
				recovered.bind(f.owner).decide(f.target, { id: pending.id, allow: true }),
				/denied|conflict/i,
			);
			assert.equal(f.m.f.requests.length, 1);
		} finally {
			f.release();
			await f.m.close();
		}
	},
);

test(
	"Pocket approvals: a real external effect followed by callback failure remains unknown",
	{ timeout: 15000 },
	async (t) => {
		const f = await setup({ failAfterEffect: true });
		try {
			const admission = await f.client.submit(f.target, {
				requestId: "lost-effect",
				text: "CALL-WITH-LOST-RESULT",
				mode: "prompt",
			});
			await t.waitFor(async () => assert.equal((await f.approvals.bind(f.owner).list(f.target)).length, 1));
			const pending = (await f.approvals.bind(f.owner).list(f.target))[0]!;
			await f.approvals.bind(f.owner).decide(f.target, { id: pending.id, allow: true });
			await f.client.wait(admission.id);
			assert.equal(await readFile(join(f.m.f.cwd, "approved.txt"), "utf8"), "EXACT-MODEL-ARGUMENT");
			assert.equal((await f.approvals.bind(f.owner).list(f.target))[0]!.state, "unknown");
			await writeFile(join(f.m.f.cwd, "approved.txt"), "LATER-EXTERNAL-EDIT");
			await assert.rejects(
				f.approvals.bind(f.owner).decide(f.target, { id: pending.id, allow: true }),
				/denied|conflict/i,
			);
			assert.equal(await readFile(join(f.m.f.cwd, "approved.txt"), "utf8"), "LATER-EXTERNAL-EDIT");
		} finally {
			f.release();
			await f.m.close();
		}
	},
);

test("Pocket approvals: a serialized invocation cannot create an approval or execute a tool", async () => {
	const f = await setup();
	let effects = 0;
	try {
		await assert.rejects(
			f.approvals.invoke(f.target, {}, "approved_write", {}, async () => {
				effects++;
				return "FORGED";
			}),
			/scope|invocation/i,
		);
		assert.equal(effects, 0);
		assert.equal((await f.approvals.bind(f.owner).list(f.target)).length, 0);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		f.release();
		await f.m.close();
	}
});

test(
	"Pocket approvals: losing the bound interface after committed allow blocks a not-yet-started effect",
	{ timeout: 15000 },
	async (t) => {
		const f = await setup({ pauseStart: true });
		let enabled = true;
		try {
			const admission = await f.client.submit(f.target, {
				requestId: "late-interface",
				text: "RECHECK-INTERFACE",
				mode: "prompt",
			});
			await t.waitFor(async () => assert.equal((await f.approvals.bind(f.owner).list(f.target)).length, 1));
			const pending = (await f.approvals.bind(f.owner).list(f.target))[0]!;
			await f.approvals
				.bind(f.owner, () => {
					if (!enabled) throw Error("Interface generation ended");
				})
				.decide(f.target, { id: pending.id, allow: true });
			await t.waitFor(() => assert.equal(f.began(), true));
			enabled = false;
			f.release();
			await f.client.wait(admission.id);
			await assert.rejects(readFile(join(f.m.f.cwd, "approved.txt")), { code: "ENOENT" });
			assert.equal((await f.approvals.bind(f.owner).list(f.target))[0]!.state, "unknown");
		} finally {
			f.release();
			await f.m.close();
		}
	},
);

test(
	"Pocket approvals: revocation after committed allow but before the tool effect denies the late effect",
	{ timeout: 15000 },
	async (t) => {
		const f = await setup({ pauseStart: true });
		try {
			const admission = await f.client.submit(f.target, {
				requestId: "late-revocation",
				text: "RECHECK-AFTER-ALLOW",
				mode: "prompt",
			});
			await t.waitFor(async () => assert.equal((await f.approvals.bind(f.owner).list(f.target)).length, 1));
			const pending = (await f.approvals.bind(f.owner).list(f.target))[0]!;
			const invite = await f.people.invite(f.owner, {
				requestId: "approver",
				role: "admin",
				resources: [f.target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const session = await f.people.redeem(invite.token, "Approver"),
				actor = await f.people.authenticate(session.token);
			await f.approvals.bind(actor).decide(f.target, { id: pending.id, allow: true });
			await t.waitFor(() => assert.equal(f.began(), true));
			await f.people.revokePerson(f.owner, actor.person.id);
			f.release();
			await f.client.wait(admission.id);
			await assert.rejects(readFile(join(f.m.f.cwd, "approved.txt")), { code: "ENOENT" });
			assert.equal((await f.approvals.bind(f.owner).list(f.target))[0]!.state, "unknown");
			assert.equal(f.m.f.requests.length, 2);
		} finally {
			f.release();
			await f.m.close();
		}
	},
);
