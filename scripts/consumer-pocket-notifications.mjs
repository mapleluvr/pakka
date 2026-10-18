import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import {
	createDecipheriv,
	createECDH,
	createHash,
	createPublicKey,
	hkdfSync,
	randomBytes,
	verify,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { ownedBrowser } from "./pocket-browser.ts";

// Installed-package subject. All providers, TLS keys, people and browser contexts are owned by this run.
// TLS encryption/service acceptance and CDP-delivered native worker display are distinct assertions.
const root = dirname(fileURLToPath(import.meta.url));
const run = join(root, "notification-run-" + crypto.randomUUID());
await mkdir(run, { recursive: true });
const cwd = join(run, "cwd"),
	dataDir = join(run, "data"),
	ownerFile = join(run, "owner.txt"),
	configFile = join(run, "config.json");
await mkdir(cwd);
await mkdir(dataDir);
const key = await readFile(join(root, "tls/key.pem")),
	cert = await readFile(join(root, "tls/cert.pem"));
const requests = [],
	pushes = [],
	fixtureErrors = [];
let loseResponse = false;
const device = createECDH("prime256v1");
device.generateKeys();
const auth = randomBytes(16);
const receiver = httpsServer({ key, cert }, (req, res) => {
	const chunks = [];
	req.on("data", (bytes) => chunks.push(Buffer.from(bytes)));
	req.once("end", () => {
		pushes.push({
			body: Buffer.concat(chunks),
			authorization: req.headers.authorization,
			encoding: req.headers["content-encoding"],
		});
		if (loseResponse) req.socket.destroy();
		else {
			res.writeHead(201);
			res.end();
		}
	});
});
const provider = httpServer((req, res) => {
	void (async () => {
		const chunks = [];
		for await (const bytes of req) chunks.push(Buffer.from(bytes));
		let value;
		try {
			value = JSON.parse(Buffer.concat(chunks).toString());
		} catch (error) {
			throw Error("Invalid installed notification provider input", { cause: error });
		}
		requests.push(value);
		assert.equal(req.headers.authorization, "Bearer SYNTHETIC-INSTALLED-NOTIFICATION-KEY");
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{
				index: 0,
				delta: { role: "assistant", content: "INSTALLED-NOTIFICATION-ANSWER" },
				finish_reason: null,
			},
			{ index: 0, delta: {}, finish_reason: "stop" },
		]) {
			res.write(
				"data: " +
					JSON.stringify({
						id: "notification-" + requests.length,
						object: "chat.completion.chunk",
						model: "local",
						choices: [choice],
					}) +
					"\n\n",
			);
		}
		res.end("data: [DONE]\n\n");
	})().catch((error) => {
		fixtureErrors.push(String(error));
		res.destroy();
	});
});
await Promise.all([
	new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve)),
	new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve)),
]);
const receiverAddress = receiver.address(),
	providerAddress = provider.address();
assert.ok(
	receiverAddress &&
		typeof receiverAddress !== "string" &&
		providerAddress &&
		typeof providerAddress !== "string",
);
const pushOrigin = "https://127.0.0.1:" + receiverAddress.port;
const subscription = {
	endpoint: pushOrigin + "/push/owned-installed-device",
	keys: { p256dh: device.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
};
let config = {
	runtime: {
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + providerAddress.port + "/v1",
		model: "local",
		apiKey: "SYNTHETIC-INSTALLED-NOTIFICATION-KEY",
		limits: { maxConversations: 4, maxPrimaryAttempts: 4, maxAuxiliaryAttempts: 2 },
	},
	owner: "Owner",
	initial: [
		{ name: "Notifications project", profile: "default" },
		{ name: "Private project", profile: "default" },
	],
	notifications: {
		endpointOrigins: [pushOrigin],
		trustedCa: cert.toString(),
		subject: "mailto:synthetic@example.invalid",
	},
};
const until = async (condition) => {
	const end = Date.now() + 10000;
	while (!(await condition())) {
		assert.ok(Date.now() < end, "Installed notification deadline");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
};
const json = (text) => {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw Error("Invalid owned notification JSON", { cause: error });
	}
};
let child, browser, listener;
async function start() {
	await writeFile(configFile, JSON.stringify(config));
	child = spawn(
		process.execPath,
		[
			join(root, "node_modules/@pakka/webui/dist/main.js"),
			"--config",
			configFile,
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
	assert.ok(out.includes("\n"), "Installed notification startup: " + err);
	const info = json(out.split("\n")[0]);
	let url;
	try {
		url = new URL(info.origin);
	} catch (error) {
		throw Error("Invalid owned notification listener", { cause: error });
	}
	assert.equal(url.protocol, "http:");
	assert.equal(url.hostname, "127.0.0.1");
	assert.ok(url.port);
	assert.equal(url.pathname, "/");
	assert.equal(url.username + url.password + url.search + url.hash, "");
	assert.equal(url.origin, info.origin);
	listener = url;
	assert.equal(child.output().includes(config.runtime.apiKey), false);
	return info;
}
async function stop() {
	if (!child) return;
	child.stdin.end("stop\n");
	assert.equal(await child.finished, 0, child.output());
	assert.equal(child.output().includes(config.runtime.apiKey), false);
	child = undefined;
}
const rpc = (page, command) =>
	page.evaluate(
		`(async()=>{const{createPocketClient}=await import('@pakka/client/pocket');return createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request(${JSON.stringify(command)});})()`,
	);
const settled = (page) =>
	page.wait(
		'(async()=>{await document.fonts.ready;return document.getAnimations().every(row=>row.playState!=="running");})()',
	);
function decrypt(index, publicKey) {
	const row = pushes[index];
	assert.equal(row.encoding, "aes128gcm");
	const match = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(String(row.authorization));
	assert.ok(match);
	assert.equal(match[2], publicKey);
	const [header, payload, signature] = match[1].split("."),
		point = Buffer.from(publicKey, "base64url");
	const pub = createPublicKey({
		format: "jwk",
		key: {
			kty: "EC",
			crv: "P-256",
			x: point.subarray(1, 33).toString("base64url"),
			y: point.subarray(33).toString("base64url"),
		},
	});
	assert.equal(
		verify(
			"sha256",
			Buffer.from(header + "." + payload),
			{ key: pub, dsaEncoding: "ieee-p1363" },
			Buffer.from(signature, "base64url"),
		),
		true,
	);
	const claims = json(Buffer.from(payload, "base64url").toString());
	assert.equal(claims.aud, pushOrigin);
	assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 86400);
	const salt = row.body.subarray(0, 16),
		size = row.body.readUInt32BE(16),
		length = row.body[20];
	assert.equal(size, 4096);
	assert.equal(length, 65);
	const sender = row.body.subarray(21, 21 + length),
		info = Buffer.concat([Buffer.from("WebPush: info\0"), device.getPublicKey(), sender]);
	const ikm = hkdfSync("sha256", device.computeSecret(sender), auth, info, 32),
		cek = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
		nonce = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
	const encrypted = row.body.subarray(21 + length),
		decipher = createDecipheriv("aes-128-gcm", cek, nonce);
	decipher.setAuthTag(encrypted.subarray(-16));
	const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
	assert.equal(plain.at(-1), 2);
	const wake = json(plain.subarray(0, -1).toString());
	assert.deepEqual(Object.keys(wake).sort(), ["deviceId", "eventId"]);
	return wake;
}
try {
	let info = await start();
	const link = (await readFile(ownerFile, "utf8")).trim(),
		ownerURL = new URL(link);
	assert.equal(ownerURL.origin, info.origin);
	const token = new URLSearchParams(ownerURL.hash.slice(1)).get("signin");
	assert.ok(token);
	assert.equal(child.output().includes(token), false);
	browser = await ownedBrowser(join(run, "browser"));
	const owner = await browser.page(link);
	await owner.wait('document.querySelector("[data-action=signin]")');
	await owner.click("[data-action=signin]");
	await owner.wait('document.querySelector("[data-conversation]")');
	await owner.click("[data-conversation]");
	const refs = (await rpc(owner, { op: "list" })).conversations,
		target = refs[0];
	assert.ok(target && refs[1]);
	await owner.allowNotifications();
	await owner.click("[data-action=notifications]");
	await owner.wait('document.querySelector("[data-notification-test]")?.disabled===false');
	await settled(owner);
	await owner.click("[data-notification-test]");
	await owner.waitNotification("pakka-device-test");
	await owner.wait(
		'(async()=>{const r=await navigator.serviceWorker.ready;return(await r.getNotifications({tag:"pakka-device-test"})).length===1;})()',
	);
	const registered = await rpc(owner, {
		op: "notification.subscribe",
		target,
		input: { requestId: "installed-device", subscription },
	});
	assert.equal(registered.status.devices.length, 1);
	assert.equal(
		registered.status.devices[0].subscriptionKey,
		createHash("sha256").update(JSON.stringify(subscription)).digest("hex"),
	);
	assert.doesNotMatch(
		JSON.stringify(registered),
		/owned-installed-device|endpoint|privateKey|SYNTHETIC-INSTALLED-NOTIFICATION-KEY/,
	);
	await owner.click('[aria-label="Close notifications"]');
	await owner.type("textarea[name=message]", "INSTALLED-REAL-NOTIFICATION-WORK");
	await owner.click("[data-action=send]");
	await owner.wait('document.querySelector("main").innerText.includes("INSTALLED-NOTIFICATION-ANSWER")');
	await until(() => pushes.length === 1);
	const wake = decrypt(0, registered.status.publicKey);
	await owner.pushNotification(wake);
	await owner.waitNotification("pakka-" + wake.eventId);
	await owner.wait(
		'(async()=>{const r=await navigator.serviceWorker.ready;return(await r.getNotifications()).some(row=>row.body==="The agent finished this conversation.");})()',
	);
	const repeated = await rpc(owner, {
		op: "submit",
		target,
		input: { requestId: "installed-stable-native", text: "SECOND-STABLE-WORK", mode: "prompt" },
	});
	// This second real input supplies an exact stable receipt for normal-reopen dedup verification.
	assert.equal(repeated.kind, "receipt");
	await rpc(owner, { op: "wait", id: repeated.receipt.id });
	await until(() => pushes.length === 2);
	decrypt(1, registered.status.publicKey);
	await owner.click("[data-action=notifications]");
	await owner.wait('document.querySelector("[data-notification-kind=chat]")');
	await settled(owner);
	await owner.click("[data-notification-kind=chat]");
	await owner.wait(
		`(async()=>{const{createPocketClient}=await import('@pakka/client/pocket');return(await createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:'notification.status',target:${JSON.stringify(target)}})).status.preferences.chat===false;})()`,
	);
	const filtered = {
		op: "collaboration.post",
		target,
		input: { requestId: "installed-filtered-human", text: "INSTALLED-HUMAN-CANARY" },
	};
	await rpc(owner, filtered);
	await owner.click("[data-notification-kind=chat]");
	await owner.wait('document.querySelector("[data-notification-kind=chat]")?.disabled===false');
	await until(
		async () => (await rpc(owner, { op: "notification.status", target })).status.preferences.chat === true,
	);
	loseResponse = true;
	const unknownChat = { ...filtered, input: { ...filtered.input, requestId: "installed-lost-push" } };
	await rpc(owner, unknownChat);
	await until(() => pushes.length === 3);
	const unknownWake = decrypt(2, registered.status.publicKey);
	await rpc(owner, unknownChat);
	await owner.click('[aria-label="Close notifications"]');
	const invitation = await rpc(owner, {
		op: "invite",
		requestId: "installed-notification-viewer",
		role: "viewer",
		resources: [target.conversationId],
		ttlMs: 60000,
	});
	assert.ok(invitation.token);
	const viewer = await browser.page(info.origin + "/#invite=" + invitation.token, {
		width: 390,
		height: 844,
	});
	await viewer.wait('document.querySelector("[data-action=signin]")');
	await viewer.type("input[name=person]", "Mobile viewer");
	await viewer.click("[data-action=signin]");
	await viewer.wait('document.querySelector("[data-conversation]")');
	await viewer.click('[aria-label="Toggle conversations"]');
	await viewer.click("[data-conversation]");
	await viewer.allowNotifications();
	await viewer.click("[data-action=notifications]");
	await viewer.wait('document.querySelector("[data-notification-test]")?.disabled===false');
	await viewer.evaluate(
		'navigator.serviceWorker.addEventListener("message",event=>{if(event.data?.type==="pakka.notification")globalThis.__notificationCheck=event.data;})',
	);
	await viewer.pushNotification(wake);
	await viewer.wait("globalThis.__notificationCheck?.displayed===false");
	assert.equal(
		await viewer.evaluate(
			"(async()=>{const r=await navigator.serviceWorker.ready;return(await r.getNotifications()).length;})()",
		),
		0,
	);
	const denied = await rpc(viewer, { op: "notification.status", target: refs[1] }).catch((error) =>
		String(error),
	);
	assert.match(String(denied), /Pocket|Browser evaluation/);
	assert.equal(await viewer.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
	for (const page of [owner, viewer]) await settled(page);
	await writeFile(join(run, "desktop.png"), await owner.screenshot());
	await writeFile(join(run, "mobile.png"), await viewer.screenshot());
	await stop();
	let runtime = await createRuntime({ ...config.runtime, reopenSessionFile: info.sessionFile });
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		const saved = await runtime.store({ namespace: "pocket.notifications", maxBytes: 1048576 }).snapshot();
		assert.equal(saved.data.events.length, 4);
		assert.equal(
			saved.data.events.filter((row) => row.deliveries.some((delivery) => delivery.state === "unknown"))
				.length,
			1,
		);
		await writeFile(join(run, "before-reopen.json"), JSON.stringify(saved.data, null, 2));
	} finally {
		await runtime.close();
	}
	config = {
		...config,
		runtime: { ...config.runtime, reopenSessionFile: info.sessionFile },
		transport: { port: Number(listener.port) },
	};
	const oldOrigin = info.origin;
	info = await start();
	assert.equal(info.origin, oldOrigin);
	await owner.navigate(info.origin + "/#conversation=" + target.conversationId);
	await owner.wait('document.querySelector("textarea[name=message]")');
	const after = await rpc(owner, { op: "notification.status", target });
	assert.deepEqual(after.status, registered.status);
	await rpc(owner, {
		op: "submit",
		target,
		input: { requestId: "installed-stable-native", text: "SECOND-STABLE-WORK", mode: "prompt" },
	});
	await rpc(owner, unknownChat);
	assert.equal(requests.length, 2);
	assert.equal(pushes.length, 3);
	const metadata = await owner.evaluate(
		`(async()=>{const response=await fetch('/pocket/notifications/event?eventId='+${JSON.stringify(wake.eventId)}+'&deviceId='+${JSON.stringify(wake.deviceId)});return{status:response.status,data:await response.json()};})()`,
	);
	assert.equal(metadata.status, 200);
	assert.equal(metadata.data.preview, "The agent finished this conversation.");
	await rpc(owner, {
		op: "notification.unsubscribe",
		target,
		input: { requestId: "installed-off", deviceId: registered.status.devices[0].id },
	});
	assert.equal((await rpc(owner, { op: "notification.status", target })).status.devices.length, 0);
	const viewerIdentity = await rpc(viewer, { op: "hello" });
	assert.equal(typeof viewerIdentity.person.id, "string");
	await rpc(owner, { op: "person.revoke", id: viewerIdentity.person.id });
	await viewer.wait('document.querySelector("[data-action=signin]")');
	await owner.click("[data-action=logout]");
	await owner.wait('document.querySelector("[data-action=signin]")');
	await owner.wait(
		"(async()=>{const r=await navigator.serviceWorker.ready;return(await r.getNotifications()).length===0;})()",
	);
	await owner.evaluate(
		'navigator.serviceWorker.addEventListener("message",event=>{if(event.data?.type==="pakka.notification")globalThis.__notificationCheck=event.data;})',
	);
	await owner.pushNotification(unknownWake);
	await owner.wait("globalThis.__notificationCheck?.displayed===false");
	await stop();
	runtime = await createRuntime(config.runtime);
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		const saved = await runtime.store({ namespace: "pocket.notifications", maxBytes: 1048576 }).snapshot();
		assert.equal(saved.data.events.length, 4);
		assert.equal(saved.data.devices.filter((row) => row.active).length, 0);
	} finally {
		await runtime.close();
	}
	assert.equal(requests.length, 2);
	assert.equal(pushes.length, 3);
	assert.equal(fixtureErrors.length, 0);
	assert.doesNotMatch(JSON.stringify(requests), /INSTALLED-HUMAN-CANARY/);
	console.log(
		JSON.stringify({
			installedNotifications: true,
			modelHttp: requests.length,
			tlsPushes: pushes.length,
			nativeWorkerDisplay: true,
			unknownNeverReplayed: true,
			spentAttempts: 2,
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
	for (const server of [provider, receiver]) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(() => resolve()));
	}
}
