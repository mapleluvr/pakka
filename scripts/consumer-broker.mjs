import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createBroker } from "@pakka/mas/broker";
import { createWorkerManager } from "@pakka/server";
const consumer = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	errors = [];
const server = createServer((req, res) => {
	void (async () => {
		let data = "";
		for await (const chunk of req) data += chunk;
		try {
			requests.push(JSON.parse(data));
		} catch (error) {
			errors.push(String(error));
			res.destroy(error);
			return;
		}
		res.writeHead(200, { "content-type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "BROKER-ANSWER" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "broker-local",
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
					}) +
					"\n\n",
			);
		res.end("data: [DONE]\n\n");
	})().catch((error) => {
		errors.push(String(error));
		res.destroy(error);
	});
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = "http://127.0.0.1:" + server.address().port + "/v1";
async function preset(key, reservedSessionId) {
	const cwd = join(consumer, "broker-" + key + "-workspace"),
		dataDir = join(consumer, "broker-" + key + "-data");
	await mkdir(cwd);
	await mkdir(dataDir);
	return {
		runtime: {
			cwd,
			dataDir,
			endpoint,
			apiKey: "local-only",
			model: "local",
			systemPrompt: "BROKER-" + key,
			reservedSessionId,
			limits: { maxConversations: 4, maxPrimaryAttempts: 4, maxAuxiliaryAttempts: 1 },
		},
		catalog: { namespace: "crew", maxDeliveries: 8, maxPending: 2 },
	};
}
const one = await preset("one", "63078548-dcc0-430b-b572-787bff5e2358"),
	two = await preset("two", "7b1fc8a7-83d2-420b-a5da-36cf5770db81"),
	control = await preset("control", "cf11b92f-8cc7-463e-8e45-272f990beeb4");
const workerOptions = {
	placements: { one, two },
	maxWorkers: 2,
	startupTimeoutMs: 15000,
	requestTimeoutMs: 15000,
};
const plan = [
	{ key: "a", placement: "one", owner: "operator" },
	{ key: "b", placement: "two", owner: "operator" },
];
let runtime, manager, restored;
function options(current, workers, loss = false) {
	const normal = workers.placement("two");
	let lose = loss;
	return {
		namespace: "crew",
		maxMembers: 4,
		maxMessages: 3,
		store: current.store({ namespace: "broker", maxBytes: 65536 }),
		placements: {
			one: workers.placement("one"),
			two: {
				open: async (expected) => {
					const port = await normal.open(expected);
					return {
						...port,
						deliver: async (envelope, signal) => {
							const native = await port.deliver(envelope, signal);
							if (lose) {
								lose = false;
								await port.wait(envelope, native.id);
								throw new Error("lost real worker admission response");
							}
							return native;
						},
					};
				},
			},
		},
	};
}
try {
	runtime = await createRuntime(control.runtime);
	manager = createWorkerManager(workerOptions);
	const broker = await createBroker(options(runtime, manager, true));
	await broker.bootstrap(plan);
	assert.equal(requests.length, 0);
	const [a, b] = (await broker.view()).members.map((member) => member.ref);
	const sender = broker.connect({ principal: "a", source: a, grants: ["send"] });
	await assert.rejects(sender.send(b, { requestId: "early", text: "NO-EARLY-BUSINESS" }), /active/);
	await broker.activate();
	const initialWorkers = manager.view();
	assert.equal(initialWorkers.length, 2);
	assert.notEqual(initialWorkers[0].pid, process.pid);
	assert.notEqual(initialWorkers[1].pid, process.pid);
	assert.notEqual(initialWorkers[0].pid, initialWorkers[1].pid);
	const input = { requestId: "first", text: "REAL-WORKER-A-TO-B" };
	const uncertain = await sender.send(b, input);
	assert.equal(uncertain.status, "unknown");
	assert.equal(requests.length, 1);
	const sessionFile = runtime.view().sessionFile;
	await runtime.close();
	await manager.close();
	await assert.rejects(sender.send(b, { requestId: "old", text: "OLD-AUTHORITY" }), /closed|Runtime/);
	restored = await createRuntime({ ...control.runtime, reopenSessionFile: sessionFile });
	manager = createWorkerManager(workerOptions);
	const recovered = await createBroker(options(restored, manager));
	assert.equal((await recovered.bootstrap(plan)).phase, "active");
	const current = recovered.connect({ principal: "a", source: a, grants: ["send"] });
	const done = await current.wait(uncertain.id);
	assert.equal(done.status, "done");
	assert.equal(requests.length, 1);
	assert.equal((await current.send(b, input)).id, uncertain.id);
	await assert.rejects(current.send(b, { ...input, text: "CONFLICT" }), /conflict/);
	await assert.rejects(
		current.send(
			{ ...b, sessionId: one.runtime.reservedSessionId },
			{ requestId: "forged", text: "FORGED-ADDRESS" },
		),
		/foreign|stale/i,
	);
	const receiver = recovered.connect({ principal: "b", source: b, grants: ["reply"] });
	const reply = await receiver.reply(done.id, { requestId: "reply", text: "REAL-WORKER-B-TO-A" });
	assert.equal((await receiver.wait(reply.id)).status, "done");
	await assert.rejects(receiver.send(a, { requestId: "no-send", text: "NO-GRANT" }, "reply"), /grant/);
	const third = await current.send(b, { requestId: "third", text: "REAL-WORKER-THIRD" });
	assert.equal((await current.wait(third.id)).status, "done");
	await assert.rejects(current.send(b, { requestId: "overflow", text: "NO-OVERFLOW" }), /capacity/);
	assert.equal(requests.length, 3);
	assert.ok(JSON.stringify(requests[0]).includes(input.text));
	assert.ok(JSON.stringify(requests[1]).includes("REAL-WORKER-B-TO-A"));
	assert.ok(!JSON.stringify(requests[1]).includes(input.text));
	const finalWorkers = manager.view();
	assert.notEqual(finalWorkers[0].pid, initialWorkers[0].pid);
	assert.deepEqual(errors, []);
	await writeFile(join(consumer, "broker-requests.json"), JSON.stringify(requests, null, 2));
	await writeFile(
		join(consumer, "broker-workers.json"),
		JSON.stringify(
			{ initialWorkers, finalWorkers, coordinator: restored.view(), broker: await recovered.view() },
			null,
			2,
		),
	);
	console.log(
		"Installed multi-Session broker/real worker smoke passed (" +
			requests.length +
			" local HTTP requests; lost admission reconciled after all processes reopened, 0 extra requests).",
	);
} finally {
	await manager?.close();
	await restored?.close();
	await runtime?.close();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
}
