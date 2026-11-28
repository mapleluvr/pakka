import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketCollaboration } from "../src/pocket-collaboration.ts";
import {
	decodeSessionBudgetChange,
	decodeSessionBudgetReceipt,
} from "../../../packages/protocol/src/webui-budget.ts";

test("personal mode bypasses an expired human driver and collaboration restart never resurrects it", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "personal-test" });
		const login = await people.initializeOwner("Owner"),
			actor = await people.authenticate(login.token);
		let now = Date.now();
		const collaboration = await createPocketCollaboration({
			runtime: m.runtime,
			people,
			namespace: "collaboration-test",
			now: () => now,
		});
		const ref = m.runtime.view().conversations[0]!;
		const client = collaboration.bind(actor);
		await client.setDriver(ref, { expectedVersion: 0, action: "claim", ttlMs: 10000 });
		now += 20000;
		assert.throws(() => collaboration.checkInput(actor, ref), /expired/);
		await people.change(actor, {
			requestId: "personal",
			action: { op: "mode.set", mode: "personal", expectedVersion: (await people.settings(actor)).version },
		});
		assert.doesNotThrow(() => collaboration.checkInput(actor, ref));
		await assert.rejects(client.snapshot(ref), /Personal mode/);
		await assert.rejects(client.presence(ref, { state: "here" }), /Personal mode/);
		await assert.rejects(
			client.setDriver(ref, { expectedVersion: 1, action: "claim", ttlMs: 10000 }),
			/Personal mode/,
		);
		await people.change(actor, {
			requestId: "collaboration",
			action: {
				op: "mode.set",
				mode: "collaboration",
				expectedVersion: (await people.settings(actor)).version,
			},
		});
		assert.doesNotThrow(() => collaboration.checkInput(actor, ref));
		await client.setDriver(ref, { expectedVersion: 1, action: "claim", ttlMs: 10000 });
		now += 20000;
		assert.throws(() => collaboration.checkInput(actor, ref), /expired/);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("an empty budget note retains its exact receipt and automatic audit fields through reopen", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const before = await m.runtime.budgetPolicy(() => {});
		const change = decodeSessionBudgetChange({
			requestId: "blank-note",
			expectedVersion: before.version,
			limits: { maxConversations: 0, maxPrimaryAttempts: 0, maxAuxiliaryAttempts: 0 },
			reason: "",
		});
		const receipt = await m.runtime.changeBudget({ actorId: "owner", ...change }, () => {});
		assert.equal(receipt.reason, "");
		assert.equal(receipt.actorId, "owner");
		assert.ok(receipt.at > 0);
		const wire = receipt;
		assert.deepEqual(decodeSessionBudgetReceipt(wire), wire);
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		const saved = await reopened.budgetReceipt({ actorId: "owner", requestId: change.requestId }, () => {});
		assert.deepEqual(saved, receipt);
		assert.equal((await reopened.budgetHistory({}, () => {})).items[0]!.reason, "");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});
