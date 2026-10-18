import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { createClient } from "@pakka/client";
import { createBroker } from "@pakka/mas";
import { bootstrapServer, decodeBootstrap } from "../src/bootstrap.ts";
import { createWorkerManager } from "../src/worker-manager.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

// Valid model choices must survive both strict startup decode and actual HTTP delivery.
test("Model consumers: finite server bootstrap keeps the approved model through real HTTP delivery", async () => {
	const m = await runtimeFixture();
	let app: Awaited<ReturnType<typeof bootstrapServer>> | undefined;
	try {
		await m.runtime.close();
		const token = "local-model-consumer-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		app = await bootstrapServer(
			decodeBootstrap({
				schema: "pakka.server.v1",
				runtime: {
					...m.config,
					profiles: [
						{
							id: "alternate",
							systemPrompt: "APPROVED-MODEL",
							model: "alternate-local-model",
							cwd: process.cwd(),
						},
					],
				},
				mas: { namespace: "model-consumer", maxDeliveries: 8, maxPending: 2 },
				members: [{ key: "member", owner: "operator", profile: "alternate" }],
				roles: [{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] }],
			}),
		);
		const client = createClient({ endpoint: app.server.endpoint, token }),
			member = (await client.reconnect()).members[0]!;
		const admitted = await client.request({
			op: "send",
			target: member.ref,
			input: { requestId: "model", text: "SERVER-MODEL-WORK" },
		});
		if (admitted.kind !== "receipt") assert.fail("Missing native admission");
		const done = await client.request({ op: "wait", id: admitted.receipt.id });
		if (done.kind !== "receipt") assert.fail("Missing native result");
		assert.equal(done.receipt.status, "done");
		assert.equal(m.f.requests.length, 1);
		assert.equal(m.f.requests[0]?.model, "alternate-local-model");
	} finally {
		await app?.close();
		await m.close();
	}
});

// A worker has a separate decode and provider registry; testing only the in-process Runtime misses either omission.
test(
	"Model consumers: a real worker PID receives the exact host-approved model",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		let manager: ReturnType<typeof createWorkerManager> | undefined;
		try {
			manager = createWorkerManager({
				maxWorkers: 1,
				startupTimeoutMs: 10000,
				requestTimeoutMs: 10000,
				placements: {
					one: {
						runtime: {
							...m.config,
							dataDir: join(m.f.root, "worker-model"),
							reservedSessionId: "88888888-8888-4888-8888-888888888888",
							profiles: [
								{
									id: "alternate",
									systemPrompt: "WORKER-MODEL",
									model: "alternate-local-model",
									cwd: process.cwd(),
								},
							],
						},
						catalog: { namespace: "model-worker", maxDeliveries: 8, maxPending: 2 },
					},
				},
			});
			const broker = await createBroker({
				namespace: "model-worker",
				store: m.runtime.store({ namespace: "worker-model", maxBytes: 65536 }),
				maxMembers: 2,
				maxMessages: 8,
				placements: { one: manager.placement("one") },
			});
			await broker.bootstrap([{ key: "member", placement: "one", owner: "operator", profile: "alternate" }]);
			await broker.activate();
			const member = (await broker.view()).members[0]!.ref!,
				client = broker.connect({ principal: "operator", source: null, grants: ["send"] });
			const receipt = await client.send(member, { requestId: "model", text: "WORKER-MODEL-WORK" });
			assert.equal((await client.wait(receipt.id)).status, "done");
			assert.notEqual(manager.view()[0]!.pid, process.pid);
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.requests[0]?.model, "alternate-local-model");
		} finally {
			await manager?.close();
			await m.close();
		}
	},
);
