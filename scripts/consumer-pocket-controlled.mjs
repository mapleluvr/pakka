import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRuntime } from "@pakka/agent";
import { browserExecutable } from "./pocket-browser.ts";
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";

const root = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	errors = [];
function json(raw) {
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error("Invalid installed controls JSON", { cause: error });
	}
}
const provider = createServer((req, res) => {
	void (async () => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const payload = json(raw);
		requests.push(payload);
		const last = payload.messages.at(-1),
			denied = JSON.stringify(payload.messages.filter((row) => row.role === "user").at(-1)).includes(
				"DENY-INSTALLED-NATIVE",
			);
		const tool = last.role !== "tool",
			choices = tool
				? [
						{
							index: 0,
							delta: {
								role: "assistant",
								tool_calls: [
									{
										index: 0,
										id: "native-approval-" + requests.length,
										type: "function",
										function: {
											name: "approved_write",
											arguments: JSON.stringify({
												text: denied ? "DENIED-WRITE-MUST-NOT-APPEAR" : "APPROVED-INSTALLED-PAYLOAD",
											}),
										},
									},
								],
							},
							finish_reason: null,
						},
						{ index: 0, delta: {}, finish_reason: "tool_calls" },
					]
				: [
						{
							index: 0,
							delta: { role: "assistant", content: "INSTALLED-CONTROLLED-FINISHED" },
							finish_reason: null,
						},
						{ index: 0, delta: {}, finish_reason: "stop" },
					];
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of choices)
			res.write(
				"data: " +
					JSON.stringify({
						id: "installed-control-" + requests.length,
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
						usage: { prompt_tokens: 30, completion_tokens: 3, total_tokens: 33 },
					}) +
					"\n\n",
			);
		res.end("data: [DONE]\n\n");
	})().catch((error) => {
		errors.push(String(error));
		res.destroy();
	});
});
let pageActions = 0;
const site = createServer((req, res) => {
	if (req.url === "/effect") {
		pageActions++;
		res.end("ACTUAL-BROWSER-EFFECT");
		return;
	}
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.end(
		"<!doctype html><title>Installed project page</title><h1>INSTALLED-OWNED-PAGE</h1><input id=\"message\"><button id=\"record\" onclick=\"fetch('/effect').then(()=>document.querySelector('#result').textContent='INSTALLED-PAGE-RESULT:'+document.querySelector('#message').value)\">Record</button><output id=\"result\"></output>",
	);
});
await Promise.all([
	new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve)),
	new Promise((resolve) => site.listen(0, "127.0.0.1", resolve)),
]);
const providerAddress = provider.address(),
	pageAddress = site.address();
assert.ok(providerAddress && typeof providerAddress !== "string");
assert.ok(pageAddress && typeof pageAddress !== "string");
const approvedOrigin = "http://127.0.0.1:" + pageAddress.port;
const run = join(root, "controlled-run-" + crypto.randomUUID()),
	cwd = join(run, "cwd"),
	dataDir = join(run, "data"),
	evidence = join(run, "evidence"),
	moduleFile = join(run, "controlled-composition.mjs"),
	ownerFile = join(run, "owner.txt"),
	effectFile = join(cwd, "approved-effect.txt");
await Promise.all([
	mkdir(cwd, { recursive: true }),
	mkdir(dataDir, { recursive: true }),
	mkdir(evidence, { recursive: true }),
]);
const options = {
	cwd,
	dataDir,
	endpoint: "http://127.0.0.1:" + providerAddress.port + "/v1",
	model: "local",
	apiKey: "PRIVATE-CONTROLLED-PROVIDER-CANARY",
	limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
};
async function composition() {
	await writeFile(
		moduleFile,
		`import {writeFile} from 'node:fs/promises';
import {approvalTool,createPocketApprovals} from '@pakka/server/pocket';
import {workspaceApprovalsExtensionRoot,workspaceApprovalsService,workspaceBrowserExtensionRoot,workspaceBrowserService} from '@pakka/webui/workflows';
let approvals,target;
const tool=approvalTool({name:'approved_write',description:'Write a fixed local file after human approval',parameters:{type:'object',properties:{text:{type:'string'}},required:['text']},execute:async args=>{await writeFile(${JSON.stringify(effectFile)},String(args.text));return 'INSTALLED-APPROVED-EFFECT';}},()=>({approvals,target}));
export default {runtime:{...${JSON.stringify(options)},tools:[tool]},owner:'Owner',initial:[{name:'Controlled project',profile:'default'}],extensions:[{root:workspaceApprovalsExtensionRoot,facets:['backend','webui','client']},{root:workspaceBrowserExtensionRoot,facets:['backend','webui','client']}],extensionServices:async context=>{target=context.runtime.view().conversations.at(-1);approvals=await createPocketApprovals({...context,namespace:'installed.approvals',timeoutMs:20000});return{approvals:workspaceApprovalsService(approvals),browser:await workspaceBrowserService(context,{namespace:'installed.browser',origins:[${JSON.stringify(approvedOrigin)}],executable:${JSON.stringify(await browserExecutable())},resources:[target.conversationId]})};}};
`,
	);
}
let child;
const until = async (condition) => {
	const end = Date.now() + 10000;
	while (!(await condition()) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(await condition(), "Installed controls deadline");
};
async function start() {
	await composition();
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
	await until(() => out.includes("\n") || child.exitCode !== null);
	assert.ok(out.includes("\n"), "Installed controls startup failed: " + err);
	const info = json(out.split("\n")[0]);
	let listener;
	try {
		listener = new URL(info.origin);
	} catch (error) {
		throw Error("Invalid owned controls listener", { cause: error });
	}
	assert.equal(listener.protocol, "http:");
	assert.equal(listener.hostname, "127.0.0.1");
	assert.equal(listener.origin, info.origin);
	assert.ok(listener.port);
	child.output = () => out + err;
	assert.equal(child.output().includes(options.apiKey), false);
	return info;
}
async function stop() {
	if (!child) return;
	child.stdin.end("stop\n");
	assert.equal(await child.finished, 0);
	assert.equal(child.output().includes(options.apiKey), false);
	child = undefined;
}
try {
	let info = await start();
	const token = new URLSearchParams(new URL((await readFile(ownerFile, "utf8")).trim()).hash.slice(1)).get(
		"session",
	);
	assert.ok(token);
	assert.equal(child.output().includes(token), false);
	let owner = await loginHttp(info.origin, token);
	const refs = (await owner.rpc({ op: "list" })).conversations,
		ref = refs[0],
		approvalIds = [];
	for (const allow of [true, false]) {
		const placed = await owner.rpc({
			op: "submit",
			target: ref,
			input: {
				requestId: allow ? "allow" : "deny",
				text: allow ? "ALLOW-INSTALLED-NATIVE" : "DENY-INSTALLED-NATIVE",
				mode: "prompt",
			},
		});
		let pending;
		await until(async () => {
			pending = (await owner.call("workspace-approvals", "list", {}, ref)).value.approvals.find(
				(row) => row.state === "pending",
			);
			return !!pending;
		});
		approvalIds.push(pending.id);
		if (allow) await assert.rejects(readFile(effectFile), { code: "ENOENT" });
		const decision = await owner.call(
			"workspace-approvals",
			"decide",
			{ id: pending.id, allow },
			ref,
			"decision-" + allow,
		);
		assert.equal(decision.state, "done");
		assert.equal((await owner.rpc({ op: "wait", id: placed.receipt.id })).receipt.status, "done");
		assert.equal(requests.length, allow ? 2 : 4);
		assert.equal(await readFile(effectFile, "utf8"), "APPROVED-INSTALLED-PAYLOAD");
	}
	const view = async (client) => (await client.call("workspace-browser", "view", {}, ref)).value;
	assert.equal(
		(await owner.call("workspace-browser", "navigate", { url: approvedOrigin }, ref)).state,
		"done",
	);
	await until(async () => (await view(owner)).view.text.includes("INSTALLED-OWNED-PAGE"));
	assert.equal(
		(
			await owner.call(
				"workspace-browser",
				"fill",
				{ selector: "#message", text: "ACTUAL-INSTALLED-FIELD" },
				ref,
			)
		).state,
		"done",
	);
	const clickId = "installed-browser-click";
	const clicked = await owner.call("workspace-browser", "click", { selector: "#record" }, ref, clickId);
	assert.equal(clicked.state, "done");
	await until(() => pageActions === 1);
	await until(async () =>
		(await view(owner)).view.text.includes("INSTALLED-PAGE-RESULT:ACTUAL-INSTALLED-FIELD"),
	);
	assert.equal((await owner.operationByRequest("workspace-browser", clickId, ref)).id, clicked.id);
	assert.deepEqual(
		(await owner.call("workspace-browser", "receipt", { requestId: clicked.id }, ref)).value,
		clicked.value,
	);
	assert.equal(
		(await owner.call("workspace-browser", "click", { selector: "#record" }, ref, clickId)).id,
		clicked.id,
	);
	assert.equal(pageActions, 1);
	const second = await owner.call(
		"workspace-browser",
		"click",
		{ selector: "#record" },
		ref,
		"installed-second-click",
	);
	assert.equal(second.state, "done");
	await until(() => pageActions === 2);
	const invitation = await owner.rpc({
		op: "invite",
		requestId: "controlled-viewer",
		role: "viewer",
		resources: [ref.conversationId],
		ttlMs: 60000,
	});
	const viewer = await loginHttp(info.origin, invitation.token, "invite", "Viewer");
	const readOnly = await view(viewer);
	assert.equal(readOnly.canAct, false);
	assert.match(readOnly.view.text, /INSTALLED-PAGE-RESULT:ACTUAL-INSTALLED-FIELD/);
	const png = Buffer.from(readOnly.frame.base64, "base64");
	assert.equal(png.subarray(1, 4).toString(), "PNG");
	assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
	await assert.rejects(viewer.call("workspace-browser", "click", { selector: "#record" }, ref), {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	await assert.rejects(viewer.operationByRequest("workspace-browser", clickId, ref), {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	const sessionFile = info.sessionFile;
	await stop();
	assert.equal(
		(await readdir(dirname(sessionFile))).filter((name) => name.startsWith("pocket-owned-browser-")).length,
		0,
	);
	options.reopenSessionFile = sessionFile;
	info = await start();
	assert.equal(info.sessionFile, sessionFile);
	owner = await connectHttp(info.origin, owner.cookies);
	assert.deepEqual((await owner.rpc({ op: "list" })).conversations, refs);
	const restored = (await owner.call("workspace-approvals", "list", {}, ref)).value.approvals;
	assert.deepEqual(
		restored.map((row) => row.id),
		approvalIds,
	);
	assert.deepEqual(
		restored.map((row) => row.state),
		["done", "denied"],
	);
	assert.equal((await owner.operationByRequest("workspace-browser", clickId, ref)).id, clicked.id);
	assert.equal((await view(owner)).view.open, false);
	assert.equal(pageActions, 2);
	assert.equal(requests.length, 4);
	assert.equal(await readFile(effectFile, "utf8"), "APPROVED-INSTALLED-PAYLOAD");
	assert.deepEqual(errors, []);
	await stop();
	const module = await import(pathToFileURL(moduleFile).href + "?verification");
	const runtime = await createRuntime({ ...module.default.runtime, reopenSessionFile: sessionFile });
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 4);
	} finally {
		await runtime.close();
	}
	assert.doesNotMatch(
		JSON.stringify(requests),
		/ACTUAL-INSTALLED-FIELD|INSTALLED-OWNED-PAGE|PRIVATE-CONTROLLED-PROVIDER-CANARY/,
	);
	assert.equal(
		await readFile(join(root, "node_modules/@pakka/server/LICENSE.pi-pocket"), "utf8"),
		await readFile(join(root, "node_modules/@pakka/webui/LICENSE.pi-pocket"), "utf8"),
	);
	await writeFile(
		join(evidence, "result.json"),
		JSON.stringify({ modelHttp: requests.length, pageActions, approvalIds, errors }, null, 2),
	);
	console.log(
		"Installed controlled HTTP passed: actual allow/deny tool effect, native browser navigation/fill/2 clicks/screenshot, original operation and inner receipt, scoped viewer and cleanup after reopen; 4 model requests.",
	);
} finally {
	await stop();
	provider.closeAllConnections();
	site.closeAllConnections();
	await Promise.all([
		new Promise((resolve) => provider.close(resolve)),
		new Promise((resolve) => site.close(resolve)),
	]);
}
