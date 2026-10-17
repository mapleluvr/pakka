import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createPocketSchedules } from "@pakka/server/pocket";
import { ownedBrowser } from "./pocket-browser.ts";

// Real installed CLI + public extension SDK, never a repository source import.
const root = dirname(fileURLToPath(import.meta.url)),
	run = join(root, "schedules-run-" + crypto.randomUUID()),
	cwd = join(run, "cwd"),
	dataDir = join(run, "data"),
	moduleFile = join(run, "composition.mjs"),
	ownerFile = join(run, "owner.txt");
await mkdir(cwd, { recursive: true });
await mkdir(dataDir, { recursive: true });
const requests = [],
	errors = [];
const provider = createServer((req, res) => {
	void (async () => {
		const chunks = [];
		for await (const bytes of req) chunks.push(Buffer.from(bytes));
		const body = parse(Buffer.concat(chunks).toString());
		requests.push(body);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "INSTALLED-SCHEDULE-RESULT" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "schedule-" + requests.length,
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
						usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
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
	apiKey: "SYNTHETIC-INSTALLED-SCHEDULE-KEY",
	limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
};
const until = async (predicate) => {
	const end = Date.now() + 12000;
	while (!(await predicate())) {
		assert.ok(Date.now() < end, "Installed schedule deadline");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
};
function parse(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw Error("Invalid owned schedule JSON", { cause: error });
	}
}
let child,
	browser,
	origin,
	webui = true,
	port;
async function start() {
	await writeFile(
		moduleFile,
		`import{createPocketSchedules}from'@pakka/server/pocket';import{workspaceSchedulesExtensionRoot,workspaceSchedulesService}from'@pakka/webui/workflows';const prepared=createPocketSchedules({namespace:'installed.schedules',maxSchedules:16});export default{runtime:{...${JSON.stringify(options)},jobs:[prepared.definition]},owner:'Owner',initial:[{name:'Scheduled project',profile:'default'}],${port ? `transport:{port:${port}},` : ""}extensions:[{root:workspaceSchedulesExtensionRoot,facets:${JSON.stringify(webui ? ["backend", "client", "webui"] : ["backend", "client"])}}],extensionServices:async context=>({schedules:await workspaceSchedulesService(context,prepared)})};`,
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
	assert.ok(out.includes("\n"), "Installed schedule startup: " + err);
	const info = parse(out.split("\n")[0]);
	let url;
	try {
		url = new URL(info.origin);
	} catch (error) {
		throw Error("Invalid owned schedule listener", { cause: error });
	}
	assert.equal(url.protocol, "http:");
	assert.equal(url.hostname, "127.0.0.1");
	assert.ok(url.port);
	assert.equal(url.pathname, "/");
	assert.equal(url.username + url.password + url.search + url.hash, "");
	assert.equal(url.origin, info.origin);
	origin = url.origin;
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
const ext = (page, ref, op) =>
	page.evaluate(
		`(async()=>{const{createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),row=(await client.list(${JSON.stringify(ref)})).find(row=>row.manifest.id==='workspace-schedules');return ${op};})()`,
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
	const list = await rpc(page, { op: "list" });
	assert.equal(list.kind, "list");
	assert.equal(list.conversations.length, 1);
	const target = list.conversations[0];
	await page.wait('document.querySelector("[data-interface=workspace-schedules-schedules]")');
	await page.click("[data-interface=workspace-schedules-schedules]");
	await page.wait('document.querySelector("[data-schedule-add]")');
	await page.type("[data-schedule-text]", "ONCE-INSTALLED-LOST-SCHEDULE");
	await page.evaluate('document.querySelector("[data-schedule-delay]").value=""');
	await page.type("[data-schedule-delay]", "2");
	await page.evaluate(
		`(()=>{const original=globalThis.fetch;globalThis.__scheduleWrites=0;globalThis.__restoreScheduleFetch=()=>{globalThis.fetch=original;};globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&args[1].body.includes('"action":"add"')){globalThis.__scheduleWrites++;globalThis.__originalSchedule=JSON.parse(args[1].body).command.call;const response=await original(...args);await response.arrayBuffer();throw Error('TEST LOST COMMITTED SCHEDULE RESPONSE');}return original(...args);};})()`,
	);
	await page.click("[data-schedule-add]");
	await page.wait('document.querySelector("[data-schedule-reconcile]")?.disabled===false');
	const original = await page.evaluate(
		"({extension:globalThis.__originalSchedule.extension,requestId:globalThis.__originalSchedule.requestId,target:globalThis.__originalSchedule.target})",
	);
	await page.evaluate("globalThis.__restoreScheduleFetch()");
	await page.click("[data-conversation]");
	await page.wait('document.querySelector("textarea[name=message]")');
	await page.click("[data-interface=workspace-schedules-schedules]");
	await page.wait('document.querySelector("[data-schedule-reconcile]")?.disabled===false');
	// The extension stylesheet can arrive after the pending button is rendered.
	await page.wait(
		'Array.from(document.querySelectorAll("link[rel=stylesheet]")).some(link => link.href.endsWith("/schedules.css") && !!link.sheet)',
	);
	await page.click("[data-schedule-reconcile]");
	await page.wait('!document.querySelector("[data-schedule-reconcile]")');
	assert.equal(await page.evaluate("globalThis.__scheduleWrites"), 1);
	await until(() => requests.length === 1);
	await page.wait('document.querySelector("[data-schedule-state]")?.textContent.includes("done")');
	const before = await ext(
		page,
		target,
		"(await client.call({extension:row.manifest.id,generation:row.generation,action:'list',requestId:crypto.randomUUID(),target:" +
			JSON.stringify(target) +
			",input:{}})).value.schedules",
	);
	assert.equal(before.length, 1);
	assert.equal((await rpc(page, { op: "wait", id: before[0].deliveryId })).receipt.status, "done");
	await page.evaluate('document.querySelector("[data-schedule-text]").value=""');
	await page.type("[data-schedule-text]", "AFTER-REOPEN-WITHOUT-WEBUI-FACET");
	await page.evaluate('document.querySelector("[data-schedule-delay]").value=""');
	await page.type("[data-schedule-delay]", "5");
	assert.equal(await page.evaluate('document.querySelector("[data-schedule-delay]").value'), "5");
	await page.click("[data-schedule-add]");
	await page.wait('document.querySelectorAll("[data-schedule]").length===2');
	await stop();
	const prepared = createPocketSchedules({ namespace: "installed.schedules", maxSchedules: 16 });
	let runtime = await createRuntime({
		...options,
		reopenSessionFile: info.sessionFile,
		jobs: [prepared.definition],
	});
	let saved;
	try {
		saved = await runtime.store({ namespace: "installed.schedules", maxBytes: 1048576 }).snapshot();
		assert.equal(saved.data.rows.length, 2);
		assert.equal(runtime.view().budget.primaryAttempts, 1);
		const future = saved.data.rows[1];
		assert.equal(
			(
				await runtime
					.jobs({ namespace: "installed.schedules.jobs", maxJobs: 16, maxBytes: 1048576 })
					.receipt(future.jobId, () => {})
			).checkpoint.nextDueAt,
			future.input.dueAt,
		);
		await writeFile(join(run, "before-reopen.json"), JSON.stringify(saved.data, null, 2));
	} finally {
		await runtime.close();
	}
	options = { ...options, reopenSessionFile: info.sessionFile };
	webui = false;
	const priorOrigin = origin;
	info = await start();
	assert.equal(origin, priorOrigin);
	await page.navigate(origin + "/#conversation=" + target.conversationId);
	await page.wait('document.querySelector("textarea[name=message]")');
	await page.wait('!document.querySelector("[data-interface=workspace-schedules-schedules]")');
	await until(() => requests.length === 2);
	await page.wait('document.querySelector("main").innerText.includes("INSTALLED-SCHEDULE-RESULT")');
	const after = await ext(
		page,
		target,
		"(await client.call({extension:row.manifest.id,generation:row.generation,action:'list',requestId:crypto.randomUUID(),target:" +
			JSON.stringify(target) +
			",input:{}})).value.schedules",
	);
	assert.equal(after.length, 2);
	assert.deepEqual(
		after.map((row) => row.jobId),
		saved.data.rows.map((row) => row.jobId),
	);
	assert.ok(after.every((row) => row.state === "done"));
	const deliveries = [];
	for (const row of after) {
		const result = await rpc(page, { op: "wait", id: row.deliveryId });
		assert.equal(result.kind, "receipt");
		assert.equal(result.receipt.status, "done");
		assert.deepEqual(result.receipt.target, target);
		deliveries.push(result.receipt);
	}
	await writeFile(join(run, "native-deliveries.json"), JSON.stringify(deliveries, null, 2));
	const recovered = await ext(
		page,
		target,
		"await client.operationByRequest(" + JSON.stringify(original) + ")",
	);
	assert.equal(recovered.state, "done");
	assert.equal(requests.length, 2);
	await stop();
	runtime = await createRuntime({
		...options,
		jobs: [createPocketSchedules({ namespace: "installed.schedules", maxSchedules: 16 }).definition],
	});
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		assert.equal(runtime.view().sessionId, target.sessionId);
		await writeFile(
			join(run, "after-reopen.json"),
			JSON.stringify(
				(await runtime.store({ namespace: "installed.schedules", maxBytes: 1048576 }).snapshot()).data,
				null,
				2,
			),
		);
	} finally {
		await runtime.close();
	}
	assert.ok(JSON.stringify(requests[0]).includes("ONCE-INSTALLED-LOST-SCHEDULE"));
	assert.ok(JSON.stringify(requests[1]).includes("AFTER-REOPEN-WITHOUT-WEBUI-FACET"));
	assert.equal(errors.length, 0);
	await writeFile(join(run, "provider-requests.json"), JSON.stringify(requests, null, 2) + "\n");
	console.log(
		JSON.stringify({
			installedSchedules: true,
			modelHttp: requests.length,
			spentAttempts: 2,
			lostResponseNeverReplayed: true,
			nativeJobsPreserved: true,
			webuiRemovalPreservesWork: true,
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
	await new Promise((resolve) => provider.close(() => resolve()));
}
