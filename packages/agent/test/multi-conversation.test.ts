import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../src/index.ts";
import type { StrategyBinding, ToolInvocationScope } from "../src/index.ts";
import { raw, text } from "./fixture.ts";
import { binding } from "./strategy-fixture.ts";
import { runtimeFixture as managed, runtimeLimits as limits } from "./runtime-fixture.ts";

test("M1: two concurrent Conversations have one storage and independent contexts/provider identity", async () => {
	const m = await managed();
	try {
		const a = m.runtime.root();
		const ref = await m.runtime.createConversation({ key: "worker-b" });
		const b = await m.runtime.conversation(ref);
		const va = a.view();
		const vb = b.view();
		assert.equal(va.durableSessionId, m.runtime.view().sessionId);
		assert.equal(vb.durableSessionId, va.durableSessionId);
		assert.notEqual(vb.conversationId, va.conversationId);
		assert.equal(vb.sessionId, va.sessionId, "legacy sessionId denotes shared storage/provenance");
		assert.notEqual(
			vb.providerSessionId,
			va.providerSessionId,
			"native provider identity must be independent",
		);
		assert.equal(vb.sessionFile, va.sessionFile, "this must exercise the same real Harness storage");
		const ua = a.connect("same-principal", ["input.submit"]);
		const ub = b.connect("same-principal", ["input.submit"]);
		const [ra, rb] = await Promise.all([
			ua.submit({ key: "same-key", text: "CONVERSATION-A-ONLY" }),
			ub.submit({ key: "same-key", text: "CONVERSATION-B-ONLY" }),
		]);
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 2);
		const wireA = m.f.requests.find((r) => text(r).includes("CONVERSATION-A-ONLY"));
		const wireB = m.f.requests.find((r) => text(r).includes("CONVERSATION-B-ONLY"));
		assert.ok(wireA && wireB);
		assert.doesNotMatch(text(wireA), /CONVERSATION-B-ONLY/);
		assert.doesNotMatch(text(wireB), /CONVERSATION-A-ONLY/);
		assert.equal(ua.receipt(ra.id)?.state, "committed");
		assert.equal(ub.receipt(rb.id)?.state, "committed");
		assert.equal(ua.receipt(rb.id), undefined, "receipts may not cross Conversation boundaries");
		const disk = await raw(a);
		assert.match(disk, /CONVERSATION-A-ONLY/);
		assert.match(disk, /CONVERSATION-B-ONLY/);
		assert.ok(Object.isFrozen(ref) && Object.isFrozen(m.runtime.view()));
	} finally {
		await m.close();
	}
});

test("M1: equal strategy IDs use independent physical journals and projection permits", async () => {
	const m = await managed();
	try {
		const a = m.runtime.root();
		const b = await m.runtime.conversation(await m.runtime.createConversation({ key: "worker-b" }));
		const ua = a.connect("user", ["input.submit"]),
			ub = b.connect("user", ["input.submit"]);
		await ua.submit({ key: "seed", text: "A-SEED" });
		await a.waitForIdle();
		await ub.submit({ key: "seed", text: "B-SEED" });
		await b.waitForIdle();
		const ca = a.connect("owner", ["real_context.write", "context_artifacts.write"]);
		const cb = b.connect("owner", ["real_context.write", "context_artifacts.write"]);
		for (const c of [ca, cb])
			c.activateStrategy({ id: "same-strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const ba = binding(ca, "same-strategy"),
			bb = binding(cb, "same-strategy");
		const fa = ba.readFrame(),
			fb = bb.readFrame();
		const ja = ba.artifacts.append(fa.basis, { expectedVersion: 0, records: [{ only: "A" }] });
		const jb = bb.artifacts.append(fb.basis, { expectedVersion: 0, records: [{ only: "B" }] });
		assert.equal(ja.status, "committed");
		assert.equal(jb.status, "committed");
		assert.notEqual(ja.journalPath, jb.journalPath);
		assert.throws(() => bb.artifacts.read(fa.basis), /scope|basis/i);
		assert.deepEqual(ba.readFrame().artifacts.records, [{ only: "A" }]);
		assert.deepEqual(bb.readFrame().artifacts.records, [{ only: "B" }]);
		const sourceA = fa.projection.find((e) => JSON.stringify(e.messages).includes("A-SEED"))!;
		const sourceB = fb.projection.find((e) => JSON.stringify(e.messages).includes("B-SEED"))!;
		ba.installProjector((frame) => ({
			status: "apply",
			basis: frame.basis,
			replacements: [{ sourceEntryIds: [sourceA.sourceEntryId], summary: "A-ONLY-SUMMARY" }],
		}));
		bb.installProjector((frame) => ({
			status: "apply",
			basis: frame.basis,
			replacements: [{ sourceEntryIds: [sourceB.sourceEntryId], summary: "B-ONLY-SUMMARY" }],
		}));
		await Promise.all([
			ua.submit({ key: "next", text: "A-NEXT" }),
			ub.submit({ key: "next", text: "B-NEXT" }),
		]);
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 4);
		const nextA = m.f.requests.find((r) => text(r).includes("A-NEXT"))!;
		const nextB = m.f.requests.find((r) => text(r).includes("B-NEXT"))!;
		assert.match(text(nextA), /A-ONLY-SUMMARY/);
		assert.doesNotMatch(text(nextA), /B-ONLY-SUMMARY|B-SEED/);
		assert.match(text(nextB), /B-ONLY-SUMMARY/);
		assert.doesNotMatch(text(nextB), /A-ONLY-SUMMARY|A-SEED/);
	} finally {
		await m.close();
	}
});

test("M1: Conversation creation quota and unknown profiles refuse without effects", async () => {
	const m = await managed({}, { ...limits, maxConversations: 2 });
	try {
		await m.runtime.createConversation({ key: "worker-b" });
		await assert.rejects(m.runtime.createConversation({ key: "worker-c" }), /limit|quota/i);
		await assert.rejects(
			m.runtime.createConversation({ key: "bad-profile", profile: "not-approved" }),
			/profile/i,
		);
		assert.equal(m.runtime.view().conversations.length, 2);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("M1: one failed/disposed Conversation does not close its peer or Harness", async () => {
	const m = await managed({}, limits, (payload) =>
		text(payload).includes("LOCAL-FAILURE-A") ? { error: 500 } : { text: "peer-alive" },
	);
	try {
		const a = m.runtime.root();
		const b = await m.runtime.conversation(await m.runtime.createConversation({ key: "peer" }));
		const ua = a.connect("user", ["input.submit"]),
			ub = b.connect("user", ["input.submit"]);
		await ua.submit({ key: "bad", text: "LOCAL-FAILURE-A" });
		await a.waitForIdle();
		assert.equal(a.view().phase, "failed");
		assert.equal(b.view().phase, "ready");
		assert.equal(m.runtime.view().phase, "ready");
		await a.dispose();
		await ub.submit({ key: "still-alive", text: "PEER-B-AFTER-A-DISPOSE" });
		await b.waitForIdle();
		assert.equal(m.f.requests.length, 2);
		assert.match(text(m.f.requests[1]!), /PEER-B-AFTER-A-DISPOSE/);
		assert.equal(b.view().phase, "ready");
	} finally {
		await m.close();
	}
});

test(
	"M1: local reload does not wait for or invalidate another Conversation's pending HTTP",
	{ timeout: 15000 },
	async () => {
		const arrived = barrier(),
			release = barrier();
		const m = await managed({}, limits, async (payload) => {
			if (text(payload).includes("HELD-PEER-B")) {
				arrived.resolve();
				await release.promise;
			}
			return { text: "ok" };
		});
		try {
			const a = m.runtime.root();
			const b = await m.runtime.conversation(await m.runtime.createConversation({ key: "peer" }));
			const ub = b.connect("user", ["input.submit"]);
			await ub.submit({ key: "held", text: "HELD-PEER-B" });
			await arrived.promise;
			await a.reload();
			assert.equal(a.view().phase, "ready");
			assert.equal(b.view().phase, "ready");
			assert.equal(m.f.requests.length, 1);
			release.resolve();
			await b.waitForIdle();
			assert.match(
				b
					.view()
					.context.map((entry) => entry.text)
					.join("\n"),
				/HELD-PEER-B/,
			);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);

test("M1: native tool invocation authority is routed by asking Conversation, not by tool name", async () => {
	let ba!: StrategyBinding, bb!: StrategyBinding;
	const seen: { actor: string; conversationId: string | undefined; scope: ToolInvocationScope }[] = [];
	const m = await managed(
		{
			tools: [
				{
					name: "scope_probe",
					description: "probe Conversation-scoped authority",
					parameters: { type: "object", properties: { actor: { type: "string" } }, required: ["actor"] },
					execute: async (args, _signal, scope) => {
						const actor = String(args.actor),
							own = actor === "A" ? ba : bb,
							peer = actor === "A" ? bb : ba;
						const frame = own.readFrame(scope);
						assert.throws(() => peer.readFrame(scope), /invocation|scope/i);
						seen.push({ actor, conversationId: frame.conversationId, scope });
						return actor + "-SCOPED-RESULT";
					},
				},
			],
		},
		limits,
		(payload) =>
			payload.messages.some((message) => message.role === "tool")
				? { text: "tool-done" }
				: { tool: "scope_probe", args: { actor: text(payload).includes("TOOL-A") ? "A" : "B" } },
	);
	try {
		const a = m.runtime.root(),
			b = await m.runtime.conversation(await m.runtime.createConversation({ key: "peer" }));
		const ca = a.connect("owner", ["context_artifacts.write"]),
			cb = b.connect("owner", ["context_artifacts.write"]);
		for (const client of [ca, cb])
			client.activateStrategy({ id: "same", hooks: ["context_artifacts.write"] });
		ba = binding(ca, "same");
		bb = binding(cb, "same");
		await Promise.all([
			a.connect("user", ["input.submit"]).submit({ key: "go", text: "TOOL-A" }),
			b.connect("user", ["input.submit"]).submit({ key: "go", text: "TOOL-B" }),
		]);
		await m.runtime.waitForIdle();
		assert.equal(seen.length, 2);
		assert.equal(m.f.requests.length, 4);
		assert.equal(seen.find((entry) => entry.actor === "A")?.conversationId, a.view().conversationId);
		assert.equal(seen.find((entry) => entry.actor === "B")?.conversationId, b.view().conversationId);
		for (const entry of seen)
			assert.throws(() => (entry.actor === "A" ? ba : bb).readFrame(entry.scope), /invocation|scope/i);
	} finally {
		await m.close();
	}
});

test("M1: fork publishes a new resource reference and leaves peer identity/capabilities intact", async () => {
	const m = await managed();
	try {
		const a = m.runtime.root(),
			old = m.runtime.view().conversations.find((ref) => ref.key === "root")!;
		const peerRef = await m.runtime.createConversation({ key: "peer" }),
			b = await m.runtime.conversation(peerRef);
		const user = a.connect("user", ["input.submit", "branch.control"]);
		await user.submit({ key: "seed", text: "FORK-SEED-A" });
		await a.waitForIdle();
		const providerBefore = a.view().providerSessionId;
		const owner = b.connect("owner", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "peer-strategy", hooks: ["context_artifacts.write"] });
		const bound = binding(owner, "peer-strategy"),
			frame = bound.readFrame();
		user.branch(user.capture(), a.view().entries.find((entry) => entry.role === "user")!.id);
		await a.waitForIdle();
		const current = m.runtime.view().conversations.find((ref) => ref.key === "root")!;
		assert.notEqual(current.conversationId, old.conversationId);
		assert.notEqual(current.incarnation, old.incarnation);
		assert.equal(current.conversationId, a.view().conversationId);
		assert.notEqual(a.view().providerSessionId, providerBefore);
		await assert.rejects(m.runtime.conversation(old), /stale|foreign/i);
		assert.equal(await m.runtime.conversation(current), a);
		assert.equal(await m.runtime.conversation(peerRef), b);
		assert.equal(
			bound.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ untouched: true }] }).status,
			"committed",
		);
		await user.submit({ key: "after-fork", text: "AFTER-FORK-A" });
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 2);
	} finally {
		await m.close();
	}
});

test("M1: managed restore reopens the active fork and child journals without inspection HTTP", async () => {
	const m = await managed();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const a = m.runtime.root(),
			peerRef = await m.runtime.createConversation({ key: "peer" });
		const b = await m.runtime.conversation(peerRef),
			user = a.connect("user", ["input.submit", "branch.control"]);
		await user.submit({ key: "seed", text: "RESTORE-FORK-A" });
		await a.waitForIdle();
		user.branch(user.capture(), a.view().entries.find((entry) => entry.role === "user")!.id);
		await a.waitForIdle();
		const owner = b.connect("owner", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "saved", hooks: ["context_artifacts.write"] });
		const oldBound = binding(owner, "saved"),
			saved = oldBound.readFrame();
		assert.equal(
			oldBound.artifacts.append(saved.basis, { expectedVersion: 0, records: [{ persisted: "B" }] }).status,
			"committed",
		);
		const currentRoot = m.runtime.view().conversations.find((ref) => ref.key === "root")!;
		const before = m.f.requests.length,
			file = a.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.equal(reopened.root().view().conversationId, currentRoot.conversationId);
		assert.equal(reopened.view().conversations.length, 2);
		assert.equal(m.f.requests.length, before, "restore/inspection cannot resume tasks or model requests");
		assert.throws(() => oldBound.readFrame(), /disposed|scope|inactive/i);
		const restoredB = await reopened.conversation(peerRef),
			nextOwner = restoredB.connect("owner", ["context_artifacts.write"]);
		nextOwner.activateStrategy({ id: "saved", hooks: ["context_artifacts.write"] });
		assert.deepEqual(binding(nextOwner, "saved").readFrame().artifacts.records, [{ persisted: "B" }]);
		assert.equal(m.f.requests.length, before);
		await reopened
			.root()
			.connect("fresh-user", ["input.submit"])
			.submit({ key: "next", text: "RESTORED-CURRENT-A" });
		await reopened.waitForIdle();
		assert.equal(m.f.requests.length, before + 1);
		assert.match(text(m.f.requests.at(-1)!), /RESTORE-FORK-A|RESTORED-CURRENT-A/);
	} finally {
		try {
			await reopened?.close();
		} finally {
			await m.close();
		}
	}
});

test("M1: competing primary dispatches reserve one shared durable quota without implicit retries", async () => {
	const m = await managed({}, { ...limits, maxPrimaryAttempts: 1 });
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const a = m.runtime.root(),
			peer = await m.runtime.createConversation({ key: "peer" }),
			b = await m.runtime.conversation(peer);
		const ua = a.connect("user", ["input.submit"]),
			ub = b.connect("user", ["input.submit"]);
		const receipts = await Promise.all([
			ua.submit({ key: "first", text: "PRIMARY-QUOTA-A" }),
			ub.submit({ key: "first", text: "PRIMARY-QUOTA-B" }),
		]);
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 1);
		assert.equal(m.runtime.view().budget.primaryAttempts, 1);
		assert.equal(
			receipts.filter(
				(receipt, index) => [ua, ub][index]!.receipt(receipt.id)?.generation?.status === "blocked",
			).length,
			1,
		);
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.equal(reopened.view().budget.primaryAttempts, 1);
		const r = await reopened
			.root()
			.connect("new-user", ["input.submit"])
			.submit({ key: "after-reopen", text: "MUST-NOT-RESET-QUOTA" });
		await reopened.waitForIdle();
		assert.equal(m.f.requests.length, 1);
		assert.equal(reopened.root().view().phase, "ready");
		assert.equal(
			reopened
				.root()
				.view()
				.entries.some((entry) => entry.text?.includes("MUST-NOT-RESET-QUOTA")),
			true,
		);
		assert.equal(reopened.root().view().busy, false);
		assert.ok(r.id);
	} finally {
		try {
			await reopened?.close();
		} finally {
			await m.close();
		}
	}
});
