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
function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error("Invalid installed JSON");
	}
}
const provider = createServer((req, res) => {
	void (async () => {
		let body = "";
		for await (const chunk of req) body += chunk;
		requests.push(parseJson(body));
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "LOCAL-APPS-ANSWER" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "apps-" + requests.length,
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
const endpoint = "http://127.0.0.1:" + provider.address().port + "/v1";
const cwd = join(consumer, "apps-workspace"),
	dataDir = join(consumer, "apps-data");
await mkdir(cwd);
await mkdir(dataDir);
const operator = "local-apps-operator-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	peerToken = "local-apps-peer-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	observerToken = "local-apps-observer-ccccccccccccccccccccccccccccc";
const config = {
	schema: "pakka.server.v1",
	runtime: {
		cwd,
		dataDir,
		endpoint,
		apiKey: "local-only",
		model: "local",
		systemPrompt: "APPS-LOCAL-SYSTEM",
		maxOutputTokens: 64,
		limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
	},
	mas: { namespace: "apps", maxDeliveries: 8, maxPending: 2 },
	members: [
		{ key: "root", owner: "operator" },
		{ key: "peer", owner: "peer" },
	],
	roles: [
		{
			token: operator,
			principal: "operator",
			sourceKey: "root",
			grants: ["discover", "observe", "send", "spawn", "abort"],
			canRevoke: true,
		},
		{ token: peerToken, principal: "peer", sourceKey: "peer", grants: ["discover", "observe", "reply"] },
		{ token: observerToken, principal: "observer", sourceKey: null, grants: ["discover", "observe"] },
	],
	http: { port: 0, origins: [] },
};
const configPath = join(consumer, "apps-server.json");
await writeFile(configPath, JSON.stringify(config));
let child,
	stdout = "",
	stderr = "";
function cli(args) {
	return new Promise((resolve, reject) => {
		const processChild = spawn(
			process.execPath,
			[join(consumer, "node_modules", "@pakka", "cli", "dist", "main.js"), ...args],
			{ cwd: consumer, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
		);
		let out = "",
			err = "";
		processChild.stdout.on("data", (chunk) => {
			out += chunk;
		});
		processChild.stderr.on("data", (chunk) => {
			err += chunk;
		});
		processChild.once("error", reject);
		processChild.once("exit", (code) => resolve({ code, out, err }));
	});
}
try {
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
	const ready = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Installed server startup deadline")), 15000);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", () => {
			clearTimeout(timer);
			reject(new Error("Installed server exited before ready"));
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (stdout.includes("\n")) {
				clearTimeout(timer);
				try {
					resolve(JSON.parse(stdout.split("\n")[0]));
				} catch {
					reject(new Error("Invalid installed ready envelope"));
				}
			}
		});
	});
	const client = createClient({ endpoint: ready.endpoint, token: operator }),
		peer = createClient({ endpoint: ready.endpoint, token: peerToken });
	const connectionPath = join(consumer, "apps-client.json"),
		commandPath = join(consumer, "apps-command.json");
	await writeFile(connectionPath, JSON.stringify({ endpoint: ready.endpoint, token: operator }));
	const initial = await cli(["--connection", connectionPath, "snapshot"]);
	assert.equal(initial.code, 0, initial.err);
	const snapshot = JSON.parse(initial.out);
	assert.equal(snapshot.members.length, 2);
	assert.equal(snapshot.serverId, ready.serverId);
	assert.equal(requests.length, 0);
	const target = snapshot.members.find((member) => member.key === "peer").ref;
	const input = { requestId: "apps-input", text: "INSTALLED-CLI-TO-PEER" };
	await writeFile(commandPath, JSON.stringify({ op: "send", target, input }));
	const sent = await cli(["--connection", connectionPath, "call", "--command", commandPath]);
	assert.equal(sent.code, 0, sent.err);
	const receipt = JSON.parse(sent.out).receipt;
	const done = await client.request({ op: "wait", id: receipt.id });
	assert.equal(done.receipt.status, "done");
	assert.equal(requests.length, 1);
	const fresh = createClient({ endpoint: ready.endpoint, token: operator });
	assert.equal((await fresh.reconnect()).serverId, ready.serverId);
	const repeated = await fresh.request({ op: "send", target, input });
	assert.equal(repeated.receipt.id, receipt.id);
	assert.equal(requests.length, 1);
	const replied = await peer.request({
		op: "reply",
		receiptId: receipt.id,
		input: { requestId: "apps-reply", text: "INSTALLED-PEER-TO-ROOT" },
	});
	assert.equal((await peer.request({ op: "wait", id: replied.receipt.id })).receipt.status, "done");
	assert.equal(requests.length, 2);
	const observer = createClient({ endpoint: ready.endpoint, token: observerToken });
	await assert.rejects(
		observer.request({ op: "receipt", id: receipt.id }),
		(error) => error instanceof RemoteError && error.code === "FORBIDDEN" && error.outcome === "denied",
	);
	await writeFile(commandPath, JSON.stringify({ op: "abort", target }));
	const refusedOwner = await cli(["--connection", connectionPath, "call", "--command", commandPath]);
	assert.equal(refusedOwner.code, 2, refusedOwner.err);
	assert.equal(parseJson(refusedOwner.err).outcome, "denied");
	assert.equal(requests.length, 2);
	await client.request({ op: "revoke", principal: "observer" });
	await assert.rejects(
		observer.reconnect(),
		(error) => error instanceof RemoteError && error.outcome === "denied",
	);
	await writeFile(commandPath, JSON.stringify({ op: "spawn", key: "owned" }));
	const created = await cli(["--connection", connectionPath, "call", "--command", commandPath]);
	assert.equal(created.code, 0, created.err);
	assert.equal(JSON.parse(created.out).member.owner, "operator");
	assert.equal(requests.length, 2);
	for (const output of [
		stdout,
		stderr,
		initial.out,
		initial.err,
		sent.out,
		sent.err,
		created.out,
		created.err,
		refusedOwner.out,
		refusedOwner.err,
	])
		for (const credential of [operator, peerToken, observerToken, "local-only"])
			assert.ok(!output.includes(credential));
	assert.notEqual(child.pid, process.pid);
	assert.equal(errors.length, 0);
	assert.ok(JSON.stringify(requests[0]).includes(input.text));
	assert.ok(JSON.stringify(requests[1]).includes("INSTALLED-PEER-TO-ROOT"));
	assert.ok(!JSON.stringify(requests[1]).includes(input.text));
	await writeFile(join(consumer, "apps-requests.json"), JSON.stringify(requests, null, 2));
	await writeFile(
		join(consumer, "apps-evidence.json"),
		JSON.stringify(
			{
				serverPid: child.pid,
				parentPid: process.pid,
				ready,
				snapshot,
				messageReceipt: done.receipt,
				replyReceipt: replied.receipt,
				requests: requests.length,
				errors,
			},
			null,
			2,
		),
	);
	console.log(
		"Pakka installed server/client/CLI smoke passed: 2 local HTTP requests; fresh reconnect and repeated admission produced no extra dispatch.",
	);
} finally {
	if (child && child.exitCode === null) {
		const exit = new Promise((resolve) => child.once("exit", resolve));
		child.stdin.end("stop\n");
		await exit;
		assert.equal(child.exitCode, 0);
	}
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
