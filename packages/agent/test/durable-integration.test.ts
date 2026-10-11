import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, seed, raw, text } from "./fixture.ts";
import { binding } from "./strategy-fixture.ts";

test("DurableAdapter is the default runtime created by createHost()", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const view = host.view();
		assert.equal(view.autoCompaction, false);
		assert.match(view.sessionFile, /main\.jsonl$/);
		assert.equal(view.phase, "ready");
		assert.equal(view.effects, "not-assessed");
	} finally {
		await f.close();
	}
});

test("A-06: Generation gate blocks provider dispatch with providerCalls = 0", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const { client: user } = await seed(host);
		const initialRequests = f.requests.length;
		assert.equal(initialRequests, 1);

		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
		const b = binding(owner);

		b.installProjector((_frame) => {
			throw new Error("GATE_BLOCKED_POLICY");
		});

		const blockedReceipt = await user.submit({ key: "blocked-run", text: "FAIL-CLOSED" });
		await host.waitForIdle();

		// Hard invariant: zero additional provider calls!
		assert.equal(f.requests.length, initialRequests, "Gate must block before any HTTP dispatch");
		assert.equal(host.view().phase, "failed");
		assert.equal(user.receipt(blockedReceipt.id)?.state, "committed");
	} finally {
		await f.close();
	}
});

test("A-05 & F-15: Two strategies independently append to separate artifact namespaces", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		await seed(host);
		const ownerA = host.connect("principalA", ["context_artifacts.write"]);
		const ownerB = host.connect("principalB", ["context_artifacts.write"]);

		ownerA.activateStrategy({ id: "strategyA", hooks: ["context_artifacts.write"] });
		ownerB.activateStrategy({ id: "strategyB", hooks: ["context_artifacts.write"] });

		const bA = binding(ownerA, "strategyA");
		const bB = binding(ownerB, "strategyB");

		const frameA = bA.readFrame();
		const frameB = bB.readFrame();

		// Append to namespace A
		const receiptA = bA.artifacts.append(frameA.basis, {
			expectedVersion: 0,
			records: [{ data: "from-A" }],
		});
		assert.equal(receiptA.status, "committed");
		assert.equal(receiptA.version, 1);

		// Append to namespace B independently
		const receiptB = bB.artifacts.append(frameB.basis, {
			expectedVersion: 0,
			records: [{ data: "from-B" }],
		});
		assert.equal(receiptB.status, "committed");
		assert.equal(receiptB.version, 1);

		// Read back each namespace
		const rebasedA = bA.readFrame();
		const rebasedB = bB.readFrame();
		assert.deepEqual(bA.artifacts.read(rebasedA.basis).records, [{ data: "from-A" }]);
		assert.deepEqual(bB.artifacts.read(rebasedB.basis).records, [{ data: "from-B" }]);
	} finally {
		await f.close();
	}
});

test("A-04: Projection plan with summary: null omits source range without placeholder and preserves raw history", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const user = host.connect("user", ["input.submit"]);
		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });

		await user.submit({ key: "m1", text: "MESSAGE-TO-OMIT" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 1);

		const b = binding(owner);
		const frame = b.readFrame();
		const targetEntry = frame.projection.find((e) => JSON.stringify(e.messages).includes("MESSAGE-TO-OMIT"));
		assert.ok(targetEntry, "Target entry must exist in projection");

		b.installProjector((fr) => ({
			status: "apply",
			basis: fr.basis,
			replacements: [{ sourceEntryIds: [targetEntry.sourceEntryId], summary: null }],
		}));

		await user.submit({ key: "m2", text: "AFTER-OMISSION" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 2);

		const req2 = f.requests[1];
		assert.match(text(req2), /AFTER-OMISSION/);
		assert.doesNotMatch(text(req2), /MESSAGE-TO-OMIT/);
		assert.doesNotMatch(text(req2), /Host strategy summary/);

		// Verify physical storage readback retains raw history
		const diskRaw = await raw(host);
		assert.match(diskRaw, /MESSAGE-TO-OMIT/);
	} finally {
		await f.close();
	}
});

test("A-07: Tool execution occurs exactly once without duplicate side effects", async () => {
	let executed = 0;
	const f = await fixture(
		{
			tools: [
				{
					name: "counting_tool",
					description: "Tool with side effect",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						executed++;
						return "RESULT_OK";
					},
				},
			],
		},
		(_p, n) => (n === 1 ? { tool: "counting_tool" } : { text: "FINAL_ANSWER" }),
	);
	try {
		const host = await f.start();
		const user = host.connect("user", ["input.submit"]);
		await user.submit({ key: "run-tool", text: "INVOKE" });
		await host.waitForIdle();

		assert.equal(executed, 1, "Tool must execute exactly once");
		assert.equal(f.requests.length, 2, "Tool round requires tool call + follow-up request");
		assert.match(text(f.requests[1]), /RESULT_OK/);
	} finally {
		await f.close();
	}
});

test("A-03: Submission idempotency prevents second execution on identical payload", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const user = host.connect("user", ["input.submit"]);

		const r1 = await user.submit({ key: "dup-key", text: "PAYLOAD" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 1);

		const r2 = await user.submit({ key: "dup-key", text: "PAYLOAD" });
		assert.equal(r2.id, r1.id);
		assert.equal(r2.state, "committed");
		assert.equal(f.requests.length, 1);

		await assert.rejects(user.submit({ key: "dup-key", text: "DIFFERENT_PAYLOAD" }), /conflict/i);
		assert.equal(f.requests.length, 1);
	} finally {
		await f.close();
	}
});

test(
	"concurrent initial submissions do not let waitForIdle return before dispatch",
	{ timeout: 30000 },
	async () => {
		const fixtures = await Promise.all(Array.from({ length: 64 }, () => fixture()));
		try {
			const hosts = await Promise.all(fixtures.map((f) => f.start()));
			await Promise.all(
				hosts.map(async (host, index) => {
					const user = host.connect("user", ["input.submit"]);
					await user.submit({ key: "concurrent-" + index, text: "CONCURRENT-" + index });
					await host.waitForIdle();
					assert.equal(
						fixtures[index].requests.length,
						1,
						JSON.stringify({ index, view: host.view(), errors: fixtures[index].errors.map(String) }),
					);
				}),
			);
		} finally {
			await Promise.all(fixtures.map((f) => f.close()));
		}
	},
);

test("Durable entry frames preserve linear parentage", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const user = host.connect("user", ["input.submit"]);
		await user.submit({ key: "parentage", text: "PARENTAGE" });
		await host.waitForIdle();

		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "parentage-strategy", hooks: ["real_context.write"] });
		const entries = owner.bindStrategy("parentage-strategy").readFrame().entries;
		assert.ok(entries.length >= 3);
		assert.equal(entries[0].parentId, null);
		for (let i = 1; i < entries.length; i++) assert.equal(entries[i].parentId, entries[i - 1].id);
	} finally {
		await f.close();
	}
});

// This exercises 501 real generations plus growing JSONL readback; completion counts, not latency, are the contract.
test("context views retain entries beyond Durable scan page size", { timeout: 180000 }, async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const user = host.connect("user", ["input.submit"]);
		for (let i = 0; i < 501; i++) {
			await user.submit({ key: "history-" + i, text: "HISTORY-" + i });
			await host.waitForIdle();
		}
		const view = host.view();
		assert.equal(view.entries.length, 1003);
		assert.equal(view.context.length, 1003);
	} finally {
		await f.close();
	}
});
