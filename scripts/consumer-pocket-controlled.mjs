import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRuntime } from "@pakka/agent";
import { browserExecutable, ownedBrowser } from "./pocket-browser.ts";

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
let child, inspector;
const until = async (condition) => {
	const end = Date.now() + 10000;
	while (!condition() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(condition(), "Installed controls deadline");
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
async function click(page, selector) {
	await page.wait(
		`(()=>{const element=document.querySelector(${JSON.stringify(selector)});return !!element&&!element.disabled;})()`,
	);
	await page.click(selector);
}
const rpc = (page, command) =>
	page.evaluate(
		`(async()=>{const{createPocketClient}=await import('@pakka/client/pocket');return createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request(${JSON.stringify(command)});})()`,
	);
const extension = (page, ref, extension, action, input, requestId) =>
	page.evaluate(
		`(async()=>{const{createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),registration=(await client.list(${JSON.stringify(ref)})).find(row=>row.manifest.id===${JSON.stringify(extension)});return client.call({extension:registration.manifest.id,generation:registration.generation,action:${JSON.stringify(action)},target:${JSON.stringify(ref)},requestId:${JSON.stringify(requestId)},input:${JSON.stringify(input)}});})()`,
	);
try {
	let info = await start();
	const link = (await readFile(ownerFile, "utf8")).trim();
	let ownerUrl;
	try {
		ownerUrl = new URL(link);
	} catch (error) {
		throw Error("Invalid generated controls owner link", { cause: error });
	}
	const token = new URLSearchParams(ownerUrl.hash.slice(1)).get("signin");
	assert.ok(token);
	assert.equal(child.output().includes(token), false);
	inspector = await ownedBrowser(join(run, "inspector"));
	const owner = await inspector.page(link);
	await owner.wait('document.querySelector("[data-action=signin]")');
	await click(owner, "[data-action=signin]");
	await owner.wait('document.querySelector("[data-conversation]")');
	const refs = (await rpc(owner, { op: "list" })).conversations,
		ref = refs[0];
	assert.ok(ref);
	await click(owner, "[data-conversation]");
	const approvalIds = [];
	for (const allow of [true, false]) {
		await click(owner, "[data-conversation]");
		await owner.wait('document.querySelector("textarea")');
		await owner.type("textarea", allow ? "ALLOW-INSTALLED-NATIVE" : "DENY-INSTALLED-NATIVE");
		await click(owner, "[data-action=send]");
		await click(owner, "[data-interface=workspace-approvals-approvals]");
		await owner.wait('document.querySelector("[data-approval-allow]")');
		const list = await extension(owner, ref, "workspace-approvals", "list", {}, crypto.randomUUID()),
			pending = list.value.approvals.find((row) => row.state === "pending");
		assert.ok(pending);
		approvalIds.push(pending.id);
		if (allow) await assert.rejects(readFile(effectFile), { code: "ENOENT" });
		await click(owner, allow ? "[data-approval-allow]" : "[data-approval-deny]");
		await owner.wait(
			`[...document.querySelectorAll('[data-approval-state]')].some(row=>row.textContent.includes(${JSON.stringify(allow ? "done" : "denied")}))`,
		);
		await until(() => requests.length === (allow ? 2 : 4));
		await owner.wait(
			`(async()=>{const{createPocketClient}=await import('@pakka/client/pocket');const value=await createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:'read',target:${JSON.stringify(ref)}});return value.snapshot.live.busy===false;})()`,
		);
		assert.equal(await readFile(effectFile, "utf8"), "APPROVED-INSTALLED-PAYLOAD");
	}
	await click(owner, "[data-interface=workspace-browser-browser]");
	await owner.wait('document.querySelector("[data-owned-browser]")');
	await owner.type("[name=browser-url]", approvedOrigin);
	await click(owner, "[data-browser-go]");
	await owner.wait('document.querySelector("[data-browser-frame]")?.naturalWidth>0');
	await owner.type("[name=browser-selector]", "#message");
	await owner.type("[name=browser-text]", "ACTUAL-INSTALLED-FIELD");
	await click(owner, "[data-browser-fill]");
	await owner.wait('document.querySelector("[data-browser-fill]")?.disabled===false');
	await owner.evaluate(
		'(()=>{const field=document.querySelector("[name=browser-selector]");field.value="";field.dispatchEvent(new Event("input",{bubbles:true}));})()',
	);
	await owner.type("[name=browser-selector]", "#record");
	await owner.evaluate(
		`(()=>{const original=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await original(...args);if(typeof args[1]?.body==='string'&&args[1].body.includes('"action":"click"')){globalThis.fetch=original;globalThis.__pakkaVisibleActionDropped=true;await response.arrayBuffer();throw Error('TEST-ONLY LOST VISIBLE ACTION RESPONSE');}return response;};})()`,
	);
	await click(owner, "[data-browser-click]");
	await owner.wait(
		'document.querySelector("[data-browser-text]")?.textContent.includes("INSTALLED-PAGE-RESULT:ACTUAL-INSTALLED-FIELD")',
	);
	assert.equal(pageActions, 1);
	assert.equal(await owner.evaluate("globalThis.__pakkaVisibleActionDropped"), true);
	await owner.wait('document.querySelector("[data-browser-reconcile]")');
	assert.equal(await owner.evaluate('document.querySelector("[data-browser-click]").disabled'), true);
	await click(owner, "[data-conversation]");
	await owner.wait('!document.querySelector("[data-owned-browser]")');
	await click(owner, "[data-interface=workspace-browser-browser]");
	await owner.wait(
		'document.querySelector("[data-browser-reconcile]")?.disabled === false && document.querySelector("[data-browser-frame]")?.naturalWidth > 0',
	);
	await click(owner, "[data-browser-reconcile]");
	await owner.wait('!document.querySelector("[data-browser-reconcile]")');
	assert.equal(pageActions, 1, "visible reconciliation after interface reopen is read-only");
	const lost = await owner.evaluate(
		`(async()=>{const{createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),registration=(await client.list(${JSON.stringify(ref)})).find(row=>row.manifest.id==='workspace-browser'),command={extension:'workspace-browser',generation:registration.generation,action:'click',requestId:'installed-lost-click',target:${JSON.stringify(ref)},input:{selector:'#record'}},original=globalThis.fetch;let first;globalThis.fetch=async(...args)=>{const response=await original(...args);if(typeof args[1]?.body==='string'&&args[1].body.includes('installed-lost-click')){await response.arrayBuffer();throw Error('TEST-ONLY LOST COMPLETED RESPONSE');}return response;};try{first=await client.call(command).catch(error=>({outcome:error.outcome,name:error.name}));}finally{globalThis.fetch=original;}return{first,retry:await client.call(command)};})()`,
	);
	assert.equal(lost.first.outcome, "unknown");
	assert.equal(lost.first.name, "PocketRemoteError");
	assert.equal(lost.retry.state, "done");
	assert.equal(pageActions, 2);
	const invitation = await rpc(owner, {
		op: "invite",
		requestId: "controlled-viewer",
		role: "viewer",
		resources: [ref.conversationId],
		ttlMs: 60000,
	});
	assert.ok(invitation.token);
	const viewer = await inspector.page(info.origin + "/#invite=" + invitation.token, {
		width: 390,
		height: 844,
	});
	await viewer.wait('document.querySelector("[data-action=signin]")');
	await viewer.type("input[name=person]", "Viewer");
	await click(viewer, "[data-action=signin]");
	await viewer.wait('document.querySelector("[data-conversation]")');
	await click(viewer, '[aria-label="Toggle conversations"]');
	await click(viewer, "[data-conversation]");
	await click(viewer, '[aria-label="Toggle conversations"]');
	await click(viewer, "[data-interface=workspace-browser-browser]");
	await viewer.wait('document.querySelector("[data-browser-frame]")?.naturalWidth>0');
	assert.equal(
		await viewer.evaluate(
			'document.querySelectorAll("[data-browser-go],[data-browser-fill],[data-browser-click]").length',
		),
		0,
	);
	assert.equal(await viewer.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
	await writeFile(join(evidence, "desktop.png"), await owner.screenshot());
	await writeFile(join(evidence, "mobile.png"), await viewer.screenshot());
	const sessionFile = info.sessionFile;
	await stop();
	assert.equal(
		(await readdir(dirname(sessionFile))).filter((name) => name.startsWith("pocket-owned-browser-")).length,
		0,
	);
	options.reopenSessionFile = sessionFile;
	info = await start();
	assert.equal(info.sessionFile, sessionFile);
	await owner.navigate(info.origin);
	await owner.wait('document.querySelector("[data-conversation]")');
	assert.deepEqual((await rpc(owner, { op: "list" })).conversations, refs);
	const restored = await extension(owner, ref, "workspace-approvals", "list", {}, "inspect-retained");
	assert.deepEqual(
		restored.value.approvals.map((row) => row.id),
		approvalIds,
	);
	assert.deepEqual(
		restored.value.approvals.map((row) => row.state),
		["done", "denied"],
	);
	const repeated = await owner.evaluate(
		`(async()=>{const {createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null});return client.operationByRequest({extension:'workspace-browser',requestId:'installed-lost-click',target:${JSON.stringify(ref)}});})()`,
	);
	assert.equal(repeated.state, "done");
	assert.equal(pageActions, 2);
	const view = await extension(owner, ref, "workspace-browser", "view", {}, "no-replayed-page");
	assert.equal(view.value.view.open, false);
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
		JSON.stringify(
			{ sessionFile, approvalIds, modelHttp: requests.length, pageActions, errors, spentPrimaryAttempts: 4 },
			null,
			2,
		),
	);
	console.log(
		"Installed controlled workflows verified: 4 model HTTP, real allow/deny, 2 page clicks with visible original-result reconciliation, retry/reopen dedup, mobile viewer and owned cleanup",
	);
} finally {
	await inspector?.close();
	await stop();
	provider.closeAllConnections();
	site.closeAllConnections();
	await Promise.all([
		new Promise((resolve) => provider.close(() => resolve())),
		new Promise((resolve) => site.close(() => resolve())),
	]);
}
