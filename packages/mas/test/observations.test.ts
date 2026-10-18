import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMas } from "../src/index.ts";

test("MAS observations: creation records the requesting Conversation, separately from ownership and fork history", async () => {
	const m = await runtimeFixture();
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "provenance",
			maxDeliveries: 16,
			maxPending: 4,
		});
		await mas.bootstrap([
			{ key: "a", owner: "human-owner" },
			{ key: "owner-only", owner: "different-owner" },
		]);
		await mas.activate();
		const a = (await mas.view()).members[0]!;
		const creator = mas.connect({ principal: "a-creation-authority", source: a.ref, grants: ["spawn"] });
		const b = await creator.spawn({ key: "b" });
		assert.deepEqual(
			b.creation?.source,
			a.ref,
			"A recorded request source, not an owner-principal match, establishes a creation edge",
		);
		assert.equal(b.owner, "a-creation-authority");
		assert.equal(b.creation?.kind, "create");
		assert.ok(Number.isSafeInteger(b.creation?.at));
		assert.equal(
			(await mas.view()).members[1]!.creation?.source,
			null,
			"A bootstrap has no requesting Conversation",
		);
		assert.ok(Object.isFrozen(b.creation));
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("MAS observations: human attribution, reply association and native receipts survive reopen without replay", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	const options = { namespace: "communication", maxDeliveries: 16, maxPending: 4 };
	try {
		const mas = await createMas({ runtime: m.runtime, ...options });
		await mas.bootstrap([
			{ key: "a", owner: "owner" },
			{ key: "b", owner: "owner" },
		]);
		await mas.activate();
		const [a, b] = (await mas.view()).members;
		const human = mas.connect({
			principal: "human-owner",
			source: a!.ref,
			grants: ["send", "observe"],
			initiator: { kind: "human", id: "human-owner" },
		});
		const sent = await human.send(b!.ref, { requestId: "question", text: "OBSERVED-QUESTION" });
		await human.wait(sent.id);
		const restoredCaller = mas.connect({
			principal: "human-owner",
			source: a!.ref,
			grants: ["send"],
			initiator: { kind: "service", id: "reconciler" },
		});
		assert.equal(
			(await restoredCaller.send(b!.ref, { requestId: "question", text: "OBSERVED-QUESTION" })).id,
			sent.id,
		);
		assert.deepEqual(
			(await mas.history({}, () => {})).items[0]!.initiator,
			{ kind: "human", id: "human-owner" },
			"Reconciliation preserves the original initiator rather than creating or relabeling input",
		);
		assert.equal(m.f.requests.length, 1);
		const responder = mas.connect({ principal: "b", source: b!.ref, grants: ["reply", "observe"] });
		const reply = await responder.reply(sent.id, { requestId: "answer", text: "OBSERVED-ANSWER" });
		await responder.wait(reply.id);
		const first = await mas.history({ limit: 1 }, () => {});
		assert.equal(first.items.length, 1);
		assert.equal(first.items[0]!.receipt.id, reply.id);
		assert.equal(first.items[0]!.replyTo, sent.id);
		assert.equal(first.items[0]!.text, "OBSERVED-ANSWER");
		assert.ok(first.nextCursor);
		assert.ok(Object.isFrozen(first.items[0]));
		const older = await mas.history({ limit: 1, cursor: first.nextCursor }, () => {});
		assert.equal(older.items[0]!.receipt.id, sent.id);
		assert.deepEqual(older.items[0]!.initiator, { kind: "human", id: "human-owner" });
		assert.ok(Number.isSafeInteger(older.items[0]!.at));
		assert.equal(older.nextCursor, undefined);
		const calls = m.f.requests.length,
			budget = m.runtime.view().budget.primaryAttempts;
		assert.equal(calls, 2);
		await assert.rejects(
			mas.history({ limit: 65 }, () => {}),
			/bounded|limit|query/i,
		);
		await assert.rejects(
			mas.history({ cursor: "not-a-receipt" }, () => {}),
			/cursor/i,
		);
		let checks = 0;
		await assert.rejects(
			mas.history({}, () => {
				if (++checks > 1) throw Error("REVOKED-OBSERVER");
			}),
			/REVOKED-OBSERVER/,
		);
		assert.equal(m.f.requests.length, calls);
		assert.equal(m.runtime.view().budget.primaryAttempts, budget);
		const sessionFile = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: sessionFile });
		const restored = await createMas({ runtime: reopened, ...options });
		assert.deepEqual(
			(await restored.history({}, () => {})).items.map((row) => [
				row.receipt.id,
				row.text,
				row.replyTo,
				row.at,
			]),
			[first.items[0], older.items[0]].map((row) => [row!.receipt.id, row!.text, row!.replyTo, row!.at]),
		);
		await reopened.waitForIdle();
		assert.equal(m.f.requests.length, calls);
		assert.equal(reopened.view().budget.primaryAttempts, budget);
	} finally {
		await reopened?.close();
		await m.close();
	}
});
