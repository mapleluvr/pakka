import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createMas, createBroker } from "@pakka/mas";
import { createMasDevPack } from "@pakka/mas-devpack";
import { createWorkerManager } from "@pakka/server";
const root = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	errors = [];
function decode(value) {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new Error("Invalid installed consumer JSON", { cause: error });
	}
}
let actor, peer;
const pack = createMasDevPack({ resolve: () => actor });
const server = createServer((req, res) => {
	void (async () => {
		let raw = "";
		for await (const part of req) raw += part;
		const body = decode(raw);
		requests.push(body);
		const messages = body.messages,
			outputs = messages.filter((message) => message.role === "tool"),
			input = messages
				.filter((message) => message.role === "user")
				.map((message) => JSON.stringify(message.content))
				.join(" ");
		let tool, args;
		if (input.includes("PACK-CONSUMER-SEND") && outputs.length === 0) {
			tool = "mas_send";
			args = { target: peer, requestId: "installed-tool", text: "INSTALLED-PEER-INPUT" };
		}
		if (
			input.includes("PACK-CONSUMER-REVOKED") &&
			!outputs.some((message) => String(message.content).includes('"status":"denied"'))
		) {
			tool = "mas_send";
			args = { target: peer, requestId: "installed-revoked", text: "INSTALLED-MUST-NOT-REACH-PEER" };
		}
		if (input.includes("WORKER-CONSUMER-SPAWN")) {
			if (outputs.length === 0) {
				tool = "mas_spawn";
				args = { key: "child", lifetime: "temporary", profile: "default" };
			} else if (outputs.length === 1) {
				const child = decode(String(outputs[0].content));
				tool = "mas_inspect";
				args = { target: child.ref };
			}
		}
		const header = { id: "installed-pack", object: "chat.completion.chunk", created: 1, model: "local" };
		res.writeHead(200, { "content-type": "text/event-stream" });
		const delta = tool
			? {
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "call-" + requests.length,
							type: "function",
							function: { name: tool, arguments: JSON.stringify(args) },
						},
					],
				}
			: { role: "assistant", content: "INSTALLED-ANSWER" };
		for (const choice of [
			{ index: 0, delta, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
		])
			res.write("data: " + JSON.stringify({ ...header, choices: [choice] }) + "\n\n");
		res.end("data: [DONE]\n\n");
	})().catch((error) => {
		errors.push(String(error));
		res.destroy(error);
	});
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = "http://127.0.0.1:" + server.address().port + "/v1",
	cwd = join(root, "pack-workspace"),
	dataDir = join(root, "pack-data"),
	workerData = join(root, "pack-worker-data");
await mkdir(cwd);
await mkdir(dataDir);
await mkdir(workerData);
let runtime, manager;
try {
	runtime = await createRuntime({
		cwd,
		dataDir,
		endpoint,
		model: "local",
		apiKey: "local-only",
		limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
		profiles: [
			{ id: "pack", tools: pack.tools, systemPrompt: pack.instructions },
			{ id: "plain", tools: [] },
		],
	});
	const mas = await createMas({ runtime, namespace: "installed-pack", maxDeliveries: 8, maxPending: 2 });
	await mas.bootstrap([
		{ key: "a", owner: "operator", profile: "pack" },
		{ key: "b", owner: "operator", profile: "plain" },
	]);
	await mas.activate();
	const [a, b] = (await mas.view()).members;
	peer = b.ref;
	actor = mas.connect({ principal: "a", source: a.ref, grants: ["send"] });
	const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
	const first = await admin.send(a.ref, { requestId: "start", text: "PACK-CONSUMER-SEND" });
	await admin.wait(first.id);
	await runtime.waitForIdle();
	assert.equal(requests.length, 3);
	assert.equal(
		requests.filter((body) =>
			JSON.stringify(body.messages.filter((message) => message.role === "user")).includes(
				"INSTALLED-PEER-INPUT",
			),
		).length,
		1,
	);
	assert.ok(
		(await runtime.conversation(peer))
			.view()
			.context.some((message) => message.role === "user" && message.text.includes("INSTALLED-PEER-INPUT")),
	);
	const advertisements = requests[0].tools;
	assert.ok(advertisements.some((tool) => tool.function.name === "mas_send"));
	assert.equal(JSON.stringify(advertisements).includes("apiKey"), false);
	pack.revoke();
	const denied = await admin.send(a.ref, { requestId: "revoked", text: "PACK-CONSUMER-REVOKED" });
	await admin.wait(denied.id);
	await runtime.waitForIdle();
	assert.equal(requests.length, 5);
	assert.equal(
		requests.filter((body) =>
			JSON.stringify(body.messages.filter((message) => message.role === "user")).includes(
				"INSTALLED-PEER-INPUT",
			),
		).length,
		1,
	);
	const preset = {
		runtime: {
			cwd,
			dataDir: workerData,
			endpoint,
			model: "local",
			apiKey: "local-only",
			reservedSessionId: "44444444-4444-4444-4444-444444444444",
			limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
			profiles: [{ id: "pack", systemPrompt: "WORKER-PACK" }],
		},
		catalog: { namespace: "worker-members", maxDeliveries: 8, maxPending: 2 },
		devpack: { profiles: { pack: ["spawn", "observe"] } },
	};
	manager = createWorkerManager({
		placements: { one: preset },
		maxWorkers: 1,
		startupTimeoutMs: 15000,
		requestTimeoutMs: 15000,
	});
	const broker = await createBroker({
		namespace: "installed-worker-pack",
		store: runtime.store({ namespace: "installed-worker-pack", maxBytes: 65536 }),
		maxMembers: 2,
		maxMessages: 8,
		placements: { one: manager.placement("one") },
	});
	await broker.bootstrap([{ key: "w", placement: "one", owner: "operator", profile: "pack" }]);
	await broker.activate();
	const w = (await broker.view()).members[0].ref,
		sender = broker.connect({ principal: "operator", source: null, grants: ["send"] });
	const spawn = await sender.send(w, { requestId: "spawn", text: "WORKER-CONSUMER-SPAWN" });
	assert.equal((await sender.wait(spawn.id)).status, "done");
	const workerEndpoint = await manager.placement("one").open(w.sessionId),
		child = (await workerEndpoint.view()).mas.members.find((member) => member.key === "child");
	assert.ok(child);
	assert.equal(child.lifetime, "temporary");
	assert.match(child.owner, /^worker-agent-/);
	const terminal = decode(
		String(requests.at(-1).messages.filter((message) => message.role === "tool")[1].content),
	);
	assert.equal(terminal.phase, "ended");
	await assert.rejects(
		workerEndpoint.deliver({
			id: "late-child",
			principal: "operator",
			source: null,
			target: { key: "child", placement: "one", sessionId: w.sessionId, conversation: child.ref },
			input: { requestId: "late-child", text: "NO-ENDED-HTTP" },
		}),
		/owner|ended/i,
	);
	assert.notEqual(manager.view()[0].pid, process.pid);
	assert.equal(requests.length, 8);
	assert.deepEqual(errors, []);
	await writeFile(
		join(root, "devpack-evidence.json"),
		JSON.stringify(
			{
				httpRequests: requests.length,
				parentPid: process.pid,
				workerPid: manager.view()[0].pid,
				requests,
				errors,
			},
			null,
			2,
		),
	);
	console.log("installed DevPack smoke passed: native tools/revocation/temporary worker, 8 HTTP requests");
} finally {
	await manager?.close();
	await runtime?.close();
	await new Promise((resolve) => server.close(resolve));
}
