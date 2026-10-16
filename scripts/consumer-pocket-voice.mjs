import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownedBrowser } from "./pocket-browser.ts";

// This consumer is copied beside the packed product and imports no workspace source.
const root = dirname(fileURLToPath(import.meta.url));
const run = join(root, "voice-run-" + crypto.randomUUID());
const cwd = join(run, "cwd");
const dataDir = join(run, "data");
const moduleFile = join(run, "composition.mjs");
const ownerFile = join(run, "owner.txt");
const providerKey = "SYNTHETIC-INSTALLED-VOICE-KEY";
function parseJson(value, label) {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw Error(label, { cause: error });
	}
}
function parseUrl(value, label) {
	try {
		return new URL(value);
	} catch (error) {
		throw Error(label, { cause: error });
	}
}
await mkdir(cwd, { recursive: true });
await mkdir(dataDir, { recursive: true });
const requests = [];
const provider = createServer((req, res) => {
	void (async () => {
		const chunks = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		const body = parseJson(Buffer.concat(chunks).toString(), "Invalid installed voice provider request");
		assert.equal(req.url, "/v1/chat/completions");
		assert.equal(req.headers.authorization, "Bearer " + providerKey);
		requests.push(body);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "INSTALLED-VOICE-ANSWER" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "voice-" + requests.length,
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
						usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
					}) +
					"\n\n",
			);
		res.end("data: [DONE]\n\n");
	})().catch(() => res.destroy());
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const address = provider.address();
assert.ok(address && typeof address !== "string");
let config = {
	runtime: {
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + address.port + "/v1",
		model: "local",
		apiKey: providerKey,
		limits: { maxConversations: 4, maxPrimaryAttempts: 3, maxAuxiliaryAttempts: 2 },
	},
	owner: "Installed voice owner",
	initial: [{ name: "Installed voice project", profile: "default" }],
	profiles: ["default"],
};
let child;
let browser;
let origin;
async function waitFor(predicate, label) {
	const deadline = Date.now() + 15000;
	while (!(await predicate())) {
		assert.ok(Date.now() < deadline, label);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
async function start() {
	await writeFile(moduleFile, `export default ${JSON.stringify(config)};\n`);
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
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => (stdout += String(chunk)));
	child.stderr.on("data", (chunk) => (stderr += String(chunk)));
	child.finished = new Promise((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	await waitFor(() => stdout.includes("\n") || child.exitCode !== null, "Installed voice product startup");
	assert.ok(stdout.includes("\n"), "Installed voice startup: " + stderr);
	const info = parseJson(stdout.split("\n")[0], "Invalid installed voice startup record");
	const url = parseUrl(info.origin, "Invalid installed voice listener");
	assert.equal(url.protocol, "http:");
	assert.equal(url.hostname, "127.0.0.1");
	assert.ok(url.port);
	origin = url.origin;
	assert.equal((stdout + stderr).includes(providerKey), false);
	return info;
}
async function stop() {
	if (!child) return;
	child.stdin.end("stop\n");
	assert.equal(await child.finished, 0);
	child = undefined;
}
function installSpeech(page) {
	return page.evaluate(`(()=>{
		globalThis.__voiceTest={instances:[]};
		class Recognition {
			constructor(){this.starts=0;this.stops=0;this.aborts=0;globalThis.__voiceTest.instances.push(this);}
			start(){this.starts++;this.savedResult=this.onresult;}
			stop(){this.stops++;this.onend?.();}
			abort(){this.aborts++;this.onend?.();}
			emit(rows,late=false){const results=rows.map(([transcript,isFinal])=>{const row=[{transcript}];row.isFinal=isFinal;return row;});(late?this.savedResult:this.onresult)?.({results});}
		}
		globalThis.SpeechRecognition=Recognition;
	})()`);
}
try {
	let info = await start();
	const ownerLink = (await readFile(ownerFile, "utf8")).trim();
	assert.equal(ownerLink.startsWith(origin + "/#signin="), true);
	browser = await ownedBrowser(join(run, "chrome"));
	const owner = await browser.page(ownerLink);
	await owner.wait('document.querySelector("[data-action=signin]")');
	await installSpeech(owner);
	await owner.click("[data-action=signin]");
	await owner.wait('document.querySelector("[data-conversation]")');
	await owner.click("[data-conversation]");
	await owner.wait('document.querySelector("[data-dictate]")?.disabled===false');
	await owner.type("textarea[name=message]", "Start end");
	await owner.evaluate(
		'(()=>{const e=document.querySelector("textarea[name=message]");e.focus();e.setSelectionRange(6,6);})()',
	);
	await owner.click("[data-dictate]");
	await owner.wait('document.querySelector("[data-dictate]").getAttribute("aria-pressed")==="true"');
	await owner.evaluate('globalThis.__voiceTest.instances[0].emit([["installed words",false]])');
	await owner.wait('document.querySelector("textarea[name=message]").value==="Start installed words end"');
	await owner.evaluate('globalThis.__voiceTest.instances[0].emit([["installed words",true],["final",true]])');
	await owner.wait(
		'document.querySelector("textarea[name=message]").value==="Start installed words final end"',
	);
	assert.equal(requests.length, 0);
	await owner.click("[data-dictate]");
	await owner.evaluate('globalThis.__voiceTest.instances[0].emit([["LATE-INSTALLED-VOICE",true]],true)');
	assert.equal(
		await owner.evaluate('document.querySelector("textarea[name=message]").value'),
		"Start installed words final end",
	);
	await owner.click("[data-action=send]");
	await owner.wait('document.querySelector("main").innerText.includes("INSTALLED-VOICE-ANSWER")');
	assert.equal(requests.length, 1);
	assert.match(JSON.stringify(requests[0].messages), /Start installed words final end/);
	await owner.click("[data-action=people]");
	await owner.wait('document.querySelector("[data-action=invite]")');
	await owner.click("[data-action=invite]");
	await owner.wait('document.querySelector("input[name=inviteLink]")?.value.includes("#invite=")');
	const invitation = String(await owner.evaluate('document.querySelector("input[name=inviteLink]").value'));
	const viewer = await browser.page(invitation, { width: 390, height: 844 });
	await viewer.wait('document.querySelector("[data-action=signin]")');
	await viewer.type("input[name=person]", "Installed voice viewer");
	await viewer.click("[data-action=signin]");
	await viewer.wait('document.querySelector("[data-conversation]")');
	await viewer.click('[aria-label="Toggle conversations"]');
	await viewer.click("[data-conversation]");
	await viewer.wait('document.querySelector("main").innerText.includes("INSTALLED-VOICE-ANSWER")');
	assert.equal(await viewer.evaluate('Boolean(document.querySelector("[data-dictate]"))'), false);
	assert.equal(await viewer.evaluate('document.querySelector("[data-action=send]").disabled'), true);
	assert.equal(await viewer.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
	config = {
		...config,
		runtime: { ...config.runtime, reopenSessionFile: info.sessionFile },
		transport: { port: Number(parseUrl(origin, "Invalid installed voice origin").port) },
	};
	await stop();
	info = await start();
	assert.equal(info.sessionFile, config.runtime.reopenSessionFile);
	const beforeReload = await owner.evaluate("performance.timeOrigin");
	await owner.reload();
	await owner.wait(`performance.timeOrigin !== ${JSON.stringify(beforeReload)}`);
	await owner.wait('document.readyState === "complete"&&document.querySelector("[data-conversation]")');
	await owner.click("[data-conversation]");
	await owner.wait('document.body.innerText.includes("Start installed words final end")');
	const reopenedVoice = await owner.evaluate(
		'({button:Boolean(document.querySelector("[data-dictate]")),supported:typeof SpeechRecognition==="function"||typeof webkitSpeechRecognition==="function",oldTest:typeof globalThis.__voiceTest})',
	);
	assert.equal(reopenedVoice.button, reopenedVoice.supported);
	assert.equal(reopenedVoice.oldTest, "undefined");
	assert.equal(requests.length, 1);
	await mkdir(join(run, "evidence"), { recursive: true });
	await writeFile(join(run, "evidence", "installed-voice-mobile.png"), await viewer.screenshot());
	await writeFile(join(run, "evidence", "installed-voice-desktop.png"), await owner.screenshot());
	await stop();
	assert.equal(requests.length, 1);
} finally {
	if (child) await stop();
	await browser?.close();
	await new Promise((resolve) => provider.close(resolve));
}
console.log(
	JSON.stringify({ installed: true, modelHttp: requests.length, persisted: true, viewerReadOnly: true }),
);
