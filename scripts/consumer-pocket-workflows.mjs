import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";
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
let child, runtime;
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
async function submit(client, target, requestId) {
	const placed = await client.rpc({
		op: "submit",
		target,
		input: { requestId, text: "EXPLICIT-WORKFLOW-WORK", mode: "prompt" },
	});
	return client.rpc({ op: "wait", id: placed.receipt.id });
}
try {
	let info = await start();
	const token = new URLSearchParams(new URL((await readFile(ownerFile, "utf8")).trim()).hash.slice(1)).get(
		"session",
	);
	assert.ok(token);
	assert.equal(child.captured().includes(token), false);
	let owner = await loginHttp(info.origin, token);
	const refs = (await owner.rpc({ op: "list" })).conversations,
		ref = refs[0];
	assert.equal(refs.length, 2);
	await owner.rpc({
		op: "collaboration.post",
		target: ref,
		input: { requestId: "chat", text: "INSTALLED-HUMAN-CHAT-CANARY" },
	});
	await owner.services({
		op: "notebook.write",
		change: {
			requestId: "installed-note-save",
			target: ref,
			action: {
				kind: "save",
				id: "installed-note",
				expectedVersion: 0,
				title: "Installed note",
				body: "INSTALLED-HUMAN-NOTE-CANARY",
				sources: [],
			},
		},
	});
	const note = (await owner.services({ op: "notebook.note", target: ref, id: "installed-note" })).note;
	assert.equal(note.version, 1);
	assert.equal(note.body, "INSTALLED-HUMAN-NOTE-CANARY");
	const shared = (await owner.rpc({ op: "collaboration.read", target: ref })).snapshot;
	assert.equal(shared.messages.length, 1);
	assert.equal(shared.messages[0].authorName, "Owner");
	const invited = await owner.rpc({
		op: "invite",
		requestId: "viewer",
		role: "viewer",
		resources: [ref.conversationId],
		ttlMs: 60000,
	});
	let viewer = await loginHttp(info.origin, invited.token, "invite", "Viewer");
	assert.deepEqual(
		(await viewer.rpc({ op: "list" })).conversations.map((row) => row.conversationId),
		[ref.conversationId],
	);
	assert.equal(
		(await viewer.rpc({ op: "collaboration.read", target: ref })).snapshot.messages[0].text,
		"INSTALLED-HUMAN-CHAT-CANARY",
	);
	await assert.rejects(viewer.rpc({ op: "read", target: refs[1] }), { code: "FORBIDDEN", outcome: "denied" });
	const original = await owner.call("workspace-files", "read", { root: "project", path: "readme.txt" }, ref);
	assert.equal(original.value.text, "ORIGINAL-FILE\n");
	const editInput = {
		root: "project",
		path: "readme.txt",
		expectedSha256: original.value.sha256,
		text: "INSTALLED-FILE-EDIT\n",
	};
	const edit = await owner.call("workspace-files", "write", editInput, ref, "stable-installed-edit");
	assert.equal(edit.state, "done");
	assert.equal(edit.value.state, "done");
	assert.equal(await readFile(join(cwd, "readme.txt"), "utf8"), editInput.text);
	const diff = await owner.call("workspace-files", "diff", { root: "project", path: "readme.txt" }, ref);
	assert.match(JSON.stringify(diff.value), /\+INSTALLED-FILE-EDIT/);
	await assert.rejects(viewer.call("workspace-files", "write", editInput, ref), {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	assert.equal(requests.length, 0);
	const result = await submit(owner, ref, "before-reopen");
	assert.equal(result.receipt.status, "done");
	assert.equal(requests.length, 1);
	assert.doesNotMatch(
		JSON.stringify(requests),
		/INSTALLED-HUMAN-CHAT-CANARY|INSTALLED-HUMAN-NOTE-CANARY|INSTALLED-FILE-EDIT/,
	);
	const firstId = info.sessionFile;
	await stop();
	runtimeOptions.reopenSessionFile = firstId;
	info = await start();
	assert.equal(info.sessionFile, firstId);
	owner = await connectHttp(info.origin, owner.cookies);
	viewer = await connectHttp(info.origin, viewer.cookies);
	const retained = (await owner.rpc({ op: "collaboration.read", target: ref })).snapshot;
	const retainedNote = (await owner.services({ op: "notebook.note", target: ref, id: "installed-note" }))
		.note;
	assert.deepEqual(retainedNote, note);
	assert.equal(retained.messages[0].text, "INSTALLED-HUMAN-CHAT-CANARY");
	assert.deepEqual((await owner.rpc({ op: "list" })).conversations, refs);
	assert.equal((await owner.rpc({ op: "receipt", id: result.receipt.id })).receipt.status, "done");
	await writeFile(join(cwd, "readme.txt"), "LATER-OUTSIDE-EDIT\n");
	const recovered = await owner.operationByRequest("workspace-files", "stable-installed-edit", ref);
	assert.equal(recovered.id, edit.id);
	assert.equal(recovered.value.state, "done");
	const duplicate = await owner.call("workspace-files", "write", editInput, ref, "stable-installed-edit");
	assert.equal(duplicate.id, edit.id);
	assert.equal(await readFile(join(cwd, "readme.txt"), "utf8"), "LATER-OUTSIDE-EDIT\n");
	assert.equal(requests.length, 1);
	assert.equal((await submit(owner, ref, "after-reopen")).receipt.status, "done");
	assert.equal(requests.length, 2);
	await owner.rpc({ op: "person.revoke", id: viewer.person.id });
	await assert.rejects(viewer.rpc({ op: "list" }), (error) =>
		["FORBIDDEN", "UNAUTHORIZED"].includes(error.code),
	);
	assert.deepEqual(errors, []);
	assert.equal(child.captured().includes(runtimeOptions.apiKey), false);
	await stop();
	runtime = await createRuntime(runtimeOptions);
	assert.equal(runtime.view().budget.primaryAttempts, 2);
	await runtime.close();
	runtime = undefined;
	console.log(
		"Installed workflow HTTP passed: attributed chat/note, scoped viewer, real file/diff, original operation and idempotent duplicate after reopen; 2 local model requests.",
	);
} finally {
	if (child) {
		child.kill();
		await child.finished;
	}
	await runtime?.close();
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
