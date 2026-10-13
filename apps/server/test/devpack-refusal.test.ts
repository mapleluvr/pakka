import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createWorkerManager } from "../src/worker-manager.ts";
import { createBroker } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { fixture } from "../../../packages/agent/test/fixture.ts";

test(
	"M4 review: worker without Session service explicitly denies spawn and inbox before effects",
	{ timeout: 20000 },
	async () => {
		const f = await fixture({}, (payload) => {
			const outputs = payload.messages.filter((message) => message.role === "tool");
			if (outputs.length === 0)
				return {
					tool: "mas_spawn",
					args: { location: "new-session", template: "unavailable", requestId: "refusal" },
				};
			if (outputs.length === 1) return { tool: "mas_inbox", args: { sessionTemplate: "unavailable" } };
			return { text: "finished" };
		});
		const c = await runtimeFixture();
		let manager: ReturnType<typeof createWorkerManager> | undefined;
		try {
			manager = createWorkerManager({
				maxWorkers: 1,
				startupTimeoutMs: 10000,
				requestTimeoutMs: 10000,
				placements: {
					one: {
						runtime: {
							cwd: f.cwd,
							dataDir: f.dataDir,
							endpoint: f.endpoint,
							model: "local-model",
							apiKey: "local-only",
							reservedSessionId: "66666666-6666-6666-6666-666666666666",
							limits: { maxConversations: 2, maxPrimaryAttempts: 5, maxAuxiliaryAttempts: 1 },
							profiles: [{ id: "pack", systemPrompt: "REFUSAL" }],
						},
						catalog: { namespace: "members", maxDeliveries: 4, maxPending: 2 },
						devpack: { profiles: { pack: ["spawn", "reply"] } },
					},
				},
			});
			const broker = await createBroker({
				namespace: "refusal",
				store: c.runtime.store({ namespace: "refusal", maxBytes: 65536 }),
				maxMembers: 1,
				maxMessages: 4,
				placements: { one: manager.placement("one") },
			});
			await broker.bootstrap([{ key: "a", placement: "one", owner: "operator", profile: "pack" }]);
			await broker.activate();
			const a = (await broker.view()).members[0]!.ref!,
				client = broker.connect({ principal: "operator", source: null, grants: ["send"] });
			await client.wait((await client.send(a, { requestId: "refusal", text: "NO-SESSION-SERVICE" })).id);
			const outputs = f.requests
				.at(-1)!
				.messages.filter((message) => message.role === "tool")
				.map((message) => JSON.parse(String(message.content)));
			assert.deepEqual(
				outputs.map((output) => output.status),
				["denied", "denied"],
			);
			const view = await (await manager.placement("one").open(a.sessionId)).view();
			assert.equal(view.mas.members.length, 1);
			assert.equal(manager.view().length, 1);
			assert.equal(f.requests.length, 3);
			assert.equal(c.f.requests.length, 0);
			assert.equal(f.errors.length, 0);
		} finally {
			await manager?.close();
			await c.close();
			await f.close();
		}
	},
);
