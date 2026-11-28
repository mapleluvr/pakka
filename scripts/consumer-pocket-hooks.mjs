import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";

// Outside-repository installed CLI; every model request goes to this deterministic local provider.
const root = dirname(fileURLToPath(import.meta.url)),
	run = join(root, "hooks-run-" + crypto.randomUUID()),
	cwd = join(run, "cwd"),
	dataDir = join(run, "data"),
	moduleFile = join(run, "composition.mjs"),
	ownerFile = join(run, "owner.txt");
await mkdir(cwd, { recursive: true });
await mkdir(dataDir, { recursive: true });
const requests = [],
	errors = [];
function parse(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw Error("Invalid owned hooks JSON", { cause: error });
	}
}
const provider = createServer((req, res) => {
	void (async () => {
		const chunks = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		const body = parse(Buffer.concat(chunks).toString());
		assert.equal(req.url, "/v1/chat/completions");
		assert.equal(req.headers.authorization, "Bearer SYNTHETIC-INSTALLED-HOOKS-KEY");
		requests.push(body);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "INSTALLED-HOOK-RESULT" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "hook-" + requests.length,
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
						usage: {
							prompt_tokens: 30 * requests.length,
							completion_tokens: 4,
							total_tokens: 30 * requests.length + 4,
						},
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
const address = provider.address();
assert.ok(address && typeof address !== "string");
let options = {
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + address.port + "/v1",
		model: "local",
		apiKey: "SYNTHETIC-INSTALLED-HOOKS-KEY",
		limits: { maxConversations: 4, maxPrimaryAttempts: 10, maxAuxiliaryAttempts: 2 },
	},
	child,
	origin,
	port,
	webui = true;
async function until(predicate) {
	const end = Date.now() + 12000;
	while (!(await predicate())) {
		assert.ok(Date.now() < end, "Installed hooks deadline");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
async function start() {
	await writeFile(
		moduleFile,
		`import{workspaceHooksExtensionRoot,workspaceHooksService}from'@pakka/webui/workflows';export default{runtime:${JSON.stringify(options)},owner:'Owner',initial:[{name:'Webhook project',profile:'default'}],${port ? `transport:{port:${port}},` : ""}extensions:[{root:workspaceHooksExtensionRoot,facets:${JSON.stringify(webui ? ["backend", "client", "webui"] : ["backend", "client"])}}],extensionServices:async context=>({hooks:await workspaceHooksService(context,{namespace:'installed.hooks'})})};`,
	);
	child = spawn(
		process.execPath,
		[
			join(root, "node_modules/@pakka/webui/dist/main.js"),
			"--config-module",
			moduleFile,
			"--owner-file",
			ownerFile,
			"--control-stdin",
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	let out = "",
		err = "";
	child.stdout.on("data", (bytes) => (out += String(bytes)));
	child.stderr.on("data", (bytes) => (err += String(bytes)));
	child.finished = new Promise((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	child.output = () => out + err;
	await until(() => out.includes("\n") || child.exitCode !== null);
	assert.ok(out.includes("\n"), "Installed hooks startup: " + err);
	const info = parse(out.split("\n")[0]);
	let endpoint;
	try {
		endpoint = new URL(info.origin);
	} catch (error) {
		throw Error("Invalid owned hooks listener", { cause: error });
	}
	assert.equal(endpoint.protocol, "http:");
	assert.equal(endpoint.hostname, "127.0.0.1");
	assert.ok(endpoint.port);
	assert.equal(endpoint.pathname, "/");
	assert.equal(endpoint.username + endpoint.password + endpoint.search + endpoint.hash, "");
	assert.equal(endpoint.origin, info.origin);
	origin = endpoint.origin;
	assert.equal(child.output().includes(options.apiKey), false);
	return info;
}
async function stop() {
	if (!child) return;
	child.stdin.end("stop\n");
	assert.equal(await child.finished, 0, child.output());
	assert.equal(child.output().includes(options.apiKey), false);
	child = undefined;
}
const readHooks = async (client, target) => (await client.call("workspace-hooks", "read", {}, target)).value;
const event = (n) =>
	Buffer.from(
		JSON.stringify({
			ref: "refs/heads/INSTALLED-HOOK-EVENT-" + n,
			repository: { full_name: "host-owner/approved", owner: { login: "host-owner" } },
			sender: { login: "host-owner" },
		}),
	);
async function post(key, body, delivery) {
	return fetch(origin + "/pakka-webui/ingress/workspace-hooks/hooks/" + key.id, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-github-event": "push",
			"x-github-delivery": delivery,
			"x-hub-signature-256": "sha256=" + createHmac("sha256", key.secret).update(body).digest("hex"),
		},
		body,
	});
}
async function complete(client, target, response, count) {
	assert.equal(response.status, 202);
	const result = await response.json();
	assert.equal(result.state, "accepted");
	assert.ok(result.receiptId);
	const done = (await client.rpc({ op: "wait", id: result.receiptId })).receipt;
	assert.equal(done.status, "done");
	assert.equal(done.target.conversationId, target.conversationId);
	assert.equal(requests.length, count);
	return result;
}
try {
	let info = await start();
	port = Number(new URL(origin).port);
	const token = new URLSearchParams(new URL((await readFile(ownerFile, "utf8")).trim()).hash.slice(1)).get(
		"session",
	);
	assert.ok(token);
	let owner = await loginHttp(origin, token);
	const target = (await owner.rpc({ op: "list" })).conversations[0];
	const created = await owner.call(
		"workspace-hooks",
		"create",
		{
			name: "Installed signed events",
			instructions: "Report this event in the current project.",
			signed: true,
			allowOutside: false,
		},
		target,
		"installed-hook",
	);
	assert.equal(created.state, "done");
	assert.equal(created.value.state, "done");
	const id = created.value.hook.id;
	assert.equal((await readHooks(owner, target)).hooks.length, 1);
	const oldKey = (await owner.call("workspace-hooks", "credentials", { id }, target)).value;
	const first = await complete(owner, target, await post(oldKey, event(1), "first"), 1);
	const repeated = await post(oldKey, event(1), "changed-unsigned-header");
	assert.equal(repeated.status, 202);
	assert.equal((await repeated.json()).receiptId, first.receiptId);
	assert.equal(requests.length, 1);
	const rotated = await owner.call(
		"workspace-hooks",
		"rotate",
		{ id, expectedVersion: 1 },
		target,
		"installed-rotate",
	);
	assert.equal(rotated.value.hook.version, 2);
	const currentKey = (await owner.call("workspace-hooks", "credentials", { id }, target)).value;
	assert.notEqual(currentKey.secret, oldKey.secret);
	assert.equal((await post(oldKey, event(2), "old-key")).status, 404);
	await complete(owner, target, await post(currentKey, event(2), "second"), 2);
	await stop();
	options = { ...options, reopenSessionFile: info.sessionFile };
	info = await start();
	owner = await connectHttp(origin, owner.cookies);
	assert.equal((await readHooks(owner, target)).hooks[0].received, 2);
	const recovered = await owner.operationByRequest("workspace-hooks", "installed-hook", target);
	assert.equal(recovered.id, created.id);
	assert.ok(!JSON.stringify(recovered).includes(currentKey.secret));
	assert.equal((await post(currentKey, event(2), "reopen-repeat")).status, 202);
	assert.equal(requests.length, 2);
	const invitation = await owner.rpc({
		op: "invite",
		requestId: "hooks-viewer",
		role: "viewer",
		resources: [target.conversationId],
		ttlMs: 60000,
	});
	const viewer = await loginHttp(origin, invitation.token, "invite", "Viewer");
	assert.deepEqual((await readHooks(viewer, target)).hooks, []);
	await assert.rejects(viewer.call("workspace-hooks", "credentials", { id }, target), {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	await stop();
	webui = false;
	info = await start();
	owner = await connectHttp(origin, owner.cookies);
	assert.ok(
		!(await owner.extensions({ op: "list", target })).registrations.some(
			(row) => row.manifest.id === "workspace-hooks" && row.facet === "webui",
		),
	);
	assert.equal((await readHooks(owner, target)).hooks[0].received, 2);
	await complete(owner, target, await post(currentKey, event(3), "backend-only"), 3);
	const removed = await owner.call(
		"workspace-hooks",
		"remove",
		{ id, expectedVersion: 2 },
		target,
		"installed-remove",
	);
	assert.equal(removed.state, "done");
	assert.equal(removed.value.state, "done");
	assert.equal((await post(currentKey, event(4), "after-remove")).status, 404);
	assert.equal(requests.length, 3);
	const deliveries = await owner.call("workspace-hooks", "deliveries", { id }, target);
	assert.equal(deliveries.state, "done");
	await stop();
	const runtime = await createRuntime(options);
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 3);
		assert.equal(runtime.view().sessionId, target.sessionId);
	} finally {
		await runtime.close();
	}
	assert.deepEqual(errors, []);
	for (const body of requests) {
		assert.ok(
			!JSON.stringify(body).includes(oldKey.secret) && !JSON.stringify(body).includes(currentKey.secret),
		);
		assert.deepEqual(body.tools ?? [], []);
	}
	await writeFile(join(run, "provider-requests.json"), JSON.stringify(requests, null, 2) + "\n");
	console.log(
		"Installed Hook HTTP passed: signed ingress, header replay prevention, rotation, original receipt after reopen, viewer isolation, Backend-only delivery and removal; 3 local model requests.",
	);
} finally {
	if (child) {
		child.kill();
		await child.finished;
	}
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
