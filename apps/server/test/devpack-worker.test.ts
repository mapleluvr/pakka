import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createWorkerManager } from "../src/worker-manager.ts";
import { createBroker } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { fixture, text } from "../../../packages/agent/test/fixture.ts";

test(
	"M4 worker: approved DevPack profile executes real native temporary spawn in another PID",
	{ timeout: 20000 },
	async () => {
		const f = await fixture({}, (payload) => {
			const outputs = payload.messages.filter((message) => message.role === "tool");
			if (!text(payload).includes("WORKER-TOOL-SPAWN")) return { text: "finished" };
			if (outputs.length === 0)
				return { tool: "mas_spawn", args: { key: "child", profile: "default", lifetime: "temporary" } };
			if (outputs.length === 1) {
				let child: unknown;
				try {
					child = JSON.parse(String(outputs[0]!.content));
				} catch {
					return { text: "invalid child" };
				}
				if (child && typeof child === "object" && "ref" in child)
					return { tool: "mas_inspect", args: { target: child.ref } };
			}
			return { text: "finished" };
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
					reservedSessionId: "33333333-3333-3333-3333-333333333333",
					limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
					profiles: [{ id: "pack", systemPrompt: "WORKER-PACK" }],
				},
				catalog: { namespace: "members", maxDeliveries: 8, maxPending: 2 },
				devpack: { profiles: { pack: ["spawn" as const, "observe" as const] } },
			};
			manager = createWorkerManager({
				placements: { one: preset },
				maxWorkers: 1,
				startupTimeoutMs: 10000,
				requestTimeoutMs: 10000,
			});
			const broker = await createBroker({
				namespace: "devpack-worker",
				store: c.runtime.store({ namespace: "worker-store", maxBytes: 65536 }),
				maxMembers: 2,
				maxMessages: 8,
				placements: { one: manager.placement("one") },
			});
			await broker.bootstrap([{ key: "a", placement: "one", owner: "operator", profile: "pack" }]);
			await broker.activate();
			const a = (await broker.view()).members[0]!.ref!,
				client = broker.connect({ principal: "operator", source: null, grants: ["send"] });
			const receipt = await client.send(a, { requestId: "spawn", text: "WORKER-TOOL-SPAWN" });
			assert.equal((await client.wait(receipt.id)).status, "done");
			const view = await (await manager.placement("one").open(a.sessionId)).view();
			const child = view.mas.members.find((member) => member.key === "child");
			assert.ok(
				child,
				JSON.stringify(f.requests.at(-1)?.messages.filter((message) => message.role === "tool")),
			);
			assert.equal(child.lifetime, "temporary");
			const inspected = JSON.parse(
				String(f.requests.at(-1)!.messages.filter((message) => message.role === "tool")[1]!.content),
			);
			assert.equal(inspected.phase, "ended");
			const endpoint = await manager.placement("one").open(a.sessionId);
			await assert.rejects(
				endpoint.deliver({
					id: "ended-child",
					principal: "operator",
					source: null,
					target: { key: "child", placement: "one", sessionId: a.sessionId, conversation: child.ref },
					input: { requestId: "late", text: "NO-ENDED-HTTP" },
				}),
				/owner|ended/i,
			);
			assert.match(child.owner, /^worker-agent-/);
			assert.notEqual(child.owner, "operator");
			assert.notEqual(manager.view()[0]!.pid, process.pid);
			assert.equal(f.requests.length, 3);
			assert.ok(
				(f.requests[0]!.tools as { function: { name: string } }[]).some(
					(tool) => tool.function.name === "mas_spawn",
				),
			);
			assert.equal(f.errors.length, 0);
		} finally {
			await manager?.close();
			await c.close();
			await f.close();
		}
	},
);

test(
	"M6 worker: unselected native profile does not inherit root contribution tools",
	{ timeout: 20000 },
	async () => {
		const f = await fixture({}, () => ({ text: "PLAIN-WORKER-LOCAL" })),
			c = await runtimeFixture();
		let manager: ReturnType<typeof createWorkerManager> | undefined;
		try {
			manager = createWorkerManager({
				placements: {
					one: {
						runtime: {
							cwd: f.cwd,
							dataDir: f.dataDir,
							endpoint: f.endpoint,
							model: "local-model",
							apiKey: "local-only",
							reservedSessionId: "33333333-3333-3333-3333-333333333333",
							limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
							profiles: [{ id: "plain", systemPrompt: "PLAIN-WORKER" }],
						},
						catalog: { namespace: "members", maxDeliveries: 8, maxPending: 2 },
						devpack: { profiles: { default: ["discover"] } },
					},
				},
				maxWorkers: 1,
				startupTimeoutMs: 10000,
				requestTimeoutMs: 10000,
			});
			const broker = await createBroker({
				namespace: "profile-selection",
				store: c.runtime.store({ namespace: "profile-store", maxBytes: 65536 }),
				maxMembers: 2,
				maxMessages: 8,
				placements: { one: manager.placement("one") },
			});
			await broker.bootstrap([{ key: "plain", placement: "one", owner: "operator", profile: "plain" }]);
			await broker.activate();
			const target = (await broker.view()).members[0]!.ref!,
				client = broker.connect({ principal: "operator", source: null, grants: ["send"] });
			const receipt = await client.send(target, { requestId: "plain", text: "NO-ROOT-TOOLS" });
			assert.equal((await client.wait(receipt.id)).status, "done");
			assert.notEqual(manager.view()[0]!.pid, process.pid);
			assert.equal(f.requests.length, 1);
			assert.deepEqual(f.requests[0]!.tools ?? [], []);
			assert.equal(f.errors.length, 0);
		} finally {
			await manager?.close();
			await c.close();
			await f.close();
		}
	},
);
