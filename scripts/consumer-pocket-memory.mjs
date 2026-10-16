import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createPocketMemory } from "@pakka/server/pocket";
import { ownedBrowser } from "./pocket-browser.ts";

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
	browser,
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
const rpc = (page, command) =>
	page.evaluate(
		`(async()=>{const{createPocketClient}=await import('@pakka/client/pocket');return createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request(${JSON.stringify(command)});})()`,
	);
const ext = (page, ref, operation) =>
	page.evaluate(
		`(async()=>{const{createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),target=${JSON.stringify(ref)},row=(await client.list(target)).find(row=>row.manifest.id==='workspace-memory');return ${operation};})()`,
	);
const readMemory = (page, ref) =>
	ext(
		page,
		ref,
		"(await client.call({extension:row.manifest.id,generation:row.generation,action:'read',requestId:crypto.randomUUID(),target,input:{}})).value",
	);
const system = (n) => JSON.stringify(requests[n].messages.filter((message) => message.role === "system"));
async function reloadProduct(page, target) {
	const before = await page.evaluate("performance.timeOrigin");
	await page.navigate(origin + "/#conversation=" + encodeURIComponent(target.conversationId));
	await page.reload();
	await page.wait(
		"performance.timeOrigin!==" +
			JSON.stringify(before) +
			'&&document.querySelector("textarea[name=message]")',
	);
}
async function work(page, target, text, count) {
	await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
	await page.type("textarea[name=message]", text);
	await page.click("[data-action=send]");
	await until(() => requests.length === count);
	await until(async () => !(await rpc(page, { op: "read", target })).snapshot.live.busy);
}
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
	let target = listed.conversations[0];
	await page.wait('document.querySelector("[data-interface=workspace-memory-memory]")');
	await page.click("[data-interface=workspace-memory-memory]");
	await page.wait('document.querySelector("[data-memory-text]")');
	await page.evaluate(
		`(()=>{const original=globalThis.fetch;globalThis.__memoryWrites=0;globalThis.__restoreMemoryFetch=()=>{globalThis.fetch=original;};globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&args[1].body.includes('"action":"add"')){globalThis.__memoryWrites++;globalThis.__originalMemory=JSON.parse(args[1].body).command.call;const response=await original(...args);await response.arrayBuffer();throw Error('TEST LOST COMMITTED MEMORY RESPONSE');}return original(...args);};})()`,
	);
	await page.type("[data-memory-text]", approvedText);
	await page.wait('document.querySelector("[data-memory-add]")?.disabled===false');
	await page.click("[data-memory-add]");
	await page.wait('document.querySelector("[data-memory-reconcile]")?.disabled===false');
	const original = await page.evaluate(
		"({extension:globalThis.__originalMemory.extension,requestId:globalThis.__originalMemory.requestId,target:globalThis.__originalMemory.target})",
	);
	await page.evaluate("globalThis.__restoreMemoryFetch()");
	await page.click("[data-conversation]");
	await page.wait('document.querySelector("textarea[name=message]")');
	await page.click("[data-interface=workspace-memory-memory]");
	await page.wait('document.querySelector("[data-memory-reconcile]")?.disabled===false');
	await page.click("[data-memory-reconcile]");
	await page.wait('!document.querySelector("[data-memory-reconcile]")');
	assert.equal(await page.evaluate("globalThis.__memoryWrites"), 1);
	assert.equal((await readMemory(page, target)).lessons.length, 1);
	assert.equal(requests.length, 0);
	await page.click("[data-conversation]");
	await work(page, target, "MODEL-PROPOSES-A-LESSON", 2);
	assert.ok(requests[0].tools.some((tool) => tool.function.name === "memory"));
	assert.ok(system(0).includes(approvedText));
	assert.ok(system(1).includes(approvedText));
	assert.equal(system(1).includes(pendingText), false);
	const content = requests[1].messages.find((message) => message.role === "tool")?.content;
	assert.equal(typeof content, "string");
	assert.equal(parse(content).lesson.pending, true);
	const before = await readMemory(page, target);
	assert.equal(before.lessons.length, 2);
	assert.equal(before.lessons.filter((lesson) => lesson.pending).length, 1);
	await stop();
	let runtime = await createRuntime({ ...runtimeOptions(), reopenSessionFile: info.sessionFile });
	let saved;
	try {
		saved = (await runtime.store({ namespace: memoryOptions.namespace, maxBytes: 1048576 }).snapshot()).data;
		assert.equal(saved.lessons.length, 2);
		assert.equal(saved.lessons.filter((lesson) => lesson.pending && lesson.byAgent).length, 1);
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		await writeFile(join(run, "before-reopen.json"), JSON.stringify(saved, null, 2));
		await writeFile(join(run, "before-view.json"), JSON.stringify(runtime.view(), null, 2));
	} finally {
		await runtime.close();
	}
	options = { ...options, reopenSessionFile: info.sessionFile };
	info = await start();
	await reloadProduct(page, target);
	await page.wait('document.querySelector("[data-interface=workspace-memory-memory]")');
	await page.click("[data-interface=workspace-memory-memory]");
	await page.wait('document.querySelector("[data-memory-approve]")?.disabled===false');
	assert.equal(await page.evaluate('document.querySelectorAll("[data-memory-lesson]").length'), 2);
	await page.click("[data-memory-approve]");
	await page.wait('!document.querySelector("[data-memory-pending]")');
	const recovered = await ext(
		page,
		target,
		"await client.operationByRequest(" + JSON.stringify(original) + ")",
	);
	assert.equal(recovered.state, "done");
	assert.equal(requests.length, 2);
	await page.click("[data-conversation]");
	await work(page, target, "AFTER-APPROVAL-AND-REOPEN", 3);
	assert.ok(system(2).includes(approvedText));
	assert.ok(system(2).includes(pendingText));
	await page.click("[data-interface=workspace-memory-memory]");
	await page.wait('document.querySelector("[data-memory-enabled]")?.disabled===false');
	await page.click("[data-memory-enabled]");
	await page.wait('document.querySelector("[data-memory-enabled]")?.getAttribute("aria-pressed")==="false"');
	await page.click("[data-conversation]");
	await work(page, target, "AFTER-AUTOMATIC-CONTEXT-DISABLED", 4);
	assert.equal(system(3).includes(approvedText), false);
	assert.equal(system(3).includes(pendingText), false);
	const configured = await rpc(page, { op: "configure", target, profile: "plain" });
	assert.equal(configured.kind, "reference");
	assert.equal(configured.ref.conversationId, target.conversationId);
	assert.notEqual(configured.ref.incarnation, target.incarnation);
	target = configured.ref;
	const activated = await ext(
		page,
		target,
		"await client.call({extension:row.manifest.id,generation:row.generation,action:'activation',requestId:crypto.randomUUID(),target,input:{enabled:true}})",
	);
	assert.equal(activated.state, "done");
	assert.equal((await readMemory(page, target)).enabled, true);
	await stop();
	webui = false;
	info = await start();
	await reloadProduct(page, target);
	assert.equal(
		await page.evaluate('document.querySelector("[data-interface=workspace-memory-memory]")'),
		null,
	);
	await work(page, target, "AFTER-WEBUI-REMOVAL-AND-PROFILE-SWITCH", 5);
	assert.equal(
		(requests[4].tools ?? []).some((tool) => tool.function.name === "memory"),
		false,
	);
	assert.equal(system(4).includes(approvedText), false);
	assert.equal(system(4).includes(pendingText), false);
	const after = await readMemory(page, target);
	assert.equal(after.enabled, true);
	assert.equal(after.lessons.length, 2);
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
		await writeFile(join(run, "after-view.json"), JSON.stringify(runtime.view(), null, 2));
		await writeFile(
			join(run, "after-reopen.json"),
			JSON.stringify(
				(await runtime.store({ namespace: memoryOptions.namespace, maxBytes: 1048576 }).snapshot()).data,
				null,
				2,
			),
		);
	} finally {
		await runtime.close();
	}
	await copyFile(info.sessionFile, join(run, "native-storage.jsonl"));
	assert.deepEqual(errors, []);
	await writeFile(join(run, "provider-requests.json"), JSON.stringify(requests, null, 2) + "\n");
	console.log(
		JSON.stringify({
			installedMemory: true,
			modelHttp: requests.length,
			spentAttempts: 5,
			nativeToolResults: 1,
			lostResponseNeverReplayed: true,
			approvedMemoryOnly: true,
			webuiRemovalPreservesRecords: true,
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
