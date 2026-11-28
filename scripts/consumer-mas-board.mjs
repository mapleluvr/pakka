import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createMasProfilePacks } from "@pakka/mas-devpack/agent";
import { createMas } from "@pakka/mas";
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";

const root = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	errors = [];
function decode(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error("Invalid installed Board JSON", { cause: error });
	}
}
let peer;
const provider = createServer((req, res) => {
	void (async () => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const body = decode(raw);
		requests.push(body);
		const input = JSON.stringify(body.messages),
			last = body.messages.at(-1),
			enabled = body.tools?.some((tool) => tool.function?.name === "mas_spawn");
		let tool, args;
		if (enabled && last?.role !== "tool" && !input.includes("HUMAN-INSTALLED-REPLY")) {
			if (input.includes("SEND-INSTALLED-PEER")) {
				assert.ok(peer);
				tool = "mas_send";
				args = { target: peer, requestId: "installed-native-peer", text: "REAL-INSTALLED-INCOMING" };
			} else if (input.includes("CREATE-INSTALLED-CHILD")) {
				tool = "mas_spawn";
				args = { key: "installed-child", profile: "plain", lifetime: "persistent" };
			}
		}
		const delta = tool
			? {
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "board-call-" + requests.length,
							type: "function",
							function: { name: tool, arguments: JSON.stringify(args) },
						},
					],
				}
			: { role: "assistant", content: "INSTALLED-MAS-NATIVE-DONE" };
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "board-" + requests.length,
						object: "chat.completion.chunk",
						created: 1,
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
const run = join(root, "mas-run-" + crypto.randomUUID());
await mkdir(run);
const cwd = join(run, "mas-board-cwd"),
	dataDir = join(run, "mas-board-data"),
	configFile = join(run, "mas-board.json"),
	moduleFile = join(run, "mas-board-composition.mjs"),
	ownerFile = join(run, "mas-board-owner.txt"),
	evidence = join(run, "mas-board-evidence");
await Promise.all([mkdir(cwd), mkdir(dataDir), mkdir(evidence)]);
let config = {
	runtime: {
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + provider.address().port + "/v1",
		model: "local",
		apiKey: "PRIVATE-BOARD-PROVIDER-CANARY",
		limits: { maxConversations: 8, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
	},
	agent: true,
	ui: true,
};
await writeFile(
	moduleFile,
	`import {readFile} from 'node:fs/promises';
import {createMas} from '@pakka/mas';
import {createMasProfilePacks,validateRetainedMasRoots} from '@pakka/mas-devpack/agent';
import {masExtensionRoot,masWorkbenchService} from '@pakka/mas-devpack/backend';
let config;try{config=JSON.parse(await readFile(new URL('./mas-board.json',import.meta.url),'utf8'));}catch{throw new Error('Invalid fixed installed configuration');}
let mas;const pack=createMasProfilePacks({profiles:{team:['spawn','send','reply','steer']}},()=>mas).get('team');
export default {runtime:{...config.runtime,profiles:[{id:'team',tools:pack.tools,systemPrompt:pack.instructions},{id:'plain',tools:[]}]},owner:'Operator',profiles:['plain'],initial:[{name:'Ordinary work',profile:'plain'}],extensions:[{root:masExtensionRoot,facets:config.ui?['backend','webui','client']:['backend','client']}],extensionServices:async context=>{
mas=await createMas({runtime:context.runtime,namespace:'installed.pocket.team',maxDeliveries:32,maxPending:8});let saved=(await mas.view()).members;const current=saved.find(row=>row.key==='coordinator');if(!config.agent&&current&&current.ref.profile!=='plain'){await mas.connect({principal:context.ownerId,source:null,grants:['configure']}).configure(current.ref,'plain');saved=(await mas.view()).members;}const roots=[{key:'coordinator',owner:context.ownerId,profile:config.agent?'team':'plain'}];if(saved.length)validateRetainedMasRoots(saved,roots);else await mas.bootstrap(roots);await mas.activate();return{mas:masWorkbenchService({...context,mas})};}};
`,
);
let child, runtime;
async function start() {
	await writeFile(configFile, JSON.stringify(config));
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
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (part) => {
		stdout += String(part);
	});
	child.stderr.on("data", (part) => {
		stderr += String(part);
	});
	child.finished = new Promise((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	const deadline = Date.now() + 10000;
	while (!stdout.includes("\n") && child.exitCode === null && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 25));
	assert.ok(stdout.includes("\n"), "Installed MAS startup: " + stderr);
	const info = decode(stdout.split("\n")[0]);
	let address;
	try {
		address = new URL(info.origin);
	} catch (error) {
		throw new Error("Invalid owned installed listener", { cause: error });
	}
	assert.equal(address.protocol, "http:");
	assert.equal(address.hostname, "127.0.0.1");
	assert.ok(address.port);
	assert.equal(address.origin, info.origin);
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
const until = async (predicate) => {
	const end = Date.now() + 12000;
	while (!(await predicate())) {
		assert.ok(Date.now() < end, "Installed MAS deadline");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
};
const call = (client, action, input = {}, target, requestId) =>
	client.call("mas-devpack", action, input, target, requestId);
async function completed(client, target, operation) {
	assert.equal(operation.state, "done");
	let receipt;
	await until(async () => {
		receipt = (await call(client, "receipt", { id: operation.value.id }, target)).value;
		return receipt.status === "done";
	});
	return receipt;
}
try {
	let info = await start();
	const token = new URLSearchParams(new URL((await readFile(ownerFile, "utf8")).trim()).hash.slice(1)).get(
		"session",
	);
	assert.ok(token);
	assert.equal(child.captured().includes(token), false);
	let owner = await loginHttp(info.origin, token);
	const ordinary = (await owner.rpc({ op: "list" })).conversations.find((row) => row.profile === "plain");
	const firstView = (await call(owner, "view")).value;
	const coordinator = firstView.members.find((row) => row.key === "coordinator");
	const firstRegistration = (await owner.extensions({ op: "list" })).registrations.find(
		(row) => row.manifest.id === "mas-devpack" && row.facet === "backend",
	);
	const first = await call(
		owner,
		"send",
		{ text: "CREATE-INSTALLED-CHILD" },
		coordinator.ref,
		"installed-spawn",
	);
	const firstReceipt = await completed(owner, coordinator.ref, first);
	const firstReceiptId = firstReceipt.id;
	assert.equal(requests.length, 2);
	const members = (await call(owner, "view")).value.members,
		member = members.find((row) => row.key === "installed-child");
	assert.ok(member);
	assert.equal(member.parent, "coordinator");
	assert.equal(member.creator, "coordinator");
	assert.equal(member.creationKnown, true);
	assert.equal(member.lifetime, "persistent");
	peer = member.ref;
	await completed(
		owner,
		coordinator.ref,
		await call(owner, "send", { text: "SEND-INSTALLED-PEER" }, coordinator.ref, "installed-peer"),
	);
	let incoming;
	await until(async () => {
		incoming = (await call(owner, "inbox", {}, member.ref)).value.find(
			(row) => row.source?.conversationId === coordinator.ref.conversationId,
		);
		return !!incoming && requests.length === 5;
	});
	await completed(owner, member.ref, { state: "done", value: { id: incoming.id } });
	const invitation = await owner.rpc({
		op: "invite",
		requestId: "installed-child-reader",
		role: "viewer",
		resources: [member.ref.conversationId],
		ttlMs: 60000,
	});
	const viewer = await loginHttp(info.origin, invitation.token, "invite", "Installed viewer");
	const filtered = (await call(viewer, "view")).value;
	assert.equal(filtered.members.length, 1);
	assert.equal(filtered.members[0].parent, null);
	assert.equal(filtered.members[0].owner, null);
	assert.ok(!JSON.stringify(filtered).includes('"key":"coordinator"'));
	assert.deepEqual(filtered.connections, []);
	assert.deepEqual((await call(viewer, "history")).value.items, []);
	await assert.rejects(call(viewer, "send", { text: "DENIED" }, member.ref), {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	const reply = await call(
		owner,
		"reply",
		{ id: incoming.id, text: "HUMAN-INSTALLED-REPLY" },
		member.ref,
		"installed-reply",
	);
	await completed(owner, member.ref, reply);
	assert.equal(requests.length, 6);
	const history = (await call(owner, "history")).value;
	assert.ok(
		history.items.some(
			(row) =>
				row.text === "HUMAN-INSTALLED-REPLY" && row.initiator === "human" && row.replyTo === incoming.id,
		),
	);
	assert.equal((await call(owner, "retire", {}, member.ref)).value.phase, "retired");
	assert.equal(requests.length, 6);
	await stop();
	config = {
		...config,
		agent: false,
		ui: false,
		runtime: { ...config.runtime, reopenSessionFile: info.sessionFile },
	};
	info = await start();
	owner = await connectHttp(info.origin, owner.cookies);
	assert.ok(
		!(await owner.extensions({ op: "list" })).registrations.some(
			(row) => row.manifest.id === "mas-devpack" && row.facet === "webui",
		),
	);
	const retained = (await call(owner, "view")).value.members,
		currentCoordinator = retained.find((row) => row.key === "coordinator").ref;
	assert.equal(currentCoordinator.sessionId, coordinator.ref.sessionId);
	assert.equal(currentCoordinator.conversationId, coordinator.ref.conversationId);
	assert.equal(currentCoordinator.profile, "plain");
	assert.notEqual(currentCoordinator.incarnation, coordinator.ref.incarnation);
	assert.deepEqual(retained.find((row) => row.key === "installed-child").ref, member.ref);
	assert.equal(retained.find((row) => row.key === "installed-child").phase, "retired");
	await assert.rejects(
		owner.extensions({
			op: "call",
			call: {
				extension: "mas-devpack",
				generation: firstRegistration.generation,
				action: "view",
				requestId: "stale",
				input: {},
			},
		}),
		{ code: "FORBIDDEN", outcome: "denied" },
	);
	assert.equal(
		(await owner.operationByRequest("mas-devpack", "installed-spawn", coordinator.ref)).id,
		first.id,
	);
	await completed(
		owner,
		currentCoordinator,
		await call(owner, "send", { text: "CHECK-PLAIN-APPROVED-TOOLS" }, currentCoordinator, "after-removal"),
	);
	assert.equal(requests.length, 7);
	assert.ok(!JSON.stringify(requests.at(-1).tools ?? []).includes("mas_spawn"));
	const ordinaryReceipt = await owner.rpc({
		op: "submit",
		target: ordinary,
		input: { requestId: "ordinary", text: "ORDINARY-AFTER-MAS-UI-REMOVAL", mode: "prompt" },
	});
	assert.equal((await owner.rpc({ op: "wait", id: ordinaryReceipt.receipt.id })).receipt.status, "done");
	assert.equal(requests.length, 8);
	await stop();
	const verifyPack = createMasProfilePacks(
		{ profiles: { team: ["spawn", "send", "reply", "steer"] } },
		() => undefined,
	).get("team");
	runtime = await createRuntime({
		...config.runtime,
		profiles: [
			{ id: "team", tools: verifyPack.tools, systemPrompt: verifyPack.instructions },
			{ id: "plain", tools: [] },
		],
	});
	assert.equal(runtime.view().budget.primaryAttempts, 8);
	const mas = await createMas({
		runtime,
		namespace: "installed.pocket.team",
		maxDeliveries: 32,
		maxPending: 8,
	});
	assert.deepEqual(
		(await mas.view()).members.map((row) => row.ref),
		retained.map((row) => row.ref),
	);
	const receipt = await runtime
		.catalog({ namespace: "installed.pocket.team", maxDeliveries: 32, maxPending: 8 })
		.receipt(firstReceiptId, () => {});
	assert.equal(receipt.status, "done");
	assert.equal(receipt.entryId, firstReceipt.entryId);
	const savedHistory = await runtime.readConversation(currentCoordinator, () => {});
	assert.match(JSON.stringify(savedHistory.entries), /HUMAN-INSTALLED-REPLY/);
	assert.match(JSON.stringify(savedHistory.entries), /CREATE-INSTALLED-CHILD/);
	await runtime.close();
	runtime = undefined;
	assert.deepEqual(errors, []);
	await writeFile(join(evidence, "requests.json"), JSON.stringify(requests, null, 2));
	console.log(
		"Installed MAS HTTP passed: native spawn/send/reply, scoped viewer, retire and facet removal, stale Backend generation refused, original receipt/history and ordinary input after reopen; 8 model requests/attempts.",
	);
} finally {
	await runtime?.close();
	if (child) {
		child.kill();
		await child.finished;
	}
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
