import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";

const root = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	authorization = [],
	errors = [];
const provider = createServer((req, res) => {
	void (async () => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		let body;
		try {
			body = JSON.parse(raw);
		} catch (error) {
			errors.push(String(error));
			res.destroy();
			return;
		}
		requests.push(body);
		authorization.push(req.headers.authorization);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "INSTALLED-POCKET-ANSWER" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "installed-" + requests.length,
						object: "chat.completion.chunk",
						model: "local",
						choices: [choice],
					}) +
					"\n\n",
			);
		res.end("data: [DONE]\n\n");
	})().catch((error) => {
		errors.push(String(error));
		res.destroy();
	});
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const run = join(root, "product-run-" + crypto.randomUUID());
await mkdir(run);
const cwd = join(run, "cwd"),
	dataDir = join(run, "data"),
	configFile = join(run, "product.json"),
	ownerFile = join(run, "owner.txt");
await mkdir(cwd);
await mkdir(dataDir);
const extensionRoot = join(run, "installed-extension-examples");
await cp(join(root, "node_modules/@pakka/webui/examples"), extensionRoot, { recursive: true });
let config = {
	runtime: {
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + provider.address().port + "/v1",
		model: "local",
		apiKey: "PRIVATE-PROVIDER-CANARY",
		systemPrompt: "Installed workbench",
		profiles: [{ id: "alternate", model: "installed-alternate", systemPrompt: "Approved installed model" }],
		limits: { maxConversations: 8, maxPrimaryAttempts: 3, maxAuxiliaryAttempts: 2 },
	},
	owner: "Operator",
	profiles: ["default", "alternate"],
	extensions: ["preferences"].map((name) => ({
		root: join(extensionRoot, name),
	})),
	initial: [{ name: "Installed project", profile: "default" }],
};
let child;
async function start() {
	await writeFile(configFile, JSON.stringify(config));
	child = spawn(
		process.execPath,
		[
			process.platform === "win32"
				? join(root, "node_modules/@pakka/webui/dist/main.js")
				: join(root, "node_modules/.bin/pakka-webui"),
			"--config",
			configFile,
			"--owner-file",
			ownerFile,
			"--control-stdin",
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (chunk) => (stdout += chunk));
	child.stderr.on("data", (chunk) => (stderr += chunk));
	child.finished = new Promise((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	const deadline = Date.now() + 10000;
	while (!stdout.includes("\n") && child.exitCode === null && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 25));
	assert.ok(stdout.includes("\n"), "Installed product startup: " + stderr);
	let info;
	try {
		info = JSON.parse(stdout.split("\n")[0]);
	} catch (error) {
		throw new Error("Invalid installed product startup", { cause: error });
	}
	let allowed;
	try {
		allowed = new URL(info.origin);
	} catch (error) {
		throw new Error("Invalid installed listener address", { cause: error });
	}
	assert.equal(allowed.protocol, "http:");
	assert.equal(allowed.hostname, "127.0.0.1");
	assert.ok(allowed.port);
	assert.equal(allowed.origin, info.origin);
	assert.equal((stdout + stderr).includes(config.runtime.apiKey), false);
	child.captured = () => stdout + stderr;
	return info;
}
async function stop() {
	if (!child) return;
	child.stdin.end("stop\n");
	assert.equal(await child.finished, 0);
	child = undefined;
}
try {
	let info = await start();
	const link = (await readFile(ownerFile, "utf8")).trim();
	const token = new URLSearchParams(new URL(link).hash.slice(1)).get("session");
	assert.ok(token);
	assert.equal(child.captured().includes(token), false);
	let owner = await loginHttp(info.origin, token);
	const html = await fetch(info.origin).then((response) => response.text());
	assert.match(html, /@pakka\/webui-sdk/);
	const entry = /<script type="module" src="([^"]+)"/.exec(html)?.[1];
	assert.ok(entry);
	assert.equal((await fetch(info.origin + entry)).status, 200);
	assert.equal((await fetch(info.origin + "/pakka-webui/service-worker.js")).status, 200);
	assert.doesNotMatch(html, /PRIVATE-PROVIDER-CANARY/);
	const listed = await owner.rpc({ op: "list" });
	assert.equal(listed.conversations.length, 1);
	let target = listed.conversations[0];
	const preference = await owner.call(
		"preferences",
		"save",
		{ text: "PRIVATE-INSTALLED-PREFERENCE" },
		undefined,
		"installed-preference",
	);
	assert.equal(preference.state, "done");
	const card = await owner.call(
		"preferences",
		"card",
		{ text: "INSTALLED-DISPLAY-CARD" },
		target,
		"installed-card",
	);
	assert.equal(card.state, "done");
	assert.equal(requests.length, 0);
	const replaced = await owner.rpc({
		op: "credential.replace",
		input: { requestId: "replace", expectedVersion: 0, secret: "SYNTHETIC-INSTALLED-REPLACEMENT" },
	});
	assert.equal(replaced.status.version, 1);
	assert.ok(!JSON.stringify(replaced).includes("SYNTHETIC-INSTALLED-REPLACEMENT"));
	const configured = await owner.rpc({ op: "configure", target, profile: "alternate" });
	assert.equal(configured.kind, "reference");
	assert.notEqual(configured.ref.incarnation, target.incarnation);
	target = configured.ref;
	const input = { requestId: "installed-work", text: "INSTALLED-EXPLICIT-WORK", mode: "prompt" };
	const receipt = (await owner.rpc({ op: "submit", target, input })).receipt;
	const done = (await owner.rpc({ op: "wait", id: receipt.id })).receipt;
	assert.equal(done.status, "done");
	assert.equal(requests.length, 1);
	assert.equal(requests[0].model, "installed-alternate");
	assert.equal(authorization[0], "Bearer SYNTHETIC-INSTALLED-REPLACEMENT");
	const invitation = await owner.rpc({
		op: "invite",
		requestId: "viewer",
		role: "viewer",
		resources: [target.conversationId],
		ttlMs: 60000,
	});
	const inviteToken = invitation.token;
	assert.ok(inviteToken);
	let viewer = await loginHttp(info.origin, inviteToken, "invite", "Installed viewer");
	assert.match(JSON.stringify(await viewer.rpc({ op: "read", target })), /INSTALLED-POCKET-ANSWER/);
	await assert.rejects(viewer.rpc({ op: "submit", target, input: { ...input, requestId: "denied" } }), {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	await assert.rejects(viewer.rpc({ op: "credential.status" }), { code: "FORBIDDEN", outcome: "denied" });
	await assert.rejects(viewer.rpc({ op: "configure", target, profile: "default" }), {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	const stranger = await fetch(info.origin + "/pakka-webui/rpc", {
		method: "POST",
		headers: { Origin: info.origin, "Content-Type": "application/json" },
		body: JSON.stringify({ version: 2, requestId: "stranger", command: { op: "read", target } }),
	});
	assert.equal(stranger.status, 401);
	assert.ok(!(await stranger.text()).includes("INSTALLED-POCKET-ANSWER"));

	const sessionFile = info.sessionFile;
	await stop();
	config = {
		...config,
		runtime: { ...config.runtime, reopenSessionFile: sessionFile },
		transport: { port: Number(new URL(info.origin).port) },
	};
	info = await start();
	assert.equal(info.sessionFile, sessionFile);
	owner = await connectHttp(info.origin, owner.cookies);
	viewer = await connectHttp(info.origin, viewer.cookies);
	assert.deepEqual((await owner.rpc({ op: "receipt", id: receipt.id })).receipt, done);
	assert.equal(
		(await owner.services({ op: "session-budget.read", sessionId: target.sessionId })).policy.budget
			.primaryAttempts,
		1,
	);
	assert.equal(
		(await owner.rpc({ op: "configuration", target })).configuration.current.model,
		"installed-alternate",
	);
	assert.equal((await owner.call("preferences", "status")).value.text, "PRIVATE-INSTALLED-PREFERENCE");
	assert.equal((await owner.operationByRequest("preferences", "installed-preference")).id, preference.id);
	const cleared = await owner.rpc({
		op: "credential.clear",
		input: { requestId: "clear", expectedVersion: 1 },
	});
	assert.equal(cleared.status.version, 2);
	assert.equal(cleared.status.configured, false);
	const failed = (
		await owner.rpc({
			op: "submit",
			target,
			input: { ...input, requestId: "cleared", text: "INSTALLED-AFTER-PRIVATE-CLEAR" },
		})
	).receipt;
	assert.equal((await owner.rpc({ op: "wait", id: failed.id })).receipt.status, "unanswered");
	assert.equal(requests.length, 1);
	await owner.rpc({ op: "person.revoke", id: viewer.person.id });
	await assert.rejects(viewer.rpc({ op: "read", target }), (error) =>
		["FORBIDDEN", "UNAUTHORIZED"].includes(error.code),
	);
	await stop();

	info = await start();
	owner = await connectHttp(info.origin, owner.cookies);
	assert.equal((await owner.rpc({ op: "credential.status" })).status.configured, false);
	assert.equal(
		(await owner.services({ op: "session-budget.read", sessionId: target.sessionId })).policy.budget
			.primaryAttempts,
		2,
	);
	const history = await owner.services({
		op: "resource.history",
		reference: { kind: "conversation", sessionId: target.sessionId, conversationId: target.conversationId },
	});
	assert.match(JSON.stringify(history), /Configured provider credential unavailable/);
	const afterReopen = (
		await owner.rpc({
			op: "submit",
			target,
			input: { ...input, requestId: "cleared-reopen", text: "INSTALLED-PRIVATE-CLEAR-REOPEN" },
		})
	).receipt;
	assert.equal((await owner.rpc({ op: "wait", id: afterReopen.id })).receipt.status, "unanswered");
	assert.equal(
		(await owner.services({ op: "session-budget.read", sessionId: target.sessionId })).policy.budget
			.primaryAttempts,
		3,
	);
	assert.equal(requests.length, 1, "A cleared credential cannot fall back after reopen");
	for (const privateText of [
		"PRIVATE-INSTALLED-PREFERENCE",
		"INSTALLED-DISPLAY-CARD",
		"SYNTHETIC-INSTALLED-REPLACEMENT",
	])
		assert.ok(!JSON.stringify(requests).includes(privateText));
	assert.equal(child.captured().includes("SYNTHETIC-INSTALLED-REPLACEMENT"), false);
	assert.deepEqual(errors, []);
	console.log(
		"Installed default assets and public HTTP passed: executable, identity/scope, preference/card exclusion, model selection, credential replace/clear, original receipts and spent attempts across reopen; 1 local model request, 3 charged attempts.",
	);
	await stop();
} finally {
	if (child) {
		child.kill();
		await child.finished;
	}
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
