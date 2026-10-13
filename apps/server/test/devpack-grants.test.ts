import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createWorkerManager } from "../src/worker-manager.ts";
import { createBroker } from "@pakka/mas";
import type { ConversationRef } from "@pakka/agent";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { fixture, text } from "../../../packages/agent/test/fixture.ts";

test(
	"M4 worker: spawn cannot acquire a child's higher-profile communication grant",
	{ timeout: 20000 },
	async () => {
		let peer!: ConversationRef;
		const f = await fixture({}, (payload) => {
			if (payload.messages.some((message) => message.role === "tool")) return { text: "finished" };
			if (text(payload).includes("LOW-SPAWN"))
				return { tool: "mas_spawn", args: { key: "child", profile: "high", lifetime: "persistent" } };
			if (text(payload).includes("HIGH-CHILD"))
				return {
					tool: "mas_send",
					args: { target: peer, requestId: "privileged", text: "MUST-NOT-REACH-PEER" },
				};
			return { text: "peer received" };
		});
		const c = await runtimeFixture();
		let manager: ReturnType<typeof createWorkerManager> | undefined;
		try {
			const preset = {
				runtime: {
					cwd: f.cwd,
					dataDir: f.dataDir,
					endpoint: f.endpoint,
					model: "local-model",
					apiKey: "local-only",
					reservedSessionId: "55555555-5555-5555-5555-555555555555",
					limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
					profiles: [
						{ id: "low", systemPrompt: "LOW" },
						{ id: "high", systemPrompt: "HIGH" },
					],
				},
				catalog: { namespace: "members", maxDeliveries: 8, maxPending: 2 },
				devpack: { profiles: { low: ["spawn" as const], high: ["send" as const] } },
			};
			manager = createWorkerManager({
				placements: { one: preset },
				maxWorkers: 1,
				startupTimeoutMs: 10000,
				requestTimeoutMs: 10000,
			});
			const broker = await createBroker({
				namespace: "privilege-worker",
				store: c.runtime.store({ namespace: "privilege-worker", maxBytes: 65536 }),
				maxMembers: 2,
				maxMessages: 8,
				placements: { one: manager.placement("one") },
			});
			await broker.bootstrap([
				{ key: "a", placement: "one", owner: "operator", profile: "low" },
				{ key: "b", placement: "one", owner: "operator" },
			]);
			await broker.activate();
			const [a, b] = (await broker.view()).members.map((member) => member.ref!);
			peer = b!.conversation;
			const client = broker.connect({ principal: "operator", source: null, grants: ["send"] });
			await client.wait((await client.send(a!, { requestId: "create", text: "LOW-SPAWN" })).id);
			const endpoint = await manager.placement("one").open(a!.sessionId),
				child = (await endpoint.view()).mas.members.find((member) => member.key === "child")!;
			assert.ok(child);
			const target = { key: "child", placement: "one", sessionId: a!.sessionId, conversation: child.ref };
			const envelope = {
				id: "high-child",
				principal: "operator",
				source: null,
				target,
				input: { requestId: "high-child", text: "HIGH-CHILD" },
			};
			const receipt = await endpoint.deliver(envelope);
			await endpoint.wait(envelope, receipt.id);
			assert.equal(
				f.requests.filter((payload) =>
					payload.messages.some(
						(message) => message.role === "user" && String(message.content).includes("MUST-NOT-REACH-PEER"),
					),
				).length,
				0,
				"Model acquired send by selecting another profile",
			);
			assert.equal(f.requests.length, 4);
			assert.equal(f.errors.length, 0);
		} finally {
			await manager?.close();
			await c.close();
			await f.close();
		}
	},
);
