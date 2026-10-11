import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { appendFile, rm } from "node:fs/promises";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";
import { deferred, oracleFixture as fixture, raw, seed, text } from "./fixture.ts";
import type { JsonObject } from "../src/index.ts";

async function checkpoints(f: Awaited<ReturnType<typeof fixture>>) {
	const initial = await f.start();
	await seed(initial);
	const file = initial.view().sessionFile;
	await initial.dispose();
	const manager = SessionManager.open(file);
	const mid = manager.appendMessage({ role: "system", content: "MID-CHECKPOINT", timestamp: 2 });
	const excluded = manager.appendMessage({
		role: "bashExecution",
		command: "echo secret",
		output: "EXCLUDED-BASH",
		cancelled: false,
		truncated: false,
		exitCode: 0,
		excludeFromContext: true,
		timestamp: 3,
	});
	const tail = manager.appendMessage({ role: "user", content: "BEFORE-EDIT", timestamp: 4 });
	manager.appendContextEdit(tail, { content: "AFTER-EDIT" });
	const host = await f.start({ reopenSessionFile: file });
	const user = host.connect("next-user", ["input.submit"]),
		owner = host.connect("owner", ["real_context.write"]);
	owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
	return { host, user, owner, b: binding(owner), mid, excluded, tail };
}

test("atomic provenance frame aligns context edits, system/loadout checkpoints and excluded bash", async () => {
	const f = await fixture();
	try {
		const { host, user, b, mid, excluded, tail } = await checkpoints(f);
		const frame = b.readFrame();
		assert.equal(frame.projection.find((e) => e.sourceEntryId === mid)!.boundary, "system");
		assert.equal(frame.projection.find((e) => e.sourceEntryId === excluded)!.excluded, true);
		assert.match(JSON.stringify(frame.entries.find((e) => e.id === tail)!.raw), /BEFORE-EDIT/);
		assert.match(
			JSON.stringify(frame.projection.find((e) => e.sourceEntryId === tail)!.messages),
			/AFTER-EDIT/,
		);
		const before = await raw(host);
		b.installProjector((request) => ({
			status: "apply",
			basis: request.basis,
			patches: [{ sourceEntryId: tail, messageIndex: 0, content: "TAGGED-EDIT" }],
		}));
		await user.submit({ key: "verify", text: "NEW-TAIL" });
		await host.waitForIdle();
		assert.match(text(f.requests.at(-1)!), /PAKKA-SYSTEM/);
		assert.match(text(f.requests.at(-1)!), /MID-CHECKPOINT/);
		assert.match(text(f.requests.at(-1)!), /TAGGED-EDIT/);
		assert.doesNotMatch(text(f.requests.at(-1)!), /EXCLUDED-BASH|BEFORE-EDIT|AFTER-EDIT/);
		assert.equal((await raw(host)).startsWith(before), true);
	} finally {
		await f.close();
	}
});

test("summary replacement crossing an unselected mid-system checkpoint blocks HTTP", async () => {
	const f = await fixture();
	try {
		const { host, user, b, tail } = await checkpoints(f);
		const source = target(b.readFrame());
		b.installProjector((frame) => ({
			status: "apply",
			basis: frame.basis,
			replacements: [{ sourceEntryIds: [source, tail], summary: "CROSSED-CHECKPOINT" }],
		}));
		await user.submit({ key: "blocked", text: "BLOCK" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 1);
		assert.equal(host.view().phase, "failed");
	} finally {
		await f.close();
	}
});

for (const mutation of ["arguments", "id", "name", "dangling-range", "reversed-range", "forged-result"])
	test(`native protocol ${mutation} cannot escape through the projector to HTTP`, async () => {
		const f = await fixture(
			{
				tools: [
					{
						name: "native",
						description: "native",
						parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
						execute: async () => "RAW-RESULT",
					},
				],
			},
			(_p, n) => (n === 1 ? { tool: "native", args: { value: "ORIGINAL-ARG" } } : { text: "ANSWER" }),
		);
		try {
			const host = await f.start();
			const { client: user } = await seed(host);
			const owner = host.connect("owner", ["real_context.write"]);
			owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
			const b = binding(owner);
			b.installProjector((frame) => {
				const call = frame.projection.find((e) =>
					e.messages.some(
						(m) =>
							m.role === "assistant" &&
							Array.isArray(m.content) &&
							m.content.some((c) => c && typeof c === "object" && !Array.isArray(c) && c.type === "toolCall"),
					),
				)!;
				const result = frame.projection.find((e) => e.messages.some((m) => m.role === "toolResult"))!;
				if (mutation.includes("range"))
					return {
						status: "apply",
						basis: frame.basis,
						replacements: [
							{
								sourceEntryIds:
									mutation === "dangling-range"
										? [call.sourceEntryId]
										: [result.sourceEntryId, call.sourceEntryId],
								summary: "FORGED",
							},
						],
					};
				if (mutation === "forged-result")
					return {
						status: "apply",
						basis: frame.basis,
						patches: [
							{
								sourceEntryId: result.sourceEntryId,
								messageIndex: 0,
								content: [{ type: "toolCall", id: "new", name: "native", arguments: {} }],
							},
						],
					};
				const content = structuredClone(call.messages[0].content) as JsonObject[];
				const native = content.find((c) => c.type === "toolCall")!;
				content[content.indexOf(native)] = {
					...native,
					...(mutation === "arguments" ? { arguments: { value: "CHANGED" } } : { [mutation]: "CHANGED" }),
				};
				return {
					status: "apply",
					basis: frame.basis,
					patches: [{ sourceEntryId: call.sourceEntryId, messageIndex: 0, content }],
				};
			});
			await user.submit({ key: "block", text: "NEXT" });
			await host.waitForIdle();
			assert.equal(f.requests.length, 2);
			assert.equal(host.view().phase, "failed");
		} finally {
			await f.close();
		}
	});

test("native tool-result reduction preserves call IDs/names/arguments and declarations on wire", async () => {
	const f = await fixture(
		{
			tools: [
				{
					name: "native",
					description: "native",
					parameters: { type: "object", properties: { value: { type: "string" } } },
					execute: async () => "RAW-RESULT",
				},
			],
		},
		(_p, n) => (n === 1 ? { tool: "native", args: { value: "ORIGINAL-ARG" } } : { text: "ANSWER" }),
	);
	try {
		const host = await f.start();
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
		const b = binding(owner);
		b.installProjector((frame) => ({
			status: "apply",
			basis: frame.basis,
			patches: [
				{
					sourceEntryId: frame.projection.find((e) => e.messages.some((m) => m.role === "toolResult"))!
						.sourceEntryId,
					messageIndex: 0,
					content: [{ type: "text", text: "REDUCED-RESULT" }],
				},
			],
		}));
		await user.submit({ key: "next", text: "NEXT" });
		await host.waitForIdle();
		const payload = f.requests.at(-1)!;
		assert.match(JSON.stringify(payload.tools), /native/);
		const call = payload.messages.find((m) => m.tool_calls)!.tool_calls as {
			id: string;
			function: { name: string; arguments: string };
		}[];
		assert.deepEqual(
			call.map((c) => ({ id: c.id, name: c.function.name, args: c.function.arguments })),
			[{ id: "call-1", name: "native", args: '{"value":"ORIGINAL-ARG"}' }],
		);
		assert.equal(payload.messages.find((m) => m.role === "tool")!.tool_call_id, "call-1");
		assert.match(text(payload), /REDUCED-RESULT/);
		assert.doesNotMatch(text(payload), /RAW-RESULT/);
		assert.match(await raw(host), /RAW-RESULT/);
	} finally {
		await f.close();
	}
});

test("a completed source job cannot activate a summary after a later source edit", async () => {
	const f = await fixture();
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const id = target(frame),
			job = b.createJob(frame.basis, { planId: "completed", targetEntryIds: [id], maxCalls: 1 });
		assert.equal(
			(await job.infer({ modelKey: "summary", prompt: "SOURCE", maxOutputTokens: 64 })).status,
			"completed",
		);
		b.installProjector((f) => ({
			status: "apply",
			basis: f.basis,
			replacements: [{ sourceEntryIds: [id], summary: "STALE-SUMMARY", jobScope: job.scope }],
		}));
		await owner.commit(owner.capture(), { type: "edit", targetId: id, text: "NEW-SOURCE" });
		assert.equal(job.signal.aborted, true);
		await user.submit({ key: "stale", text: "TAIL" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 2);
		assert.equal(host.view().phase, "failed");
	} finally {
		await f.close();
	}
});

test("previous-context edit invalidates an in-flight job even if its target is unchanged", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({}, async (p) => {
		if (p.model === "summary-model") {
			entered.resolve();
			await release.promise;
		}
		return { text: "ANSWER" };
	});
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		const { client: user } = await seed(host);
		await user.submit({ key: "tail", text: "TARGET" });
		await host.waitForIdle();
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const previous = target(frame),
			id = frame.projection.find((e) => JSON.stringify(e.messages).includes("TARGET"))!.sourceEntryId;
		const job = b.createJob(frame.basis, {
			planId: "previous",
			targetEntryIds: [id],
			contextEntryIds: [previous],
			maxCalls: 1,
		});
		const pending = job.infer({ modelKey: "summary", prompt: "FIXED-CONTEXT", maxOutputTokens: 64 });
		await entered.promise;
		await owner.commit(owner.capture(), { type: "edit", targetId: previous, text: "CHANGED-PREVIOUS" });
		assert.equal(job.signal.aborted, true);
		release.resolve();
		assert.equal((await pending).status, "quarantined");
	} finally {
		release.resolve();
		await f.close();
	}
});

test("reopen rejects a missing or partial journal instead of silently recreating its records", async () => {
	for (const fault of ["missing", "partial", "directory"]) {
		const f = await fixture();
		try {
			const host = await f.start();
			await seed(host);
			const file = host.view().sessionFile;
			const owner = host.connect("owner", ["context_artifacts.write"]);
			owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
			const b = binding(owner),
				frame = b.readFrame();
			const receipt = b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ kind: "DURABLE" }] });
			assert.equal(receipt.status, "committed");
			await host.dispose();
			if (fault === "missing") await rm(receipt.journalPath);
			else if (fault === "directory") await rm(join(f.dataDir, "artifacts"), { recursive: true });
			else await appendFile(receipt.journalPath, '{"partial":');
			const reopened = await f.start({ reopenSessionFile: file });
			const next = reopened.connect("new-owner", ["context_artifacts.write"]);
			next.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
			assert.throws(() => binding(next).readFrame(), /journal|storage/i);
			assert.equal(reopened.view().phase, "failed");
		} finally {
			await f.close();
		}
	}
});

test("binding lifecycle notifies both revocation and fresh ready views", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		await seed(host);
		const owner = host.connect("owner", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner);
		const events: string[] = [],
			views: string[] = [];
		b.subscribe((event) => {
			events.push(event.reason + ":" + event.phase);
			if (event.phase === "ready") views.push(b.readFrame().sessionId);
		});
		await host.reload();
		await host.newSession();
		await Promise.resolve();
		assert.deepEqual(events, [
			"reload:transitioning",
			"reload:ready",
			"newSession:transitioning",
			"newSession:ready",
		]);
		assert.equal(views.length, 2);
		assert.notEqual(views[0], views[1]);
	} finally {
		await f.close();
	}
});
