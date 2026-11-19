import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createPocketMemory } from "@pakka/server/pocket";
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";

// Run outside the repository: only the installed CLI and public extension/runtime exports.
const root = dirname(fileURLToPath(import.meta.url)),
	run = join(root, "memory-run-" + crypto.randomUUID()),
	cwd = join(run, "cwd"),
	dataDir = join(run, "data"),
	moduleFile = join(run, "composition.mjs"),
	ownerFile = join(run, "owner.txt");
await mkdir(cwd, { recursive: true });
await mkdir(dataDir, { recursive: true });
const approvedText = "INSTALLED-APPROVED-LESSON",
	pendingText = "INSTALLED-NATIVE-PROPOSAL",
	requests = [],
	errors = [];
function parse(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw Error("Invalid owned memory JSON", { cause: error });
	}
}
const provider = createServer((req, res) => {
	void (async () => {
		const chunks = [];
		for await (const bytes of req) chunks.push(Buffer.from(bytes));
		const body = parse(Buffer.concat(chunks).toString());
		requests.push(body);
		const n = requests.length;
		assert.equal(req.url, "/v1/chat/completions");
		assert.equal(req.headers.authorization, "Bearer SYNTHETIC-INSTALLED-MEMORY-KEY");
		const tool = n === 1,
			delta = tool
				? {
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: "memory-native-1",
								type: "function",
								function: {
									name: "memory",
									arguments: JSON.stringify({
										action: "add",
										requestId: "installed-native-proposal",
										scope: "project",
										text: pendingText,
									}),
								},
							},
						],
					}
				: { role: "assistant", content: "INSTALLED-MEMORY-RESULT" };
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "memory-" + n,
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
						usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 },
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
		apiKey: "SYNTHETIC-INSTALLED-MEMORY-KEY",
		limits: { maxConversations: 4, maxPrimaryAttempts: 10, maxAuxiliaryAttempts: 2 },
	},
	child,
	origin,
	port,
	webui = true;
const memoryOptions = {
	namespace: "installed.memory",
	profiles: ["default"],
	projects: [{ id: "workspace", name: "Installed project", resources: "*" }],
};
const runtimeOptions = () => {
	const prepared = createPocketMemory(memoryOptions);
	return {
		...options,
		tools: prepared.tools,
		profiles: [{ id: "plain", tools: [] }],
		contextSources: [prepared.source],
	};
};
async function until(predicate) {
	const end = Date.now() + 12000;
	while (!(await predicate())) {
		assert.ok(Date.now() < end, "Installed memory deadline");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
async function start() {
	await writeFile(
		moduleFile,
		`import{createPocketMemory}from'@pakka/server/pocket';import{workspaceMemoryExtensionRoot,workspaceMemoryService}from'@pakka/webui/workflows';const prepared=createPocketMemory(${JSON.stringify(memoryOptions)});export default{runtime:{...${JSON.stringify(options)},tools:prepared.tools,profiles:[{id:'plain',tools:[]}],contextSources:[prepared.source]},owner:'Owner',initial:[{name:'Memory project',profile:'default'}],profiles:['default','plain'],${port ? `transport:{port:${port}},` : ""}extensions:[{root:workspaceMemoryExtensionRoot,facets:${JSON.stringify(webui ? ["backend", "client", "webui"] : ["backend", "client"])}}],extensionServices:async context=>({memory:await workspaceMemoryService(context,prepared)})};`,
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
	assert.ok(out.includes("\n"), "Installed memory startup: " + err);
	const info = parse(out.split("\n")[0]);
	let endpoint;
	try {
		endpoint = new URL(info.origin);
	} catch (error) {
		throw Error("Invalid owned memory listener", { cause: error });
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
const system = (n) => JSON.stringify(requests[n].messages.filter((message) => message.role === "system"));
const readMemory = async (client, target) =>
	(await client.call("workspace-memory", "read", {}, target)).value;
async function work(client, target, text, count) {
	const placed = await client.rpc({
		op: "submit",
		target,
		input: { requestId: crypto.randomUUID(), text, mode: "prompt" },
	});
	assert.equal((await client.rpc({ op: "wait", id: placed.receipt.id })).receipt.status, "done");
	assert.equal(requests.length, count);
}
try {
	let info = await start();
	port = Number(new URL(origin).port);
	const token = new URLSearchParams(new URL((await readFile(ownerFile, "utf8")).trim()).hash.slice(1)).get(
		"session",
	);
	assert.ok(token);
	let owner = await loginHttp(origin, token);
	let target = (await owner.rpc({ op: "list" })).conversations[0];
	const added = await owner.call(
		"workspace-memory",
		"add",
		{ scope: "project", text: approvedText },
		target,
		"installed-add",
	);
	assert.equal(added.state, "done");
	assert.equal((await readMemory(owner, target)).lessons.length, 1);
	assert.equal(requests.length, 0);
	await work(owner, target, "MODEL-PROPOSES-A-LESSON", 2);
	assert.ok(requests[0].tools.some((tool) => tool.function.name === "memory"));
	assert.ok(system(0).includes(approvedText));
	assert.ok(system(1).includes(approvedText));
	assert.equal(system(1).includes(pendingText), false);
	const content = requests[1].messages.find((message) => message.role === "tool")?.content;
	assert.equal(parse(content).lesson.pending, true);
	const before = await readMemory(owner, target);
	assert.equal(before.lessons.length, 2);
	const pending = before.lessons.find((lesson) => lesson.pending);
	assert.ok(pending);
	await stop();
	let runtime = await createRuntime({ ...runtimeOptions(), reopenSessionFile: info.sessionFile });
	let saved;
	try {
		saved = (await runtime.store({ namespace: memoryOptions.namespace, maxBytes: 1048576 }).snapshot()).data;
		assert.equal(saved.lessons.length, 2);
		assert.equal(saved.lessons.filter((lesson) => lesson.pending && lesson.byAgent).length, 1);
		assert.equal(runtime.view().budget.primaryAttempts, 2);
	} finally {
		await runtime.close();
	}
	options = { ...options, reopenSessionFile: info.sessionFile };
	info = await start();
	owner = await connectHttp(origin, owner.cookies);
	const recovered = await owner.operationByRequest("workspace-memory", "installed-add", target);
	assert.equal(recovered.id, added.id);
	assert.equal(recovered.state, "done");
	const approved = await owner.call(
		"workspace-memory",
		"change",
		{ id: pending.id, expectedVersion: pending.version, action: "approve" },
		target,
		"installed-approve",
	);
	assert.equal(approved.state, "done");
	assert.equal((await readMemory(owner, target)).lessons.filter((lesson) => lesson.pending).length, 0);
	assert.equal(requests.length, 2);
	await work(owner, target, "AFTER-APPROVAL-AND-REOPEN", 3);
	assert.ok(system(2).includes(approvedText));
	assert.ok(system(2).includes(pendingText));
	await owner.call("workspace-memory", "activation", { enabled: false }, target);
	await work(owner, target, "AFTER-AUTOMATIC-CONTEXT-DISABLED", 4);
	assert.equal(system(3).includes(approvedText), false);
	assert.equal(system(3).includes(pendingText), false);
	const configured = await owner.rpc({ op: "configure", target, profile: "plain" });
	assert.equal(configured.ref.conversationId, target.conversationId);
	assert.notEqual(configured.ref.incarnation, target.incarnation);
	target = configured.ref;
	assert.equal((await owner.call("workspace-memory", "activation", { enabled: true }, target)).state, "done");
	await stop();
	webui = false;
	info = await start();
	owner = await connectHttp(origin, owner.cookies);
	const registrations = (await owner.extensions({ op: "list", target })).registrations;
	assert.ok(!registrations.some((row) => row.manifest.id === "workspace-memory" && row.facet === "webui"));
	await work(owner, target, "AFTER-WEBUI-REMOVAL-AND-PROFILE-SWITCH", 5);
	assert.equal(
		(requests[4].tools ?? []).some((tool) => tool.function.name === "memory"),
		false,
	);
	assert.equal(system(4).includes(approvedText), false);
	assert.equal(system(4).includes(pendingText), false);
	const after = await readMemory(owner, target);
	assert.equal(after.enabled, true);
	assert.ok(after.lessons.every((lesson) => !lesson.pending));
	assert.deepEqual(
		after.lessons.map((lesson) => lesson.id).sort(),
		saved.lessons.map((lesson) => lesson.id).sort(),
	);
	await stop();
	runtime = await createRuntime(runtimeOptions());
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 5);
		assert.equal(runtime.view().sessionId, target.sessionId);
	} finally {
		await runtime.close();
	}
	assert.deepEqual(errors, []);
	await writeFile(join(run, "provider-requests.json"), JSON.stringify(requests, null, 2) + "\n");
	console.log(
		"Installed Memory HTTP passed: native tool proposal, approved-only context, original operation across reopen, activation/profile controls and WebUI removal retain records; 5 local requests.",
	);
} finally {
	if (child) {
		child.kill();
		await child.finished;
	}
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
