import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createRuntime } from "@pakka/agent";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketMemory } from "../src/pocket-memory.ts";

const options = {
	namespace: "tested.memory",
	profiles: ["memory"],
	projects: [
		{ id: "a", name: "Project A", resources: ["a"] },
		{ id: "b", name: "Project B", resources: ["b"] },
	],
};
async function memoryFixture() {
	const prepared = createPocketMemory(options),
		m = await runtimeFixture({
			profiles: [{ id: "memory" }, { id: "plain" }],
			contextSources: [prepared.source],
		});
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "memory.people" }),
			session = await people.initializeOwner("Owner"),
			owner = await people.authenticate(session.token);
		const a = await m.runtime.createConversation({ key: "a", profile: "memory" }),
			b = await m.runtime.createConversation({ key: "b", profile: "memory" });
		const service = await prepared.attach({ runtime: m.runtime, people });
		const invite = await people.invite(owner, {
			requestId: "sender",
			role: "sender",
			resources: [a.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const senderSession = await people.redeem(invite.token, "Sender"),
			sender = await people.authenticate(senderSession.token);
		return { m, prepared, people, owner, ownerToken: session.token, sender, service, a, b };
	} catch (error) {
		await m.close();
		throw error;
	}
}

// Auto-approving a sender, leaking another project, or treating UI installation as an Agent source must fail real HTTP assertions.
test(
	"Pocket memory: approved lessons affect actual profile/project context while sender proposals remain private and inactive",
	{ timeout: 15000 },
	async () => {
		const f = await memoryFixture();
		try {
			const sender = f.service.bind(f.sender, f.a),
				owner = f.service.bind(f.owner, f.a),
				pending = await sender.add({
					requestId: "propose",
					scope: "project",
					text: "PROJECT-A-APPROVAL-CANARY",
				});
			assert.equal(pending.state, "done");
			assert.ok(pending.lesson);
			assert.equal(pending.lesson.pending, true);
			const hostA = await f.m.runtime.conversation(f.a),
				clientA = hostA.connect("operator", ["input.submit"]);
			await clientA.submit({ key: "before-approval", text: "BEFORE-APPROVAL" });
			await hostA.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.ok(!JSON.stringify(f.m.f.requests[0]).includes("PROJECT-A-APPROVAL-CANARY"));
			const accepted = await owner.change({
				requestId: "approve",
				id: pending.lesson.id,
				expectedVersion: pending.lesson.version,
				action: "approve",
			});
			assert.ok(accepted.lesson);
			assert.equal(accepted.lesson.pending, false);
			await clientA.submit({ key: "after-approval", text: "AFTER-APPROVAL" });
			await hostA.waitForIdle();
			assert.ok(JSON.stringify(f.m.f.requests[1]).includes("PROJECT-A-APPROVAL-CANARY"));
			await f.service
				.bind(f.owner, f.b)
				.add({ requestId: "private-b", scope: "project", text: "PROJECT-B-PRIVATE-CANARY" });
			const hostB = await f.m.runtime.conversation(f.b);
			await hostB.connect("operator", ["input.submit"]).submit({ key: "b", text: "OTHER-PROJECT" });
			await hostB.waitForIdle();
			assert.ok(JSON.stringify(f.m.f.requests[2]).includes("PROJECT-B-PRIVATE-CANARY"));
			assert.ok(!JSON.stringify(f.m.f.requests[2]).includes("PROJECT-A-APPROVAL-CANARY"));
			assert.ok(!JSON.stringify(await sender.read()).includes("PROJECT-B-PRIVATE-CANARY"));
			await assert.rejects(async () => f.service.bind(f.sender, f.b).read(), /denied/i);
			const plainRef = await f.m.runtime.createConversation({ key: "without-agent", profile: "plain" }),
				plain = await f.m.runtime.conversation(plainRef);
			await plain.connect("operator", ["input.submit"]).submit({ key: "plain", text: "NO-AGENT-FACET" });
			await plain.waitForIdle();
			assert.ok(!JSON.stringify(f.m.f.requests[3]).includes("APPROVAL-CANARY"));
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 4);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"Pocket memory versions: stale edits preserve the winner, unapproved replacement preserves current context, and original requests never apply twice",
	{ timeout: 15000 },
	async () => {
		const f = await memoryFixture();
		try {
			const owner = f.service.bind(f.owner, f.a),
				sender = f.service.bind(f.sender, f.a),
				input = { requestId: "seed", scope: "project" as const, text: "ORIGINAL-APPROVED-LESSON" };
			const first = await owner.add(input);
			assert.ok(first.lesson);
			assert.deepEqual(await owner.add(input), first);
			await assert.rejects(owner.add({ ...input, text: "DIFFERENT-PAYLOAD" }), /conflict/i);
			const proposed = await sender.change({
				requestId: "edit-proposal",
				id: first.lesson.id,
				expectedVersion: first.lesson.version,
				action: "edit",
				text: "PROPOSED-REPLACEMENT",
			});
			assert.ok(proposed.lesson?.proposal);
			assert.equal(proposed.lesson.text, "ORIGINAL-APPROVED-LESSON");
			const stale = await owner.change({
				requestId: "stale",
				id: first.lesson.id,
				expectedVersion: first.lesson.version,
				action: "edit",
				text: "STALE-OVERWRITE",
			});
			assert.equal(stale.state, "conflict");
			const rows = (await owner.read()).lessons;
			assert.equal(rows.length, 1);
			assert.equal(rows[0]!.text, "ORIGINAL-APPROVED-LESSON");
			assert.equal(rows[0]!.proposal?.text, "PROPOSED-REPLACEMENT");
			const accepted = await owner.change({
				requestId: "approve-new",
				id: first.lesson.id,
				expectedVersion: proposed.lesson.version,
				action: "approve",
			});
			assert.equal(accepted.lesson?.text, "PROPOSED-REPLACEMENT");
			assert.equal((await owner.read()).lessons.length, 1);
			assert.deepEqual(await owner.operation("seed"), first);
			assert.equal(f.m.f.requests.length, 0);
			const invite = await f.people.invite(f.owner, {
				requestId: "viewer",
				role: "viewer",
				resources: [f.a.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const viewer = await f.people.authenticate((await f.people.redeem(invite.token, "Viewer")).token);
			await assert.rejects(
				async () =>
					f.service
						.bind(viewer, f.a)
						.add({ requestId: "illegal", scope: "project", text: "FORGED-VIEWER-INSTRUCTIONS" }),
				/denied/i,
			);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"Pocket memory recovery: disabled injection preserves lessons and the original mutation across normal writer reopen without resetting spent quota",
	{ timeout: 15000 },
	async () => {
		const f = await memoryFixture();
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const owner = f.service.bind(f.owner, f.a),
				input = { requestId: "persisted", scope: "project" as const, text: "MEMORY-REOPEN-CANARY" };
			const first = await owner.add(input);
			const host = await f.m.runtime.conversation(f.a);
			await host.connect("operator", ["input.submit"]).submit({ key: "before-close", text: "WITH-MEMORY" });
			await host.waitForIdle();
			assert.ok(JSON.stringify(f.m.f.requests[0]).includes(input.text));
			await owner.setEnabled({ requestId: "disable", enabled: false });
			const file = f.m.runtime.view().sessionFile;
			await f.m.runtime.close();
			const prepared = createPocketMemory(options);
			reopened = await createRuntime({
				...f.m.config,
				reopenSessionFile: file,
				contextSources: [prepared.source],
			});
			const people = await createPocketPeople({ runtime: reopened, namespace: "memory.people" }),
				actor = await people.authenticate(f.ownerToken),
				service = await prepared.attach({ runtime: reopened, people });
			const current = service.bind(actor, f.a);
			assert.deepEqual(await current.operation("persisted"), first);
			assert.equal((await current.read()).enabled, false);
			assert.equal((await current.read()).lessons.length, 1);
			const after = await reopened.conversation(f.a),
				client = after.connect("operator", ["input.submit"]);
			await client.submit({ key: "disabled", text: "AFTER-DISABLE" });
			await after.waitForIdle();
			assert.ok(!JSON.stringify(f.m.f.requests[1]).includes(input.text));
			await current.setEnabled({ requestId: "reenable", enabled: true });
			await client.submit({ key: "enabled", text: "AFTER-REENABLE" });
			await after.waitForIdle();
			assert.ok(JSON.stringify(f.m.f.requests[2]).includes(input.text));
			assert.equal(reopened.view().budget.primaryAttempts, 3);
		} finally {
			await reopened?.close();
			await f.m.close();
		}
	},
);
