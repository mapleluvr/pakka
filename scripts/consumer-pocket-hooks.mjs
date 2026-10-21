import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { ownedBrowser } from "./pocket-browser.ts";
import { openConversations } from "./frontend-controls.ts";

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
	browser,
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
const rpc = (page, command) =>
	page.evaluate(
		`(async()=>{const{createPocketClient}=await import('@pakka/client/pocket');return createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request(${JSON.stringify(command)});})()`,
	);
const ext = (page, target, operation) =>
	page.evaluate(
		`(async()=>{const{createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),target=${JSON.stringify(target)},row=(await client.list(target)).find(row=>row.manifest.id==='workspace-hooks');return ${operation};})()`,
	);
const readHooks = (page, target) =>
	ext(
		page,
		target,
		"(await client.call({extension:row.manifest.id,generation:row.generation,action:'read',requestId:crypto.randomUUID(),target,input:{}})).value",
	);
async function reloadProduct(page, target) {
	const before = await page.evaluate("performance.timeOrigin");
	await page.reload();
	await page.wait(
		"performance.timeOrigin!==" + JSON.stringify(before) + '&&document.querySelector("[data-conversation]")',
	);
	// The application consumes a conversation fragment after selecting the authorized target.
	await page.navigate(origin + "/#conversation=" + encodeURIComponent(target.conversationId));
	const selected = `[data-conversation="${target.conversationId}"][aria-current=true]`;
	await page.wait(
		"!!document.querySelector(" +
			JSON.stringify(selected) +
			')&&document.querySelector(".pocket-status")?.textContent==="Ready"&&!!document.querySelector("textarea[name=message]")',
	);
}
async function post(key, body, delivery) {
	return fetch(origin + "/pocket/ingress/workspace-hooks/hooks/" + key.id, {
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
async function complete(page, target, response, count) {
	assert.equal(response.status, 202);
	const result = await response.json();
	assert.equal(result.state, "accepted");
	assert.ok(result.receiptId);
	await until(() => requests.length === count);
	const done = await rpc(page, { op: "wait", id: result.receiptId });
	assert.equal(done.receipt.status, "done");
	assert.equal(done.receipt.target.conversationId, target.conversationId);
	return result;
}
async function setupKey(page) {
	await page.click("[data-hook-setup]");
	await page.wait('document.querySelector("[data-hook-secret]")?.value.length===43');
	const key = await page.evaluate(
		'({id:document.querySelector("[data-hook-row]").dataset.hookRow,secret:document.querySelector("[data-hook-secret]").value})',
	);
	assert.ok(key && typeof key.id === "string" && typeof key.secret === "string");
	await page.click("[data-hook-hide-setup]");
	return key;
}
const event = (n) =>
	Buffer.from(
		JSON.stringify({
			ref: "refs/heads/INSTALLED-HOOK-EVENT-" + n,
			repository: { full_name: "host-owner/approved", owner: { login: "host-owner" } },
			sender: { login: "host-owner" },
		}),
	);
try {
	let info = await start();
	port = Number(new URL(origin).port);
	const link = (await readFile(ownerFile, "utf8")).trim();
	assert.ok(link.startsWith(origin + "/#signin="));
	browser = await ownedBrowser(join(run, "chrome"));
	const page = await browser.page(link);
	await page.wait('document.querySelector("[data-action=signin]")');
	await page.click("[data-action=signin]");
	await page.wait('document.querySelector("[data-conversation]")');
	await page.click("[data-conversation]");
	const listed = await rpc(page, { op: "list" });
	assert.equal(listed.kind, "list");
	assert.equal(listed.conversations.length, 1);
	const target = listed.conversations[0];
	await page.wait('document.querySelector("[data-interface=workspace-hooks-hooks]")');
	await page.click("[data-interface=workspace-hooks-hooks]");
	await page.wait('document.querySelector("[data-hook-name]")?.disabled===false');
	await page.evaluate(
		`(()=>{const original=globalThis.fetch;globalThis.__hookWrites=0;globalThis.__restoreHookFetch=()=>{globalThis.fetch=original;};globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&JSON.parse(args[1].body).command?.call?.action==='create'){globalThis.__hookWrites++;globalThis.__originalHook=JSON.parse(args[1].body).command.call;const response=await original(...args);await response.arrayBuffer();throw Error('TEST LOST COMMITTED HOOK RESPONSE');}return original(...args);};})()`,
	);
	await page.type("[data-hook-name]", "Installed signed events");
	await page.type("[data-hook-instructions]", "Report this event in the current project.");
	await page.click("[data-hook-create]");
	await page.wait('document.querySelector("[data-hook-reconcile]")?.disabled===false');
	const original = await page.evaluate(
		"({extension:globalThis.__originalHook.extension,requestId:globalThis.__originalHook.requestId,target:globalThis.__originalHook.target})",
	);
	await page.evaluate("globalThis.__restoreHookFetch()");
	await page.click("[data-conversation]");
	await page.wait('document.querySelector("textarea[name=message]")');
	await page.click("[data-interface=workspace-hooks-hooks]");
	await page.wait('document.querySelector("[data-hook-reconcile]")?.disabled===false');
	await page.click("[data-hook-reconcile]");
	await page.wait(
		'!document.querySelector("[data-hook-reconcile]")&&document.querySelectorAll("[data-hook-row]").length===1',
	);
	assert.equal(await page.evaluate("globalThis.__hookWrites"), 1);
	assert.equal(requests.length, 0);
	const oldKey = await setupKey(page);
	const first = await complete(page, target, await post(oldKey, event(1), "first"), 1);
	const repeated = await post(oldKey, event(1), "changed-unsigned-header");
	assert.equal(repeated.status, 202);
	assert.equal((await repeated.json()).receiptId, first.receiptId);
	assert.equal(requests.length, 1);
	await page.click("[data-hook-rotate]");
	await page.wait('document.querySelector("[data-hook-confirm]")?.disabled===false');
	await page.click("[data-hook-confirm]");
	await page.wait('document.querySelector("[data-hook-row]")?.dataset.version==="2"');
	const currentKey = await setupKey(page);
	assert.notEqual(currentKey.secret, oldKey.secret);
	assert.equal((await post(oldKey, event(2), "old-key")).status, 404);
	assert.equal(requests.length, 1);
	await complete(page, target, await post(currentKey, event(2), "second"), 2);
	await stop();
	let runtime = await createRuntime({ ...options, reopenSessionFile: info.sessionFile });
	let before;
	try {
		before = (await runtime.store({ namespace: "installed.hooks", maxBytes: 2097152 }).snapshot()).data;
		assert.equal(before.hooks.length, 1);
		assert.equal(
			before.deliveries.filter(
				(row) =>
					row.hookId === before.hooks[0].id && row.state === "complete" && row.result.state === "accepted",
			).length,
			2,
		);
		assert.equal(before.deliveries.length, 2);
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		const ordinary = JSON.stringify(before.operations);
		assert.equal(ordinary.includes(oldKey.secret) || ordinary.includes(currentKey.secret), false);
		await writeFile(join(run, "before-reopen.json"), JSON.stringify(before, null, 2));
		await writeFile(join(run, "before-view.json"), JSON.stringify(runtime.view(), null, 2));
	} finally {
		await runtime.close();
	}
	options = { ...options, reopenSessionFile: info.sessionFile };
	info = await start();
	await reloadProduct(page, target);
	await page.wait('document.querySelector("[data-interface=workspace-hooks-hooks]")');
	await page.click("[data-interface=workspace-hooks-hooks]");
	await page.wait('document.querySelector("[data-hook-row]")?.dataset.version==="2"');
	assert.equal((await readHooks(page, target)).hooks[0].received, 2);
	const recovered = await ext(
		page,
		target,
		"await client.operationByRequest(" + JSON.stringify(original) + ")",
	);
	assert.equal(recovered.state, "done");
	assert.equal(JSON.stringify(recovered).includes(currentKey.secret), false);
	assert.equal((await post(currentKey, event(2), "reopen-repeat")).status, 202);
	assert.equal(requests.length, 2);
	const invitation = await rpc(page, {
		op: "invite",
		requestId: "hooks-viewer",
		role: "viewer",
		resources: [target.conversationId],
		ttlMs: 60000,
	});
	assert.ok(invitation.token);
	const viewer = await browser.page(origin + "/#invite=" + invitation.token, { width: 390, height: 844 });
	await viewer.wait('document.querySelector("[data-action=signin]")');
	await viewer.type("input[name=person]", "Viewer");
	await viewer.click("[data-action=signin]");
	await viewer.wait('document.querySelector("[data-conversation]")');
	await openConversations(viewer);
	await viewer.click("[data-conversation]");
	await viewer.wait('document.querySelector("[data-interface=workspace-hooks-hooks]")');
	await openConversations(viewer);
	await viewer.click("[data-interface=workspace-hooks-hooks]");
	await viewer.wait('document.querySelector("[data-hook-readonly]")');
	assert.equal(
		await viewer.evaluate(
			'document.querySelectorAll("[data-hook-row],[data-hook-create],[data-hook-private-setup]").length',
		),
		0,
	);
	assert.deepEqual((await readHooks(viewer, target)).hooks, []);
	const denied = await ext(
		viewer,
		target,
		"(async()=>{try{await client.call({extension:row.manifest.id,generation:row.generation,action:'credentials',requestId:crypto.randomUUID(),target,input:{id:" +
			JSON.stringify(currentKey.id) +
			"}});return {unexpected:true};}catch(error){return {name:error.name,outcome:error.outcome,code:error.code};}})()",
	);
	assert.equal(denied.outcome, "denied");
	assert.equal(denied.code, "FORBIDDEN");
	assert.equal(requests.length, 2);
	await stop();
	webui = false;
	info = await start();
	await reloadProduct(page, target);
	assert.equal(await page.evaluate('document.querySelector("[data-interface=workspace-hooks-hooks]")'), null);
	assert.equal((await readHooks(page, target)).hooks[0].received, 2);
	await complete(page, target, await post(currentKey, event(3), "backend-only"), 3);
	const removed = await ext(
		page,
		target,
		"await client.call({extension:row.manifest.id,generation:row.generation,action:'remove',requestId:crypto.randomUUID(),target,input:{id:" +
			JSON.stringify(currentKey.id) +
			",expectedVersion:2}})",
	);
	assert.equal(removed.state, "done");
	assert.equal(removed.value.state, "done");
	assert.equal((await post(currentKey, event(4), "after-remove")).status, 404);
	assert.equal(requests.length, 3);
	await stop();
	runtime = await createRuntime(options);
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 3);
		assert.equal(runtime.view().sessionId, target.sessionId);
		const after = (await runtime.store({ namespace: "installed.hooks", maxBytes: 2097152 }).snapshot()).data;
		assert.equal(after.hooks.length, 1);
		assert.equal(after.hooks[0].id, before.hooks[0].id);
		assert.equal(after.hooks[0].active, false);
		assert.equal(
			after.deliveries.filter(
				(row) =>
					row.hookId === after.hooks[0].id && row.state === "complete" && row.result.state === "accepted",
			).length,
			3,
		);
		assert.equal(after.deliveries.length, 3);
		await writeFile(join(run, "after-reopen.json"), JSON.stringify(after, null, 2));
		await writeFile(join(run, "after-view.json"), JSON.stringify(runtime.view(), null, 2));
	} finally {
		await runtime.close();
	}
	await copyFile(info.sessionFile, join(run, "native-storage.jsonl"));
	assert.deepEqual(errors, []);
	for (const body of requests) {
		assert.equal(
			JSON.stringify(body).includes(oldKey.secret) || JSON.stringify(body).includes(currentKey.secret),
			false,
		);
		assert.deepEqual(body.tools ?? [], []);
	}
	await writeFile(join(run, "provider-requests.json"), JSON.stringify(requests, null, 2) + "\n");
	console.log(
		JSON.stringify({
			installedHooks: true,
			modelHttp: requests.length,
			spentAttempts: 3,
			lostCreationNeverReplayed: true,
			unsignedHeaderCannotReplay: true,
			keyRotation: true,
			webuiRemovalPreservesIngress: true,
			viewerPrivateSetupDenied: true,
			evidence: run,
		}),
	);
} finally {
	await browser?.close();
	if (child) {
		child.stdin.end("stop\n");
		child.kill();
		await child.finished;
	}
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
