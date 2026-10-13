import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	createMas,
	createApprovedSessions,
	inProcessPlacement,
	type ApprovedSessionTemplate,
} from "../src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

for (const instances of [1, 2])
	test(
		`M4 review: 40 distinct slots contend on real CAS with ${instances} service instance(s)`,
		{ timeout: 30000 },
		async () => {
			const m = await runtimeFixture(
				{},
				{ maxConversations: 64, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
			);
			try {
				const mas = await createMas({
					runtime: m.runtime,
					namespace: "source",
					maxDeliveries: 8,
					maxPending: 2,
				});
				await mas.bootstrap([{ key: "a", owner: "operator" }]);
				await mas.activate();
				const ref = (await mas.view()).members[0]!.ref,
					client = mas.connect({ principal: "a", source: ref, grants: ["spawn"] });
				const source = inProcessPlacement({
					runtime: m.runtime,
					namespace: "source",
					maxDeliveries: 8,
					maxPending: 2,
				});
				const templates: Record<string, ApprovedSessionTemplate> = {};
				for (let i = 0; i < 40; i++) {
					const key = "slot-" + i;
					templates[key] = {
						location: "existing-session",
						principal: "a",
						source: ref,
						targetKey: "b",
						plan: [
							{ key: "a", placement: "source", owner: "operator" },
							{ key: "b", placement: "target", owner: "a" },
						],
						broker: {
							namespace: key,
							store: m.runtime.store({ namespace: "broker-" + i, maxBytes: 65536 }),
							maxMembers: 2,
							maxMessages: 2,
							placements: {
								source,
								target: inProcessPlacement({
									runtime: m.runtime,
									namespace: key,
									maxDeliveries: 2,
									maxPending: 1,
								}),
							},
						},
					};
				}
				const store = m.runtime.store({ namespace: "contended-slots", maxBytes: 131072 });
				const provisioners = Array.from({ length: instances }, () =>
					createApprovedSessions({ store, templates }),
				);
				const results = await Promise.allSettled(
					Object.keys(templates).map((template, index) =>
						provisioners[index % instances]!.request(client, {
							template,
							requestId: "one",
							location: "existing-session",
						}),
					),
				);
				assert.equal(
					results.filter((result) => result.status === "rejected").length,
					0,
					results
						.map((result) => (result.status === "rejected" ? String(result.reason) : result.value.status))
						.join(","),
				);
				const receipts = results.map((result) => {
					assert.equal(result.status, "fulfilled");
					return result.value;
				});
				assert.equal(receipts.filter((receipt) => receipt.status === "created").length, 40);
				assert.equal(new Set(receipts.map((receipt) => receipt.ref!.conversation.conversationId)).size, 40);
				const snapshot = await store.snapshot(),
					claims = snapshot.data.claims;
				assert.ok(claims && typeof claims === "object");
				assert.equal(Object.keys(claims).length, 40);
				assert.ok(snapshot.version >= 80);
				assert.equal(m.f.requests.length, 0);
				assert.equal(m.f.errors.length, 0);
			} finally {
				await m.close();
			}
		},
	);
