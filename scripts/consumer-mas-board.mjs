import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createMasProfilePacks } from "@pakka/mas-devpack/agent";
import { createMas } from "@pakka/mas";
import { ownedBrowser } from "./pocket-browser.ts";
import { openConversations } from "./frontend-controls.ts";

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
const cwd = join(root, "mas-board-cwd"),
	dataDir = join(root, "mas-board-data"),
	configFile = join(root, "mas-board.json"),
	moduleFile = join(root, "mas-board-composition.mjs"),
	ownerFile = join(root, "mas-board-owner.txt"),
	evidence = join(root, "mas-board-evidence");
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
let child, browser, runtime;
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
// Exercise the delivered same-origin client with the browser's own session, never a serialized native lease.
async function call(page, action, input = {}, target, requestId = crypto.randomUUID(), generation) {
	return page.evaluate(
		`(async()=>{const {createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null});const target=${JSON.stringify(target ?? null)};const rows=await client.list(target??undefined),registration=rows.find(row=>row.manifest.id==='mas-devpack');if(!registration)throw new Error('Installed registration missing');try{return {registration,operation:await client.call({extension:'mas-devpack',generation:${JSON.stringify(generation ?? null)}??registration.generation,action:${JSON.stringify(action)},requestId:${JSON.stringify(requestId)},input:${JSON.stringify(input)},...(target?{target}:{})})};}catch(error){return {error:{code:error.code,outcome:error.outcome}};}})()`,
	);
}
try {
	let info = await start();
	const link = (await readFile(ownerFile, "utf8")).trim(),
		token = new URLSearchParams(new URL(link).hash.slice(1)).get("signin");
	assert.ok(token);
	assert.equal(child.captured().includes(token), false);
	browser = await ownedBrowser(join(root, "mas-board-browser"));
	const owner = await browser.page(link);
	await owner.wait('document.querySelector("[data-action=signin]")');
	await owner.click("[data-action=signin]");
	await owner.wait('document.querySelector("[data-interface=mas-devpack-board]")');
	await owner.click("[data-interface=mas-devpack-board]");
	await owner.wait('document.querySelector("[data-member=coordinator]")');
	await owner.wait('[...document.querySelectorAll("link[rel=stylesheet]")].every((link) => link.sheet)');
	await owner.evaluate("document.fonts.ready.then(() => true)");
	await owner.wait(
		'document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).every((animation) => animation.playState !== "running")',
	);
	await owner.click("[data-member=coordinator]");
	await owner.click("[data-agent-details]");
	await owner.click('[data-agent-controls="coordinator"]');
	await owner.wait('document.querySelector("textarea[name=masMessage]")');
	assert.equal(
		await owner.evaluate(
			'document.querySelector("textarea[name=masMessage]").closest("[role=dialog]")?.getAttribute("aria-modal")',
		),
		"true",
	);
	assert.equal(
		await owner.evaluate(
			'!!document.querySelector("[data-member=coordinator][aria-pressed=true]") && !document.querySelector(".conversation-view")',
		),
		true,
		"Installed controls preserve the Board instead of embedding another composer",
	);
	await owner.type("textarea[name=masMessage]", "CREATE-INSTALLED-CHILD");
	await owner.click("[data-mas-send]");
	await owner.wait('/done/.test(document.querySelector("[data-mas-receipt]")?.textContent)');
	assert.equal(requests.length, 2);
	const firstReceiptId = String(
			await owner.evaluate('document.querySelector("[data-mas-receipt]").getAttribute("data-mas-receipt")'),
		),
		firstView = await call(owner, "view");
	assert.equal(firstView.operation.state, "done");
	const members = firstView.operation.value.members,
		coordinator = members.find((row) => row.key === "coordinator"),
		member = members.find((row) => row.key === "installed-child");
	assert.ok(member);
	assert.equal(firstView.operation.value.sessionId, member.ref.sessionId);
	assert.equal(member.parent, "coordinator");
	assert.equal(member.creator, "coordinator");
	assert.equal(member.creationKnown, true);
	assert.equal(member.lifetime, "persistent");
	peer = member.ref;
	const firstReceipt = (await call(owner, "receipt", { id: firstReceiptId }, coordinator.ref)).operation
		.value;
	assert.equal(firstReceipt.status, "done");
	const previous = await owner.evaluate('document.querySelector("[data-mas-receipt]").textContent');
	await owner.type("textarea[name=masMessage]", "SEND-INSTALLED-PEER");
	await owner.click("[data-mas-send]");
	await owner.wait(
		`document.querySelector("[data-mas-receipt]")?.textContent!==${JSON.stringify(previous)}&&/done/.test(document.querySelector("[data-mas-receipt]")?.textContent)`,
	);
	await owner.click('[aria-label="Close Agent controls"]');
	await owner.wait(
		'!document.querySelector("textarea[name=masMessage]") && document.activeElement?.getAttribute("data-agent-controls") === "coordinator"',
	);
	await owner.wait('document.querySelector("[data-member=installed-child]")');
	const invitation = await owner.evaluate(
		`(async()=>{const {createPocketClient}=await import('@pakka/client/pocket');const client=createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null});return client.request({op:'invite',requestId:'installed-child-reader',role:'viewer',resources:[${JSON.stringify(member.ref.conversationId)}],ttlMs:60000});})()`,
	);
	assert.ok(invitation.token);
	const viewer = await browser.page(info.origin + "/#invite=" + invitation.token, {
		width: 390,
		height: 844,
	});
	await viewer.wait('document.querySelector("[data-action=signin]")');
	await viewer.type("input[name=person]", "Installed viewer");
	await viewer.click("[data-action=signin]");
	await viewer.wait('document.querySelector("[data-interface=mas-devpack-board]")');
	await openConversations(viewer);
	await viewer.click("[data-interface=mas-devpack-board]");
	await viewer.wait('document.querySelector("[data-member=installed-child]")');
	const filtered = await call(viewer, "view");
	assert.equal(filtered.operation.value.members.length, 1);
	assert.equal(filtered.operation.value.members[0].parent, null);
	assert.equal(filtered.operation.value.members[0].owner, null);
	assert.equal(JSON.stringify(filtered.operation.value).includes('"key":"coordinator"'), false);
	const readerHistory = await call(viewer, "history");
	assert.deepEqual(readerHistory.operation.value.items, []);
	assert.deepEqual(filtered.operation.value.connections, []);
	assert.equal(await viewer.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
	await owner.wait(
		'document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).every(a=>a.playState!=="running")',
	);
	await owner.evaluate("document.fonts.ready.then(()=>true)");
	await viewer.wait(
		'document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).every(a=>a.playState!=="running")',
	);
	await viewer.evaluate("document.fonts.ready.then(()=>true)");
	await writeFile(join(evidence, "desktop.png"), await owner.screenshot());
	await writeFile(join(evidence, "mobile.png"), await viewer.screenshot());
	await owner.click("[data-member=installed-child]");
	if (await owner.evaluate('!document.querySelector("[data-agent-details]").parentElement.open'))
		await owner.click("[data-agent-details]");
	await owner.click('[data-agent-controls="installed-child"]');
	await owner.wait('document.querySelector("[data-mas-reply]")');
	assert.equal(requests.length, 5);
	await owner.type("textarea[name=masMessage]", "HUMAN-INSTALLED-REPLY");
	await owner.click("[data-mas-reply]");
	await owner.wait('/done/.test(document.querySelector("[data-mas-receipt]")?.textContent)');
	assert.equal(requests.length, 6);
	const deliveredHistory = (await call(owner, "history")).operation.value;
	assert.ok(
		deliveredHistory.items.some(
			(row) => row.text === "HUMAN-INSTALLED-REPLY" && row.initiator === "human" && row.replyTo,
		),
	);
	await writeFile(join(evidence, "exchanges.json"), JSON.stringify(deliveredHistory, null, 2));
	await owner.click("[data-mas-retire]");
	await owner.wait('document.querySelector("[data-mas-confirm-retire]")');
	await owner.click("[data-mas-confirm-retire]");
	await owner.wait('document.querySelector("[data-member-phase]")?.textContent === "retired"');
	await owner.click('[aria-label="Close Agent controls"]');
	await owner.wait(
		'!document.querySelector("textarea[name=masMessage]") && document.activeElement?.getAttribute("data-agent-controls") === "installed-child"',
	);
	await owner.wait('document.querySelector("[data-member=installed-child]")');
	await owner.click("[data-member=installed-child]");
	await owner.click('[data-open-conversation="installed-child"]');
	await owner.wait(
		`Array.from(document.querySelectorAll('[data-conversation]')).some(row=>row.dataset.conversation===${JSON.stringify(member.ref.conversationId)}&&row.getAttribute('aria-current')==='true')`,
	);
	await owner.click("[data-return-extension]");
	await owner.wait('document.querySelector("[data-member=installed-child][aria-pressed=true]")');
	assert.equal(requests.length, 6, "Installed Conversation navigation never replays work");
	if (await owner.evaluate('!document.querySelector("[data-agent-details]").parentElement.open'))
		await owner.click("[data-agent-details]");
	await owner.click("[data-hide-agent=installed-child]");
	await owner.wait('!document.querySelector("[data-member=installed-child]")');
	await owner.click("[data-board-tab=history]");
	await owner.wait(
		'document.querySelector(".graph-history")?.textContent.includes("REAL-INSTALLED-INCOMING")',
	);
	await owner.click("[data-board-tab=relationships]");
	await owner.click("[data-board-options]");
	await owner.click("[data-show-hidden-agents]");
	await owner.wait('document.querySelector("[data-member=installed-child]")');
	const afterPresentation = (await call(owner, "view")).operation.value.members;
	assert.equal(afterPresentation.find((row) => row.key === "installed-child").phase, "retired");
	assert.equal(requests.length, 6, "Retiring, hiding and restoring do not replay model work");
	await writeFile(join(evidence, "members-before.json"), JSON.stringify(afterPresentation, null, 2));
	await writeFile(join(evidence, "viewer.json"), JSON.stringify(filtered.operation.value, null, 2));
	const firstGeneration = firstView.registration.generation;
	await stop();
	config = {
		...config,
		agent: false,
		ui: false,
		runtime: { ...config.runtime, reopenSessionFile: info.sessionFile },
	};
	info = await start();
	await owner.navigate(info.origin);
	await owner.wait('document.querySelector("[data-conversation]")');
	assert.equal(
		await owner.evaluate('Boolean(document.querySelector("[data-interface=mas-devpack-board]"))'),
		false,
	);
	const restored = await call(owner, "view");
	const retained = restored.operation.value.members;
	const currentCoordinator = retained.find((row) => row.key === "coordinator").ref;
	assert.equal(currentCoordinator.sessionId, coordinator.ref.sessionId);
	assert.equal(currentCoordinator.conversationId, coordinator.ref.conversationId);
	assert.equal(currentCoordinator.profile, "plain");
	assert.notEqual(currentCoordinator.incarnation, coordinator.ref.incarnation);
	assert.deepEqual(retained.find((row) => row.key === "installed-child").ref, member.ref);
	assert.equal(retained.find((row) => row.key === "installed-child").phase, "retired");
	assert.deepEqual((await call(owner, "view", {}, undefined, "stale", firstGeneration)).error, {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	assert.equal(requests.length, 6);
	const manual = await call(
		owner,
		"send",
		{ text: "CHECK-PLAIN-APPROVED-TOOLS" },
		currentCoordinator,
		"manual-after-removal",
	);
	assert.equal(manual.operation.state, "done");
	const nativeId = manual.operation.value.id;
	await owner.wait(
		`(async()=>{const {createExtensionClient}=await import('@pakka/webui/client');const c=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),r=(await c.list(${JSON.stringify(currentCoordinator)})).find(x=>x.manifest.id==='mas-devpack'),o=await c.call({extension:'mas-devpack',generation:r.generation,action:'receipt',requestId:'observe',target:${JSON.stringify(currentCoordinator)},input:{id:${JSON.stringify(nativeId)}}});return o.state==='done'&&o.value.status==='done';})()`,
	);
	assert.equal(requests.length, 7);
	assert.equal(JSON.stringify(requests.at(-1).tools ?? []).includes("mas_spawn"), false);
	await owner.click("[data-conversation]");
	await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
	await owner.type("textarea[name=message]", "ORDINARY-AFTER-MAS-UI-REMOVAL");
	await owner.click("[data-action=send]");
	await owner.wait('document.querySelector("main").innerText.includes("INSTALLED-MAS-NATIVE-DONE")');
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
	const history = await runtime.readConversation(currentCoordinator, () => {});
	assert.match(JSON.stringify(history.entries), /HUMAN-INSTALLED-REPLY/);
	assert.match(JSON.stringify(history.entries), /CREATE-INSTALLED-CHILD/);
	await writeFile(
		join(evidence, "native-after.json"),
		JSON.stringify({ view: runtime.view(), receipt, history }, null, 2),
	);
	await runtime.close();
	runtime = undefined;
	assert.equal(requests.length, 8);
	assert.deepEqual(errors, []);
	await writeFile(join(evidence, "requests.json"), JSON.stringify(requests, null, 2));
	console.log(
		"Installed MAS Board passed: actual executable, public Agent/Backend/Client/WebUI exports, native spawn/send/reply, filtered mobile viewer, facet removal/normal reopen, original native receipt/history and 8 retained primary attempts; 8 local HTTP.",
	);
} finally {
	await runtime?.close();
	await browser?.close();
	if (child) {
		child.kill();
		await child.finished;
	}
	await new Promise((resolve) => provider.close(resolve));
}
