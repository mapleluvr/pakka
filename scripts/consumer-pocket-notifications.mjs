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
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";
import { WEBUI_NOTIFICATION_EVENT_PATH } from "@pakka/protocol/webui";

// Installed CLI + real TLS push receiver. System display is covered by separate native-browser acceptance.
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
let child, listener;
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
	const ownerURL = new URL((await readFile(ownerFile, "utf8")).trim());
	assert.equal(ownerURL.origin, info.origin);
	const token = new URLSearchParams(ownerURL.hash.slice(1)).get("session");
	assert.ok(token);
	assert.equal(child.output().includes(token), false);
	let owner = await loginHttp(info.origin, token);
	const refs = (await owner.rpc({ op: "list" })).conversations,
		target = refs[0];
	const original = {
		op: "notification.subscribe",
		target,
		input: { requestId: "installed-device", subscription },
	};
	const registered = await owner.rpc(original);
	assert.equal(registered.status.devices.length, 1);
	assert.equal(
		registered.status.devices[0].subscriptionKey,
		createHash("sha256").update(JSON.stringify(subscription)).digest("hex"),
	);
	assert.doesNotMatch(
		JSON.stringify(registered),
		/owned-installed-device|endpoint|privateKey|SYNTHETIC-INSTALLED-NOTIFICATION-KEY/,
	);
	const input = { requestId: "installed-stable-native", text: "SECOND-STABLE-WORK", mode: "prompt" };
	for (const message of [
		{ requestId: "first", text: "INSTALLED-REAL-NOTIFICATION-WORK", mode: "prompt" },
		input,
	]) {
		const receipt = (await owner.rpc({ op: "submit", target, input: message })).receipt;
		assert.equal((await owner.rpc({ op: "wait", id: receipt.id })).receipt.status, "done");
	}
	await until(() => pushes.length === 2);
	const wake = decrypt(0, registered.status.publicKey);
	decrypt(1, registered.status.publicKey);
	await owner.rpc({
		op: "notification.preferences",
		target,
		input: { requestId: "chat-off", preferences: { chat: false } },
	});
	const filtered = {
		op: "collaboration.post",
		target,
		input: { requestId: "filtered-human", text: "INSTALLED-HUMAN-CANARY" },
	};
	await owner.rpc(filtered);
	assert.equal((await owner.rpc({ op: "notification.status", target })).status.preferences.chat, false);
	await owner.rpc({
		op: "notification.preferences",
		target,
		input: { requestId: "chat-on", preferences: { chat: true } },
	});
	loseResponse = true;
	const unknownChat = { ...filtered, input: { ...filtered.input, requestId: "lost-push" } };
	await owner.rpc(unknownChat);
	await until(() => pushes.length === 3);
	decrypt(2, registered.status.publicKey);
	await owner.rpc(unknownChat);
	const invitation = await owner.rpc({
		op: "invite",
		requestId: "notification-viewer",
		role: "viewer",
		resources: [target.conversationId],
		ttlMs: 60000,
	});
	let viewer = await loginHttp(info.origin, invitation.token, "invite", "Viewer");
	const eventPath = WEBUI_NOTIFICATION_EVENT_PATH + "?eventId=" + wake.eventId + "&deviceId=" + wake.deviceId;
	const metadata = await fetch(info.origin + eventPath, { headers: { Cookie: owner.cookies } });
	assert.equal(metadata.status, 200);
	assert.equal((await metadata.json()).preview, "The agent finished this conversation.");
	assert.equal((await fetch(info.origin + eventPath, { headers: { Cookie: viewer.cookies } })).status, 403);
	await assert.rejects(viewer.rpc({ op: "notification.status", target: refs[1] }), {
		code: "FORBIDDEN",
		outcome: "denied",
	});
	assert.equal((await viewer.services({ op: "notification.lookup", original })).status, null);
	await stop();
	let runtime = await createRuntime({ ...config.runtime, reopenSessionFile: info.sessionFile });
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		const saved = (await runtime.store({ namespace: "pocket.notifications", maxBytes: 1048576 }).snapshot())
			.data;
		assert.equal(saved.events.length, 4);
		assert.equal(
			saved.events.filter((row) => row.deliveries.some((delivery) => delivery.state === "unknown")).length,
			1,
		);
		await writeFile(join(run, "before-reopen.json"), JSON.stringify(saved, null, 2));
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
	owner = await connectHttp(info.origin, owner.cookies);
	viewer = await connectHttp(info.origin, viewer.cookies);
	assert.deepEqual((await owner.rpc({ op: "notification.status", target })).status, registered.status);
	assert.deepEqual((await owner.services({ op: "notification.lookup", original })).status, registered.status);
	await owner.rpc({ op: "submit", target, input });
	await owner.rpc(unknownChat);
	assert.equal(requests.length, 2);
	assert.equal(pushes.length, 3);
	assert.equal((await fetch(info.origin + eventPath, { headers: { Cookie: owner.cookies } })).status, 200);
	await owner.rpc({
		op: "notification.unsubscribe",
		target,
		input: { requestId: "off", deviceId: registered.status.devices[0].id },
	});
	assert.equal((await owner.rpc({ op: "notification.status", target })).status.devices.length, 0);
	assert.equal((await fetch(info.origin + eventPath, { headers: { Cookie: owner.cookies } })).status, 403);
	await owner.rpc({ op: "person.revoke", id: viewer.person.id });
	await assert.rejects(viewer.rpc({ op: "notification.status", target }), (error) =>
		["FORBIDDEN", "UNAUTHORIZED"].includes(error.code),
	);
	await owner.rpc({ op: "session.logout" });
	assert.equal((await fetch(info.origin + eventPath, { headers: { Cookie: owner.cookies } })).status, 401);
	await stop();
	runtime = await createRuntime(config.runtime);
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		const saved = (await runtime.store({ namespace: "pocket.notifications", maxBytes: 1048576 }).snapshot())
			.data;
		assert.equal(saved.events.length, 4);
		assert.equal(saved.devices.filter((row) => row.active).length, 0);
	} finally {
		await runtime.close();
	}
	assert.equal(requests.length, 2);
	assert.equal(pushes.length, 3);
	assert.deepEqual(fixtureErrors, []);
	assert.doesNotMatch(JSON.stringify(requests), /INSTALLED-HUMAN-CANARY/);
	console.log(
		"Installed notifications HTTP passed: encrypted TLS push/VAPID, preference filtering, unknown delivery retained without replay, original subscribe receipt after reopen, owner/viewer/revoke/logout filtering; 2 model requests, 3 TLS pushes. System display is separate.",
	);
} finally {
	if (child) {
		child.kill();
		await child.finished;
	}
	for (const server of [provider, receiver]) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}
