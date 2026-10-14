import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, RemoteError } from "@pakka/client";

const consumer = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	errors = [];
function parseJson(value) {
	try {
		return JSON.parse(value);
	} catch {
		throw new Error("Invalid installed product JSON");
	}
}
function current(payload) {
	const index = payload.messages.map((message) => message.role).lastIndexOf("user");
	return {
		text: String(payload.messages[index]?.content ?? ""),
		tools: payload.messages.slice(index + 1).filter((message) => message.role === "tool"),
	};
}
let peerRef, backgroundRef;
const emitted = [];
const provider = createServer((req, res) => {
	void (async () => {
		let body = "";
		for await (const chunk of req) body += chunk;
		const payload = parseJson(body);
		requests.push(payload);
		const now = current(payload);
		let answer = { text: "LOCAL-PRODUCT-ANSWER" };
		if (now.tools.length === 0) {
			const spawnCases = {
				"PRODUCT-MAKE-PERSISTENT": { key: "persistent", profile: "power", lifetime: "persistent" },
				"PRODUCT-MAKE-TEMPORARY": { key: "temporary", profile: "plain", lifetime: "temporary" },
				"PRODUCT-MAKE-TASK-BOUND": { key: "task-bound", profile: "plain", lifetime: "task-bound" },
				"PRODUCT-MAKE-BACKGROUND": { key: "background", profile: "plain", lifetime: "background" },
			};
			if (spawnCases[now.text]) answer = { tool: "mas_spawn", args: spawnCases[now.text] };
			else if (now.text === "PRODUCT-TRY-STRONGER-GRANT")
				answer = {
					tool: "mas_send",
					args: { target: peerRef, requestId: "forbidden-peer", text: "NO-UNAUTHORIZED-PRODUCT-PEER" },
				};
			else if (now.text === "PRODUCT-RETIRE-BACKGROUND")
				answer = { tool: "mas_retire", args: { target: backgroundRef } };
			else if (now.text === "PRODUCT-TALKER-SEND")
				answer = {
					tool: "mas_send",
					args: { target: peerRef, requestId: "approved-peer", text: "PRODUCT-ACTUAL-MODEL-TO-PEER" },
				};
		}
		const id = "product-tool-" + requests.length;
		if (answer.tool) emitted.push({ id, name: answer.tool, request: requests.length });
		const delta = answer.tool
			? {
					tool_calls: [
						{
							index: 0,
							id,
							type: "function",
							function: { name: answer.tool, arguments: JSON.stringify(answer.args) },
						},
					],
				}
			: { content: answer.text };
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant" }, finish_reason: null },
			{ index: 0, delta, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: answer.tool ? "tool_calls" : "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "product-" + requests.length,
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
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const cwd = join(consumer, "product-workspace"),
	dataDir = join(consumer, "product-data");
await mkdir(cwd);
await mkdir(dataDir);
const token = "local-product-operator-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	peerToken = "local-product-peer-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const config = {
	schema: "pakka.server.v1",
	runtime: {
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + provider.address().port + "/v1",
		apiKey: "local-only",
		model: "local",
		systemPrompt: "PRODUCT-LOCAL-SYSTEM",
		maxOutputTokens: 64,
		limits: { maxConversations: 8, maxPrimaryAttempts: 18, maxAuxiliaryAttempts: 1 },
		profiles: [
			{ id: "power", systemPrompt: "APPROVED-POWER" },
			{ id: "plain", systemPrompt: "NO-DEVPack-PEER" },
			{ id: "talker", systemPrompt: "APPROVED-TALKER" },
		],
	},
	mas: { namespace: "product", maxDeliveries: 24, maxPending: 3 },
	members: [
		{ key: "root", owner: "operator" },
		{ key: "peer", owner: "peer", profile: "plain" },
		{ key: "talker", owner: "operator", profile: "talker" },
	],
	roles: [
		{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] },
		{ token: peerToken, principal: "peer", sourceKey: "peer", grants: ["observe", "reply"] },
	],
	devpack: {
		profiles: { default: ["spawn", "observe", "retire"], power: ["send"], talker: ["send"] },
		operationTimeoutMs: 2000,
	},
	http: { port: 0, origins: [] },
};
const configPath = join(consumer, "product-server.json"),
	connectionPath = join(consumer, "product-client.json"),
	commandPath = join(consumer, "product-command.json");
let child;
const outputs = [],
	pids = [],
	terminals = [];
async function stop() {
	if (!child) return;
	const owned = child;
	child = undefined;
	if (owned.exitCode === null) {
		const exited = new Promise((resolve) => owned.once("exit", resolve));
		const timer = setTimeout(() => owned.kill(), 10000);
		try {
			owned.stdin.end("stop\n");
			await exited;
		} finally {
			clearTimeout(timer);
		}
	}
	assert.equal(owned.exitCode, 0, "Installed product did not close cleanly");
}
async function start(value) {
	await writeFile(configPath, JSON.stringify(value));
	child = spawn(
		process.execPath,
		[
			join(consumer, "node_modules", "@pakka", "server", "dist", "main.js"),
			"--config",
			configPath,
			"--control-stdin",
		],
		{ cwd: consumer, env: process.env, stdio: ["pipe", "pipe", "pipe"] },
	);
	const owned = child;
	let out = "",
		err = "";
	const ready = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Installed product startup deadline")), 15000);
		owned.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		owned.once("exit", () => {
			clearTimeout(timer);
			reject(new Error("Installed product exited before ready"));
		});
		owned.stderr.on("data", (chunk) => {
			err += chunk;
		});
		owned.stdout.on("data", (chunk) => {
			out += chunk;
			if (!out.includes("\n")) return;
			clearTimeout(timer);
			try {
				resolve(parseJson(out.split("\n")[0]));
			} catch (error) {
				reject(error);
			}
		});
	});
	owned.once("exit", () => outputs.push(out, err));
	pids.push(owned.pid);
	assert.notEqual(owned.pid, process.pid);
	await writeFile(connectionPath, JSON.stringify({ endpoint: ready.endpoint, token }));
	return {
		ready,
		client: createClient({ endpoint: ready.endpoint, token }),
		peer: createClient({ endpoint: ready.endpoint, token: peerToken }),
	};
}
function cli() {
	return new Promise((resolve, reject) => {
		const owned = spawn(
			process.execPath,
			[
				join(consumer, "node_modules", "@pakka", "cli", "dist", "main.js"),
				"--connection",
				connectionPath,
				"call",
				"--command",
				commandPath,
			],
			{ cwd: consumer, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
		);
		let out = "",
			err = "";
		owned.stdout.on("data", (chunk) => (out += chunk));
		owned.stderr.on("data", (chunk) => (err += chunk));
		owned.once("error", reject);
		owned.once("exit", (code) => {
			outputs.push(out, err);
			resolve({ code, out, err });
		});
	});
}
async function submit(app, target, id, text, useCli = false) {
	const command = { op: "send", target, input: { requestId: id, text } };
	let sent;
	if (useCli) {
		await writeFile(commandPath, JSON.stringify(command));
		const result = await cli();
		assert.equal(result.code, 0, result.err);
		sent = parseJson(result.out);
	} else sent = await app.client.request(command);
	assert.equal(sent.kind, "receipt");
	const done = await app.client.request({ op: "wait", id: sent.receipt.id });
	assert.equal(done.kind, "receipt");
	assert.equal(done.receipt.status, "done");
	terminals.push(done.receipt);
	return done.receipt;
}
try {
	let app = await start(config),
		snapshot = await app.client.reconnect();
	assert.equal(requests.length, 0);
	const root = snapshot.members.find((member) => member.key === "root").ref,
		talker = snapshot.members.find((member) => member.key === "talker").ref;
	peerRef = snapshot.members.find((member) => member.key === "peer").ref;
	const initialInput = await submit(app, root, "make-persistent", "PRODUCT-MAKE-PERSISTENT", true);
	snapshot = await app.client.reconnect();
	const persistent = snapshot.members.find((member) => member.key === "persistent");
	assert.ok(persistent);
	assert.equal(persistent.ref.profile, "power");
	assert.match(persistent.owner, /^worker-agent-/);
	await submit(app, persistent.ref, "try-grant", "PRODUCT-TRY-STRONGER-GRANT");
	assert.equal(requests.length, 4);
	assert.equal(
		requests.filter((payload) => current(payload).text === "NO-UNAUTHORIZED-PRODUCT-PEER").length,
		0,
	);
	for (const [key, marker] of [
		["temporary", "PRODUCT-MAKE-TEMPORARY"],
		["task-bound", "PRODUCT-MAKE-TASK-BOUND"],
	]) {
		await submit(app, root, "make-" + key, marker);
		const member = (await app.client.reconnect()).members.find((member) => member.key === key);
		assert.ok(member);
		assert.equal(member.lifetime, key);
		const state = await app.client.request({ op: "inspect", target: member.ref });
		assert.equal(state.member.phase, "ended");
		const count = requests.length;
		await assert.rejects(
			app.client.request({
				op: "send",
				target: member.ref,
				input: { requestId: "late-" + key, text: "NO-ENDED-INPUT" },
			}),
			(error) => error instanceof RemoteError,
		);
		assert.equal(requests.length, count);
	}
	await submit(app, root, "make-background", "PRODUCT-MAKE-BACKGROUND");
	const background = (await app.client.reconnect()).members.find((member) => member.key === "background");
	assert.ok(background);
	backgroundRef = background.ref;
	assert.equal((await app.client.request({ op: "inspect", target: backgroundRef })).member.phase, "active");
	await submit(app, backgroundRef, "still-live", "PRODUCT-BACKGROUND-STILL-LIVE");
	await submit(app, root, "retire-background", "PRODUCT-RETIRE-BACKGROUND");
	assert.equal((await app.client.request({ op: "inspect", target: backgroundRef })).member.phase, "retired");
	await assert.rejects(
		app.client.request({
			op: "send",
			target: backgroundRef,
			input: { requestId: "late-background", text: "NO-RETIRED-INPUT" },
		}),
		(error) => error instanceof RemoteError && error.outcome === "denied",
	);
	assert.equal(requests.length, 13);
	await submit(app, talker, "actual-a2a", "PRODUCT-TALKER-SEND", true);
	const talkerPayload = requests.filter((payload) => current(payload).text === "PRODUCT-TALKER-SEND").at(-1);
	const delivery = parseJson(String(current(talkerPayload).tools.at(-1).content));
	assert.equal(delivery.source.conversationId, talker.conversationId);
	assert.equal(delivery.target.conversationId, peerRef.conversationId);
	const received = await app.peer.request({ op: "wait", id: delivery.id });
	assert.equal(received.receipt.status, "done");
	assert.equal(requests.length, 16);
	const reply = await app.peer.request({
		op: "reply",
		receiptId: delivery.id,
		input: { requestId: "peer-reply", text: "PRODUCT-ACTUAL-PEER-REPLY" },
	});
	const replied = await app.peer.request({ op: "wait", id: reply.receipt.id });
	assert.equal(replied.receipt.status, "done");
	terminals.push(received.receipt, replied.receipt);
	assert.equal(requests.length, 17);
	assert.equal(
		requests.filter((payload) => current(payload).text === "PRODUCT-ACTUAL-MODEL-TO-PEER").length,
		1,
	);
	assert.equal(requests.filter((payload) => current(payload).text === "PRODUCT-ACTUAL-PEER-REPLY").length, 1);
	const peerPayload = requests.find((payload) => current(payload).text === "PRODUCT-ACTUAL-MODEL-TO-PEER");
	assert.ok(!peerPayload.tools?.some((tool) => tool.function.name.startsWith("mas_")));
	const retained = await app.client.reconnect();
	await stop();
	app = await start({
		...config,
		runtime: {
			...config.runtime,
			reopenSessionFile: join(dataDir, "sessions", retained.sessionId, "main.jsonl"),
		},
	});
	const reopened = await app.client.reconnect();
	assert.equal(reopened.sessionId, retained.sessionId);
	assert.notEqual(reopened.serverId, retained.serverId);
	assert.deepEqual(
		reopened.members.map((member) => member.ref),
		retained.members.map((member) => member.ref),
	);
	assert.equal(requests.length, 17);
	const retry = await app.client.request({
		op: "send",
		target: root,
		input: { requestId: "make-persistent", text: "PRODUCT-MAKE-PERSISTENT" },
	});
	assert.equal(retry.receipt.id, initialInput.id);
	assert.equal(requests.length, 17);
	await submit(app, persistent.ref, "retained-child", "PRODUCT-PERSISTENT-AFTER-REOPEN");
	assert.equal(requests.length, 18);
	const blocked = await app.client.request({
		op: "send",
		target: root,
		input: { requestId: "spent-budget", text: "NO-RESET-PRODUCT-BUDGET" },
	});
	const settled = await app.client.request({ op: "wait", id: blocked.receipt.id });
	assert.ok(["done", "unanswered"].includes(settled.receipt.status));
	assert.equal(requests.length, 18);
	for (const key of ["temporary", "task-bound", "background"]) {
		const member = reopened.members.find((member) => member.key === key);
		const state = await app.client.request({ op: "inspect", target: member.ref });
		assert.equal(state.member.phase, key === "background" ? "retired" : "ended");
	}
	const results = new Map();
	for (const payload of requests)
		for (const message of payload.messages)
			if (message.role === "tool") results.set(message.tool_call_id, String(message.content));
	assert.equal(emitted.length, 7);
	for (const tool of emitted) {
		assert.ok(results.has(tool.id), "Native tool result missing: " + tool.name);
	}
	assert.equal(errors.length, 0);
	await stop();
	for (const output of outputs)
		for (const secret of [token, peerToken, "local-only"]) assert.ok(!output.includes(secret));
	await writeFile(join(consumer, "product-requests.json"), JSON.stringify(requests, null, 2));
	await writeFile(
		join(consumer, "product-evidence.json"),
		JSON.stringify(
			{
				parentPid: process.pid,
				serverPids: pids,
				requests: requests.length,
				tools: emitted,
				toolResults: [...results],
				retained,
				reopened,
				terminals,
				blocked: settled.receipt,
				errors,
			},
			null,
			2,
		),
	);
	console.log(
		"Pakka installed product smoke passed: 18 local HTTP requests, 7 native tool calls; dynamic reopen, native lifetimes, approved A2A/reply and spent quota verified without hidden replay.",
	);
} finally {
	await writeFile(join(consumer, "product-requests.json"), JSON.stringify(requests, null, 2));
	await stop();
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
