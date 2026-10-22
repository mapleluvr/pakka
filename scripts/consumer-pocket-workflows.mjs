import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { ownedBrowser } from "./pocket-browser.ts";
import { conversationAction, openConversations } from "./frontend-controls.ts";
const root = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	errors = [];
function json(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error("Invalid installed workflow JSON", { cause: error });
	}
}
const provider = createServer((req, res) => {
	void (async () => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const body = json(raw);
		requests.push(body);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "INSTALLED-WORKFLOW-ANSWER" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "workflow-" + requests.length,
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
						usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 },
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
const run = join(root, "workflows-run-" + crypto.randomUUID());
await mkdir(run);
const cwd = join(run, "workflows-cwd"),
	dataDir = join(run, "workflows-data"),
	moduleFile = join(run, "workflows-composition.mjs"),
	ownerFile = join(run, "workflows-owner.txt"),
	evidence = join(run, "workflows-evidence");
await Promise.all([mkdir(cwd), mkdir(dataDir), mkdir(evidence)]);
await writeFile(join(cwd, "readme.txt"), "ORIGINAL-FILE\n");
const git = (...args) =>
	execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid.test", ...args], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
git("init", "-b", "main");
git("add", "readme.txt");
git("commit", "-m", "initial");
const runtimeOptions = {
	cwd,
	dataDir,
	endpoint: "http://127.0.0.1:" + address.port + "/v1",
	model: "local",
	apiKey: "PRIVATE-WORKFLOW-PROVIDER-CANARY",
	limits: { maxConversations: 6, maxPrimaryAttempts: 2, maxAuxiliaryAttempts: 2 },
};
async function composition() {
	await writeFile(
		moduleFile,
		`import {workspaceFilesExtensionRoot,workspaceFilesService} from '@pakka/webui/workflows';
const runtime=${JSON.stringify(runtimeOptions)};
export default {runtime,owner:'Owner',initial:[{name:'Shared project',profile:'default'},{name:'Private project',profile:'default'}],extensions:[{root:workspaceFilesExtensionRoot,facets:['backend','webui','client']}],extensionServices:async context=>({files:await workspaceFilesService(context,{namespace:'installed.files',roots:[{id:'project',path:runtime.cwd,resources:'*',writable:true,git:true,worktreesDir:${JSON.stringify(join(run, "workflows-parallel"))}}]})})};\n`,
	);
}
let child, browser, runtime;
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
	let output = "",
		err = "";
	child.stdout.on("data", (bytes) => {
		output += String(bytes);
	});
	child.stderr.on("data", (bytes) => {
		err += String(bytes);
	});
	child.finished = new Promise((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	const until = Date.now() + 10000;
	while (!output.includes("\n") && child.exitCode === null && Date.now() < until)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(output.includes("\n"), "Installed workflow startup failed: " + err);
	const value = json(output.split("\n")[0]);
	let url;
	try {
		url = new URL(value.origin);
	} catch (error) {
		throw new Error("Invalid owned workflow listener", { cause: error });
	}
	assert.equal(url.protocol, "http:");
	assert.equal(url.hostname, "127.0.0.1");
	assert.equal(url.origin, value.origin);
	assert.ok(url.port);
	child.captured = () => output + err;
	assert.equal(child.captured().includes(runtimeOptions.apiKey), false);
	return value;
}
async function stop() {
	if (!child) return;
	child.stdin.end("stop\n");
	assert.equal(await child.finished, 0);
	child = undefined;
}
async function click(page, selector) {
	await page.wait(
		`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return !!n&&!n.disabled;})()`,
	);
	await page.click(selector);
}
async function rpc(page, command) {
	return page.evaluate(
		`(async()=>{const {createPocketClient}=await import('@pakka/client/pocket');return createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request(${JSON.stringify(command)});})()`,
	);
}
async function extension(page, ref, action, input, requestId = crypto.randomUUID()) {
	return page.evaluate(
		`(async()=>{const {createExtensionClient}=await import('@pakka/webui/client');const c=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),r=(await c.list(${JSON.stringify(ref)})).find(x=>x.manifest.id==='workspace-files');return c.call({extension:r.manifest.id,generation:r.generation,action:${JSON.stringify(action)},requestId:${JSON.stringify(requestId)},target:${JSON.stringify(ref)},input:${JSON.stringify(input)}});})()`,
	);
}
async function submit(page, ref, requestId) {
	const placed = await rpc(page, {
		op: "submit",
		target: ref,
		input: { requestId, text: "EXPLICIT-WORKFLOW-WORK", mode: "prompt" },
	});
	return rpc(page, { op: "wait", id: placed.receipt.id });
}
try {
	let info = await start();
	const link = (await readFile(ownerFile, "utf8")).trim();
	let signIn;
	try {
		signIn = new URL(link);
	} catch (error) {
		throw new Error("Invalid generated owner link", { cause: error });
	}
	const token = new URLSearchParams(signIn.hash.slice(1)).get("signin");
	assert.ok(token);
	assert.equal(child.captured().includes(token), false);
	browser = await ownedBrowser(join(run, "workflows-browser"));
	const owner = await browser.page(link);
	await owner.wait('document.querySelector("[data-action=signin]")');
	await click(owner, "[data-action=signin]");
	await owner.wait('document.querySelectorAll("[data-conversation]").length===2');
	const refs = (await rpc(owner, { op: "list" })).conversations,
		ref = refs[0];
	assert.ok(ref);
	await click(owner, `[data-conversation="${ref.conversationId}"]`);
	await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
	await conversationAction(owner, "collaboration");
	await owner.wait('document.querySelector("textarea[name=teamChat]")');
	await owner.type("textarea[name=teamChat]", "INSTALLED-HUMAN-CHAT-CANARY");
	await click(owner, "[data-action=post-chat]");
	await owner.wait(
		'document.querySelector("[data-chat-message]")?.textContent.includes("INSTALLED-HUMAN-CHAT-CANARY")',
	);
	await owner.type("textarea[name=sharedNote]", "INSTALLED-HUMAN-NOTE-CANARY");
	await click(owner, "[data-action=save-note]");
	await owner.wait(
		`(async()=>{const {createPocketClient}=await import('@pakka/client/pocket');const r=await createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:'collaboration.read',target:${JSON.stringify(ref)}});return r.snapshot.note.version===1;})()`,
	);
	const shared = await rpc(owner, { op: "collaboration.read", target: ref });
	assert.equal(shared.snapshot.note.version, 1);
	assert.equal(shared.snapshot.messages.length, 1);
	assert.equal(shared.snapshot.messages[0].authorName, "Owner");
	const invited = await rpc(owner, {
		op: "invite",
		requestId: "installed-workflow-viewer",
		role: "viewer",
		resources: [ref.conversationId],
		ttlMs: 60000,
	});
	assert.ok(invited.token);
	const viewer = await browser.page(info.origin + "/#invite=" + invited.token, { width: 390, height: 844 });
	await viewer.wait('document.querySelector("[data-action=signin]")');
	await viewer.type("input[name=person]", "Viewer");
	await click(viewer, "[data-action=signin]");
	await viewer.wait('document.querySelectorAll("[data-conversation]").length===1');
	const visible = await rpc(viewer, { op: "list" });
	assert.deepEqual(
		visible.conversations.map((row) => row.conversationId),
		[ref.conversationId],
	);
	assert.equal(
		(await rpc(viewer, { op: "collaboration.read", target: ref })).snapshot.messages[0].text,
		"INSTALLED-HUMAN-CHAT-CANARY",
	);
	await click(owner, '[aria-label="Close collaboration"]');
	await click(owner, "[data-interface=workspace-files-files]");
	await owner.wait(`document.querySelector('[data-file-path="readme.txt"]')`);
	await click(owner, '[data-file-path="readme.txt"]');
	await owner.wait('document.querySelector("[data-file-editor]")?.value.includes("ORIGINAL-FILE")');
	await owner.evaluate(
		`(()=>{const n=document.querySelector('[data-file-editor]');n.value=${JSON.stringify("INSTALLED-FILE-EDIT\n")};n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
	);
	await click(owner, "[data-file-save]");
	await owner.wait('document.querySelector("[data-file-status]")?.textContent.includes("Saved")');
	assert.equal(await readFile(join(cwd, "readme.txt"), "utf8"), "INSTALLED-FILE-EDIT\n");
	await click(owner, "[data-files-git]");
	await owner.wait(`document.querySelector('[data-change-path="readme.txt"]')`);
	await click(owner, '[data-change-path="readme.txt"]');
	await owner.wait(
		'document.querySelector("[data-file-diff]")?.textContent.includes("+INSTALLED-FILE-EDIT")',
	);
	const original = await extension(owner, ref, "read", { root: "project", path: "readme.txt" });
	assert.equal(original.value.text, "INSTALLED-FILE-EDIT\n");
	const editInput = {
			root: "project",
			path: "readme.txt",
			expectedSha256: original.value.sha256,
			text: "RESTORED-INSTALLED-EDIT\n",
		},
		edit = await extension(owner, ref, "write", editInput, "stable-installed-edit");
	assert.equal(edit.state, "done");
	assert.equal(edit.value.state, "done");
	assert.equal(await readFile(join(cwd, "readme.txt"), "utf8"), "RESTORED-INSTALLED-EDIT\n");
	assert.equal(requests.length, 0);
	const result = await submit(owner, ref, "before-reopen");
	assert.equal(result.receipt.status, "done");
	assert.equal(requests.length, 1);
	assert.doesNotMatch(
		JSON.stringify(requests),
		/INSTALLED-HUMAN-CHAT-CANARY|INSTALLED-HUMAN-NOTE-CANARY|INSTALLED-FILE-EDIT/,
	);
	await writeFile(join(evidence, "desktop.png"), await owner.screenshot());
	const firstId = info.sessionFile;
	await stop();
	runtimeOptions.reopenSessionFile = info.sessionFile;
	info = await start();
	assert.equal(info.sessionFile, firstId);
	await owner.navigate(info.origin);
	await owner.wait('document.querySelectorAll("[data-conversation]").length===2');
	const retained = await rpc(owner, { op: "collaboration.read", target: ref });
	assert.equal(retained.snapshot.note.text, "INSTALLED-HUMAN-NOTE-CANARY");
	assert.equal(retained.snapshot.messages[0].text, "INSTALLED-HUMAN-CHAT-CANARY");
	assert.deepEqual((await rpc(owner, { op: "list" })).conversations, refs);
	assert.equal((await rpc(owner, { op: "receipt", id: result.receipt.id })).receipt.status, "done");
	await writeFile(join(cwd, "readme.txt"), "LATER-OUTSIDE-EDIT\n");
	const duplicate = await extension(owner, ref, "write", editInput, "stable-installed-edit");
	assert.equal(duplicate.id, edit.id);
	assert.equal(duplicate.value.state, "done");
	assert.equal(await readFile(join(cwd, "readme.txt"), "utf8"), "LATER-OUTSIDE-EDIT\n");
	assert.equal(requests.length, 1);
	assert.equal((await submit(owner, ref, "after-reopen")).receipt.status, "done");
	assert.equal(requests.length, 2);
	await viewer.navigate(info.origin);
	await viewer.wait('document.querySelectorAll("[data-conversation]").length===1');
	await openConversations(viewer);
	await click(viewer, "[data-conversation]");
	await viewer.wait('document.querySelector("[data-action=send]")');
	const people = await rpc(owner, { op: "people" }),
		guest = people.people.find((row) => row.name === "Viewer");
	assert.ok(guest);
	await rpc(owner, { op: "person.revoke", id: guest.id });
	await viewer.wait('document.querySelector("[data-action=signin]")');
	assert.equal(await viewer.evaluate('document.querySelectorAll("[data-conversation]").length'), 0);
	await writeFile(join(evidence, "provider.json"), JSON.stringify(requests, null, 2));
	assert.deepEqual(errors, []);
	assert.equal(child.captured().includes(runtimeOptions.apiKey), false);
	await stop();
	runtime = await createRuntime({ ...runtimeOptions, reopenSessionFile: info.sessionFile });
	assert.equal(runtime.view().budget.primaryAttempts, 2);
	await writeFile(join(evidence, "runtime.json"), JSON.stringify(runtime.view(), null, 2));
	await runtime.close();
	runtime = undefined;
	console.log(
		JSON.stringify({
			pocketWorkflows: "ok",
			httpRequests: requests.length,
			cli: true,
			sharedAttribution: true,
			scopedViewer: true,
			realFileAndDiff: true,
			normalReopen: true,
			originalOperationNoReplay: true,
			spentAttempts: 2,
		}),
	);
} finally {
	child?.kill();
	await browser?.close();
	await runtime?.close();
	await new Promise((resolve) => provider.close(resolve));
}
