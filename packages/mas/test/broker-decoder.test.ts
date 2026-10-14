import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createBroker, inProcessPlacement } from "../src/index.ts";
import type { JsonObject } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

// Missing nested validation would publish a forged native result and later pass it to endpoint.wait.
test(
	"M5: restore rejects malformed or foreign native receipts on real coordinator storage before routing",
	{ timeout: 20000 },
	async () => {
		const c = await runtimeFixture(),
			target = await runtimeFixture();
		try {
			const store = c.runtime.store({ namespace: "restore", maxBytes: 65536 });
			const options = {
				namespace: "restore",
				maxMembers: 2,
				maxMessages: 8,
				store,
				placements: {
					one: inProcessPlacement({
						runtime: target.runtime,
						namespace: "members",
						maxDeliveries: 8,
						maxPending: 2,
					}),
				},
			};
			const broker = await createBroker(options);
			await broker.bootstrap([{ key: "peer", placement: "one", owner: "operator" }]);
			await broker.activate();
			const ref = (await broker.view()).members[0]!.ref!;
			const sender = broker.connect({ principal: "operator", source: null, grants: ["send"] });
			const delivered = await sender.send(ref, { requestId: "original", text: "ORIGINAL-REAL-ADMISSION" });
			const done = await sender.wait(delivered.id);
			assert.equal(done.status, "done");
			assert.equal(target.f.requests.length, 1);
			const saved = (await store.snapshot()).data;
			const corruptions: readonly ((native: Record<string, unknown>) => void)[] = [
				(native) => {
					native.id = "";
				},
				(native) => {
					native.requestId = "foreign-request";
				},
				(native) => {
					native.principal = "foreign-principal";
				},
				(native) => {
					native.target = { ...ref.conversation, conversationId: "foreign-conversation" };
				},
				(native) => {
					native.source = ref.conversation;
				},
				(native) => {
					native.status = "pending";
				},
				(native) => {
					native.reason = 123;
				},
				(native) => {
					native.entryId = { forged: true };
				},
			];
			for (const corrupt of corruptions) {
				const value: JsonObject = JSON.parse(JSON.stringify(saved));
				const outbox = value.outbox as Record<string, { receipt: { native: Record<string, unknown> } }>;
				corrupt(outbox[done.id]!.receipt.native);
				await store.compareAndSet((await store.snapshot()).version, value, () => {});
				await assert.rejects(async () => {
					const restored = await createBroker(options);
					await restored.view();
				}, /native receipt|provenance/i);
				assert.equal(target.f.requests.length, 1);
			}
			await store.compareAndSet((await store.snapshot()).version, saved, () => {});
			const reopened = await createBroker(options),
				fresh = reopened.connect({ principal: "operator", source: null, grants: ["send"] });
			assert.equal((await fresh.wait(done.id)).status, "done");
			assert.equal(target.f.requests.length, 1);
		} finally {
			await c.close();
			await target.close();
		}
	},
);
