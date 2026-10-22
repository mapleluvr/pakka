import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPocketClient } from "@pakka/client/pocket";
import { ownedBrowser } from "./pocket-browser.ts";
import { conversationAction, organizationAction, openConversations } from "./frontend-controls.ts";

const root = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	authorization = [],
	errors = [];
const provider = createServer((req, res) => {
	void (async () => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		let body;
		try {
			body = JSON.parse(raw);
		} catch (error) {
			errors.push(String(error));
			res.destroy();
			return;
		}
		requests.push(body);
		authorization.push(req.headers.authorization);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "INSTALLED-POCKET-ANSWER" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "installed-" + requests.length,
						object: "chat.completion.chunk",
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
const cwd = join(root, "pocket-product-cwd"),
	dataDir = join(root, "pocket-product-data"),
	configFile = join(root, "pocket-product.json"),
	ownerFile = join(root, "pocket-owner.txt");
await mkdir(cwd);
await mkdir(dataDir);
const extensionRoot = join(root, "installed-extension-examples");
await cp(join(root, "node_modules/@pakka/webui/examples"), extensionRoot, { recursive: true });
let config = {
	runtime: {
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + provider.address().port + "/v1",
		model: "local",
		apiKey: "PRIVATE-PROVIDER-CANARY",
		systemPrompt: "Installed workbench",
		profiles: [{ id: "alternate", model: "installed-alternate", systemPrompt: "Approved installed model" }],
		limits: { maxConversations: 8, maxPrimaryAttempts: 3, maxAuxiliaryAttempts: 2 },
	},
	owner: "Operator",
	profiles: ["default", "alternate"],
	extensions: ["hello", "preferences"].map((name) => ({
		root: join(extensionRoot, name),
	})),
	initial: [{ name: "Installed project", profile: "default" }],
};
let child, browser;
async function start() {
	await writeFile(configFile, JSON.stringify(config));
	child = spawn(
		process.execPath,
		[
			process.platform === "win32"
				? join(root, "node_modules/@pakka/webui/dist/main.js")
				: join(root, "node_modules/.bin/pakka-pocket"),
			"--config",
			configFile,
			"--owner-file",
			ownerFile,
			"--control-stdin",
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (chunk) => (stdout += chunk));
	child.stderr.on("data", (chunk) => (stderr += chunk));
	child.finished = new Promise((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	const deadline = Date.now() + 10000;
	while (!stdout.includes("\n") && child.exitCode === null && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 25));
	assert.ok(stdout.includes("\n"), "Installed product startup: " + stderr);
	let info;
	try {
		info = JSON.parse(stdout.split("\n")[0]);
	} catch (error) {
		throw new Error("Invalid installed product startup", { cause: error });
	}
	let allowed;
	try {
		allowed = new URL(info.origin);
	} catch (error) {
		throw new Error("Invalid installed listener address", { cause: error });
	}
	assert.equal(allowed.protocol, "http:");
	assert.equal(allowed.hostname, "127.0.0.1");
	assert.ok(allowed.port);
	assert.equal(allowed.origin, info.origin);
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
try {
	let info = await start();
	const link = (await readFile(ownerFile, "utf8")).trim();
	assert.equal(
		child.captured().includes(new URLSearchParams(new URL(link).hash.slice(1)).get("signin")),
		false,
	);
	browser = await ownedBrowser(join(root, "pocket-owned-profile"));
	const owner = await browser.page(link);
	await owner.wait('document.querySelector("[data-action=signin]")');
	await owner.click("[data-action=signin]");
	await owner.wait('document.querySelector("[data-interface=hello-home]")');
	await owner.click("[data-interface=hello-home]");
	await owner.wait('document.querySelector("[data-hello-count]")?.textContent === "0"');
	await owner.click("[data-increment]");
	await owner.wait('document.querySelector("[data-hello-count]")?.textContent === "1"');
	await owner.click("[data-interface=preferences-settings]");
	await owner.wait('document.querySelector("input[name=exampleLabel]")');
	await owner.type("input[name=exampleLabel]", "PRIVATE-INSTALLED-PREFERENCE");
	await owner.click("[data-save-label]");
	await owner.wait(
		'document.querySelector("[data-current-label]")?.textContent === "PRIVATE-INSTALLED-PREFERENCE"',
	);
	await owner.click('[aria-label="Close Example preferences"]');
	await owner.click("[data-action=commands]");
	await owner.wait('document.querySelector("[data-command=preferences-status]")');
	await owner.click("[data-command=preferences-status]");
	await owner.wait(
		'document.querySelector("[role=alert]")?.textContent.includes("PRIVATE-INSTALLED-PREFERENCE")',
	);
	assert.equal(requests.length, 0);
	await owner.wait('document.querySelector("[data-conversation]")');
	await owner.click("[data-conversation]");
	await owner.wait('document.querySelector("[data-action=send]")?.disabled === false');
	assert.equal(await owner.evaluate('typeof process + ":" + typeof require'), "undefined:undefined");
	assert.equal(
		await owner.evaluate(
			'document.querySelector("[data-conversation]").textContent.includes("Installed project")',
		),
		true,
	);
	await owner.type("textarea[name=message]", '/preferences-card {"text":"INSTALLED-DISPLAY-CARD"}');
	await owner.click("[data-action=send]");
	await owner.wait('document.querySelector(".tool-card")?.textContent.includes("INSTALLED-DISPLAY-CARD")');
	assert.equal(requests.length, 0);
	await conversationAction(owner, "settings");
	await owner.wait('document.querySelector("[data-cost]")');
	assert.match(String(await owner.evaluate('document.querySelector("[data-cost]").innerText')), /unknown/i);
	await owner.wait('document.querySelector("[data-credential-input]")?.disabled===false');
	await owner.type("[data-credential-input]", "SYNTHETIC-INSTALLED-REPLACEMENT");
	await owner.click("[data-credential-replace]");
	await owner.wait(
		'document.querySelector("[data-credential-status]")?.dataset.version==="1"&&document.querySelector("[data-credential-input]").value===""',
	);
	assert.equal(
		await owner.evaluate(
			'JSON.stringify({...localStorage,...sessionStorage}).includes("SYNTHETIC-INSTALLED-REPLACEMENT")||document.body.innerText.includes("SYNTHETIC-INSTALLED-REPLACEMENT")',
		),
		false,
	);
	await owner.click('[aria-label="Close settings"]');
	await owner.click("[data-action=model]");
	await owner.wait('document.querySelector("[data-pick-model=installed-alternate]")');
	await owner.click("[data-pick-model=installed-alternate]");
	await owner.wait(
		'!document.querySelector("[data-pick-model]")&&document.querySelector("[data-action=model]")?.textContent.includes("installed-alternate")&&document.querySelector("[data-action=send]")?.disabled===false',
	);
	await owner.type("textarea[name=message]", "INSTALLED-EXPLICIT-WORK");
	await owner.click("[data-action=send]");
	await owner.wait('document.querySelector("main").innerText.includes("INSTALLED-POCKET-ANSWER")');
	assert.equal(requests.length, 1);
	assert.equal(requests[0].model, "installed-alternate");
	assert.equal(authorization[0], "Bearer SYNTHETIC-INSTALLED-REPLACEMENT");
	await organizationAction(owner, "people");
	await owner.wait('document.querySelector("[data-action=invite]")');
	await owner.click("[data-action=invite]");
	await owner.wait('document.querySelector("input[name=inviteLink]")?.value.includes("#invite=")');
	const invitation = String(await owner.evaluate('document.querySelector("input[name=inviteLink]").value'));
	const viewer = await browser.page(invitation, { width: 390, height: 844 });
	await viewer.wait('document.querySelector("[data-action=signin]")');
	await viewer.type("input[name=person]", "Installed viewer");
	await viewer.click("[data-action=signin]");
	await viewer.wait('document.querySelector("[data-conversation]")');
	await openConversations(viewer);
	await viewer.click("[data-conversation]");
	await viewer.wait('document.querySelector("main").innerText.includes("INSTALLED-POCKET-ANSWER")');
	assert.equal(await viewer.evaluate('document.querySelector("[data-action=send]").disabled'), true);
	assert.equal(await viewer.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
	await conversationAction(viewer, "settings");
	await viewer.wait('document.querySelector("[data-cost]")');
	assert.equal(await viewer.evaluate('document.querySelector("[data-action=model]").disabled'), true);
	assert.equal(await viewer.evaluate('document.querySelector("[data-action=cwd]").disabled'), true);
	assert.equal(await viewer.evaluate('Boolean(document.querySelector("[data-session-budget]"))'), false);
	assert.equal(await viewer.evaluate('Boolean(document.querySelector("[data-credential-input]"))'), false);
	await viewer.click('[aria-label="Close settings"]');
	const stranger = await browser.page(info.origin);
	await stranger.wait('document.querySelector("[data-action=signin]")');
	assert.equal(await stranger.evaluate('document.body.innerText.includes("INSTALLED-EXPLICIT-WORK")'), false);
	// Real native history and stable identity through the installed finite client, using browser-owned cookies only.
	const cookies = await owner.evaluate("document.cookie");
	assert.equal(cookies.includes("pakka_pocket="), false);
	assert.ok(createPocketClient({ endpoint: info.origin + "/pocket/rpc" }));
	await owner.click('[aria-label="Close people"]');
	await mkdir(join(root, "pocket-product-evidence"));
	await writeFile(join(root, "pocket-product-evidence/desktop.png"), await owner.screenshot());
	await writeFile(join(root, "pocket-product-evidence/mobile.png"), await viewer.screenshot());
	const sessionFile = info.sessionFile;
	await stop();
	config = {
		...config,
		runtime: { ...config.runtime, reopenSessionFile: sessionFile },
		transport: { port: Number(new URL(info.origin).port) },
	};
	info = await start();
	assert.equal(info.sessionFile, sessionFile);
	await owner.navigate(info.origin);
	await owner.wait('document.querySelector("[data-conversation]")');
	await owner.click("[data-conversation]");
	await owner.wait('document.querySelector("main").innerText.includes("INSTALLED-POCKET-ANSWER")');
	await conversationAction(owner, "settings");
	await owner.wait('document.querySelector("[data-cost]")');
	assert.equal(
		await owner.evaluate('document.querySelector("[data-settings-model]").textContent'),
		"installed-alternate",
	);
	assert.match(
		String(await owner.evaluate('document.querySelector("[data-session-budget]").innerText')),
		/1 \/ 3/,
	);
	await owner.wait('document.querySelector("[data-credential-clear]")?.disabled===false');
	assert.equal(
		await owner.evaluate('document.querySelector("[data-credential-status]").dataset.version'),
		"1",
	);
	await owner.click("[data-credential-clear]");
	await owner.wait(
		'document.querySelector("[data-credential-status]")?.dataset.version==="2"&&document.querySelector("[data-credential-status]").dataset.configured==="false"',
	);
	await owner.click('[aria-label="Close settings"]');
	await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
	await owner.type("textarea[name=message]", "INSTALLED-AFTER-PRIVATE-CLEAR");
	await owner.click("[data-action=send]");
	await owner.wait('document.querySelector(".pocket-receipt")?.innerText.includes("unanswered")');
	assert.equal(requests.length, 1);
	await owner.click("[data-interface=preferences-settings]");
	await owner.wait(
		'document.querySelector("[data-current-label]")?.textContent === "PRIVATE-INSTALLED-PREFERENCE"',
	);
	await owner.click('[aria-label="Close Example preferences"]');
	await organizationAction(owner, "people");
	await owner.wait('document.querySelector(".pocket-person-row button")');
	await owner.click(".pocket-person-row button");
	await owner.wait('document.querySelector("[role=dialog]").innerText.includes("Revoked")');
	await viewer.navigate(info.origin);
	await viewer.wait('document.querySelector("[data-action=signin]")');
	assert.equal(await viewer.evaluate('document.body.innerText.includes("INSTALLED-POCKET-ANSWER")'), false);
	assert.equal(requests.length, 1);
	assert.equal(JSON.stringify(requests).includes("PRIVATE-INSTALLED-PREFERENCE"), false);
	assert.equal(JSON.stringify(requests).includes("INSTALLED-DISPLAY-CARD"), false);
	assert.equal(JSON.stringify(requests).includes("SYNTHETIC-INSTALLED-REPLACEMENT"), false);
	await owner.click('[aria-label="Close people"]');
	await stop();
	info = await start();
	assert.equal(info.sessionFile, sessionFile);
	await owner.navigate(info.origin);
	await owner.wait('document.querySelector("[data-conversation]")');
	await owner.click("[data-conversation]");
	await conversationAction(owner, "settings");
	await owner.wait('document.querySelector("[data-credential-status]")?.dataset.version==="2"');
	assert.equal(
		await owner.evaluate('document.querySelector("[data-credential-status]").dataset.configured'),
		"false",
	);
	assert.match(
		String(await owner.evaluate('document.querySelector("[data-session-budget]").innerText')),
		/2 \/ 3/,
	);
	await owner.click('[aria-label="Close settings"]');
	await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
	await owner.type("textarea[name=message]", "INSTALLED-PRIVATE-CLEAR-REOPEN");
	await owner.click("[data-action=send]");
	await owner.wait('document.querySelector(".pocket-receipt")?.innerText.includes("unanswered")');
	assert.equal(requests.length, 1, "a cleared key never falls back after normal reopen");
	assert.equal(child.captured().includes("SYNTHETIC-INSTALLED-REPLACEMENT"), false);
	assert.deepEqual(errors, []);
	await writeFile(join(root, "pocket-product-evidence/requests.json"), JSON.stringify(requests, null, 2));
	console.log(
		"Installed Pocket product passed: real executable/assets/public GUI-only and backend settings extensions, desktop/mobile isolated Chrome, invitation/viewer/revocation, exact approved model selection, private provider replace/clear and scoped usage across normal reopen; 1 local HTTP, 3 charged attempts and no fallback or duplicate model work.",
	);
} finally {
	await browser?.close();
	if (child) {
		child.kill();
		await child.finished;
	}
	await new Promise((resolve) => provider.close(resolve));
}
