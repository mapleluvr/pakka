import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
	createDecipheriv,
	createECDH,
	createHash,
	createPublicKey,
	hkdfSync,
	randomBytes,
	verify,
} from "node:crypto";
import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { createRuntime, type Runtime, type JsonObject } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketNotifications } from "../src/pocket-notifications.ts";

async function managedNotifications(
	intercept: (stage: "snapshot" | "commit", value: JsonObject) => Promise<void> = async () => {},
) {
	const push = await pushFixture(),
		m = await runtimeFixture();
	let service: Awaited<ReturnType<typeof createPocketNotifications>> | undefined;
	try {
		const people = await createPocketPeople({
			runtime: m.runtime,
			namespace: "notification.boundary.people",
		});
		const session = await people.initializeOwner("Owner"),
			actor = await people.authenticate(session.token);
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog: { namespace: "notification.boundary.workspace", maxDeliveries: 8, maxPending: 2 },
			profileCeiling: () => ["default"],
		}).bind(actor);
		const ref = await workspace.create({ requestId: "main", name: "Main", profile: "default" });
		const runtime: Runtime = {
			...m.runtime,
			store: (options) => {
				const original = m.runtime.store(options);
				if (options.namespace !== "notification.boundary.service") return original;
				return {
					...original,
					snapshot: async () => {
						const saved = await original.snapshot();
						await intercept("snapshot", saved.data);
						return saved;
					},
					compareAndSet: async (version, value, check) => {
						const saved = await original.compareAndSet(version, value, check);
						await intercept("commit", saved.data);
						return saved;
					},
				};
			},
		};
		service = await createPocketNotifications({
			runtime,
			people,
			namespace: "notification.boundary.service",
			endpointOrigins: [push.origin],
			trustedCa: push.cert,
		});
		const bound = service.bind(actor);
		const registered = await bound.subscribe(ref, { requestId: "device", subscription: push.subscription });
		return {
			m,
			people,
			actor,
			workspace,
			ref,
			push,
			service,
			bound,
			registered,
			close: async () => {
				await service?.dispose();
				await m.close();
				await push.close();
			},
		};
	} catch (error) {
		await service?.dispose();
		await m.close();
		await push.close();
		throw error;
	}
}
async function reached(promise: Promise<void>): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(Error("Native notification checkpoint deadline")), 3000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

test(
	"Pocket notifications: an invalid unsubscribe identity cannot disable a real registered device",
	{ timeout: 15000 },
	async () => {
		const f = await managedNotifications();
		try {
			await assert.rejects(
				f.bound.unsubscribe(f.ref, { requestId: "INVALID REQUEST", deviceId: f.registered.devices[0]!.id }),
				/invalid/i,
			);
			assert.equal(
				(await f.bound.status(f.ref)).devices.length,
				1,
				"reject malformed input before revoking an in-memory device lease",
			);
			assert.equal(
				(
					await f.service.publish({
						requestId: "still-enabled",
						kind: "done",
						target: f.ref,
						preview: "VALID-UPDATE",
					})
				).state,
				"accepted",
			);
			assert.equal(f.push.received.length, 1);
		} finally {
			await f.close();
		}
	},
);

test(
	"Pocket notifications: native event input is captured before asynchronous store preparation",
	{ timeout: 15000 },
	async () => {
		let armed = false;
		const entered = deferred(),
			release = deferred();
		const f = await managedNotifications(async (stage) => {
			if (armed && stage === "snapshot") {
				armed = false;
				entered.resolve();
				await release.promise;
			}
		});
		try {
			const input = {
				requestId: "owned-native-event",
				kind: "done" as const,
				target: f.ref,
				preview: "ORIGINAL-NATIVE-UPDATE",
			};
			armed = true;
			const published = f.service.publish(input);
			await reached(entered.promise);
			input.preview = "MUTATED-AFTER-ADMISSION";
			release.resolve();
			const receipt = await published,
				wake = f.push.decode(0);
			assert.equal(
				(await f.bound.event(receipt.id, String(wake.deviceId))).preview,
				"ORIGINAL-NATIVE-UPDATE",
			);
			assert.equal(f.push.received.length, 1);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

test(
	"Pocket notifications: revocation after the real dispatch intent commit prevents the actual TLS push",
	{ timeout: 15000 },
	async () => {
		let armed = false;
		const entered = deferred(),
			release = deferred();
		const f = await managedNotifications(async (stage, value) => {
			if (armed && stage === "commit" && JSON.stringify(value).includes('"state":"running"')) {
				armed = false;
				entered.resolve();
				await release.promise;
			}
		});
		try {
			const invitation = await f.people.invite(f.actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [f.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewer = await f.people.redeem(invitation.token, "Viewer"),
				viewerActor = await f.people.authenticate(viewer.token);
			await f.service
				.bind(viewerActor)
				.subscribe(f.ref, { requestId: "viewer-device", subscription: f.push.subscription });
			armed = true;
			const published = f.service.publish({
				requestId: "revoke-before-dispatch",
				kind: "done",
				target: f.ref,
				preview: "REVOKED-PRIVATE-UPDATE",
			});
			await reached(entered.promise);
			await f.people.revokePerson(f.actor, viewer.person.id);
			release.resolve();
			assert.equal((await published).state, "filtered");
			assert.equal(f.push.received.length, 0, "the actual target receives no push after late revocation");
			assert.equal(f.m.f.requests.length, 0);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

test(
	"Pocket notification audiences: mention preferences cannot notify a different subscribed person",
	{ timeout: 15000 },
	async () => {
		const f = await managedNotifications();
		try {
			const invitation = await f.people.invite(f.actor, {
				requestId: "mentioned",
				role: "viewer",
				resources: [f.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewer = await f.people.redeem(invitation.token, "Mentioned viewer"),
				actor = await f.people.authenticate(viewer.token);
			const other = { ...f.push.subscription, endpoint: f.push.origin + "/push/second-device" };
			const registered = await f.service
				.bind(actor)
				.subscribe(f.ref, { requestId: "viewer-device", subscription: other });
			await f.service
				.bind(actor)
				.preferences(f.ref, { requestId: "preferences", preferences: { chat: false, mention: true } });
			const mention = await f.service.publish({
				requestId: "specific-mention",
				kind: "mention",
				target: f.ref,
				preview: "SCOPED-MENTION",
				recipientIds: [viewer.person.id],
			});
			assert.equal(mention.state, "accepted");
			assert.equal(f.push.received.length, 1);
			assert.equal(f.push.decode(0).deviceId, registered.devices[0]!.id);
			await assert.rejects(f.bound.event(mention.id, f.registered.devices[0]!.id), /denied/i);
			await f.people.revokePerson(f.actor, viewer.person.id);
			await assert.rejects(
				async () => f.service.bind(actor).event(mention.id, registered.devices[0]!.id),
				/denied/i,
			);
			assert.equal(f.m.f.requests.length, 0);
		} finally {
			await f.close();
		}
	},
);

async function pushFixture() {
	const key = await readFile(new URL("../../webui/test/tls/key.pem", import.meta.url));
	const cert = await readFile(new URL("../../webui/test/tls/cert.pem", import.meta.url));
	const device = createECDH("prime256v1");
	device.generateKeys();
	const auth = randomBytes(16);
	const received: { body: Buffer; authorization: string; encoding: string }[] = [];
	let loseResponse = false;
	const server = createServer({ key, cert }, (req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		req.once("end", () => {
			received.push({
				body: Buffer.concat(chunks),
				authorization: String(req.headers.authorization),
				encoding: String(req.headers["content-encoding"]),
			});
			if (loseResponse) req.socket.destroy();
			else {
				res.writeHead(201);
				res.end();
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const origin = `https://127.0.0.1:${address.port}`;
	return {
		origin,
		cert: cert.toString(),
		received,
		lose: () => {
			loseResponse = true;
		},
		subscription: {
			endpoint: origin + "/push/owned-device",
			keys: { p256dh: device.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
		},
		decode: (index: number) => {
			const row = received[index]!;
			assert.equal(row.encoding, "aes128gcm");
			const salt = row.body.subarray(0, 16),
				recordSize = row.body.readUInt32BE(16),
				publicLength = row.body[20]!;
			assert.equal(publicLength, 65);
			assert.equal(recordSize, 4096);
			const sender = row.body.subarray(21, 21 + publicLength);
			const info = Buffer.concat([Buffer.from("WebPush: info\0"), device.getPublicKey(), sender]);
			const ikm = Buffer.from(hkdfSync("sha256", device.computeSecret(sender), auth, info, 32));
			const cek = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
			const nonce = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
			const encrypted = row.body.subarray(21 + publicLength);
			const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
			decipher.setAuthTag(encrypted.subarray(-16));
			const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
			assert.equal(plain.at(-1), 2);
			const value: unknown = JSON.parse(plain.subarray(0, -1).toString());
			assert.ok(value && typeof value === "object" && "eventId" in value && "deviceId" in value);
			assert.equal(typeof value.eventId, "string");
			assert.equal(typeof value.deviceId, "string");
			return value;
		},
		verify: (publicKey: string, index = 0) => {
			const match = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(received[index]!.authorization);
			assert.ok(match);
			assert.equal(match[2], publicKey);
			const [header, payload, signature] = match[1]!.split(".");
			const point = Buffer.from(publicKey, "base64url");
			const publicObject = createPublicKey({
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
					{ key: publicObject, dsaEncoding: "ieee-p1363" },
					Buffer.from(signature!, "base64url"),
				),
				true,
			);
			assert.deepEqual(JSON.parse(Buffer.from(header!, "base64url").toString()), {
				typ: "JWT",
				alg: "ES256",
			});
			const claims: unknown = JSON.parse(Buffer.from(payload!, "base64url").toString());
			assert.ok(claims && typeof claims === "object" && "aud" in claims && "exp" in claims);
			assert.equal(claims.aud, origin);
			assert.ok(
				typeof claims.exp === "number" &&
					claims.exp > Date.now() / 1000 &&
					claims.exp <= Date.now() / 1000 + 86400,
			);
		},
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

test(
	"Pocket notifications: real encrypted TLS push, independent VAPID verification, person/resource metadata and unsubscribe",
	{ timeout: 20000 },
	async () => {
		const push = await pushFixture(),
			m = await runtimeFixture();
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "notification.people" });
			const session = await people.initializeOwner("Owner"),
				actor = await people.authenticate(session.token);
			const workspace = createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog: { namespace: "notification.workspace", maxDeliveries: 8, maxPending: 2 },
				profileCeiling: () => ["default"],
			}).bind(actor);
			const ref = await workspace.create({ requestId: "main", name: "Main", profile: "default" });
			const privateRef = await workspace.create({
				requestId: "private",
				name: "Private",
				profile: "default",
			});
			const service = await createPocketNotifications({
				runtime: m.runtime,
				people,
				namespace: "notification.service",
				endpointOrigins: [push.origin],
				trustedCa: push.cert,
			});
			const bound = service.bind(actor),
				initial = await bound.status(ref);
			assert.equal(Buffer.from(initial.publicKey, "base64url").length, 65);
			const registered = await bound.subscribe(ref, { requestId: "device", subscription: push.subscription });
			assert.equal(registered.devices.length, 1);
			const matching = registered.devices[0]!;
			assert.ok("subscriptionKey" in matching);
			assert.equal(
				matching.subscriptionKey,
				createHash("sha256").update(JSON.stringify(push.subscription)).digest("hex"),
			);
			assert.deepEqual(
				await bound.subscribe(ref, { requestId: "device", subscription: push.subscription }),
				registered,
			);
			assert.doesNotMatch(JSON.stringify(registered), /owned-device|privateKey|endpoint|auth/);
			const first = await service.publish({
				requestId: "native.done.1",
				kind: "done",
				target: ref,
				preview: "SYNTHETIC-PRIVATE-UPDATE",
			});
			assert.equal(first.state, "accepted");
			assert.equal(push.received.length, 1);
			push.verify(initial.publicKey);
			const wake = push.decode(0);
			assert.deepEqual(Object.keys(wake).sort(), ["deviceId", "eventId"]);
			assert.equal(wake.eventId, first.id);
			assert.equal(wake.deviceId, registered.devices[0]!.id);
			assert.doesNotMatch(JSON.stringify(wake), /SYNTHETIC|conversation|profile|Owner/);
			const entry = await bound.event(String(wake.eventId), String(wake.deviceId));
			assert.equal(entry.preview, "SYNTHETIC-PRIVATE-UPDATE");
			assert.deepEqual(entry.target, ref);
			assert.deepEqual(
				await service.publish({
					requestId: "native.done.1",
					kind: "done",
					target: ref,
					preview: "SYNTHETIC-PRIVATE-UPDATE",
				}),
				first,
			);
			assert.equal(push.received.length, 1, "retry never sends another push");
			const invitation = await people.invite(actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewer = await people.redeem(invitation.token, "Viewer"),
				viewerActor = await people.authenticate(viewer.token);
			await assert.rejects(service.bind(viewerActor).event(first.id, registered.devices[0]!.id), /denied/i);
			await assert.rejects(service.bind(viewerActor).status(privateRef), /denied/i);
			await bound.unsubscribe(ref, { requestId: "off", deviceId: registered.devices[0]!.id });
			await assert.rejects(bound.event(first.id, registered.devices[0]!.id), /denied/i);
			const noDevice = await service.publish({
				requestId: "native.done.2",
				kind: "done",
				target: ref,
				preview: "ANOTHER-PRIVATE-UPDATE",
			});
			assert.equal(noDevice.state, "no-devices");
			assert.equal(push.received.length, 1);
			assert.equal(m.f.requests.length, 0);
			await service.dispose();
		} finally {
			await m.close();
			await push.close();
		}
	},
);

test(
	"Pocket notifications recovery: lost accepted transport remains unknown after retry and normal writer reopen",
	{ timeout: 20000 },
	async () => {
		const push = await pushFixture(),
			m = await runtimeFixture();
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const people = await createPocketPeople({
				runtime: m.runtime,
				namespace: "notification.recovery.people",
			});
			const session = await people.initializeOwner("Owner"),
				actor = await people.authenticate(session.token);
			const workspace = createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog: { namespace: "notification.recovery.workspace", maxDeliveries: 4, maxPending: 2 },
				profileCeiling: () => ["default"],
			}).bind(actor);
			const ref = await workspace.create({ requestId: "main", name: "Main", profile: "default" });
			const options = {
				namespace: "notification.recovery.service",
				endpointOrigins: [push.origin],
				trustedCa: push.cert,
			};
			let service = await createPocketNotifications({ ...options, runtime: m.runtime, people });
			const initial = await service.bind(actor).status(ref);
			await service.bind(actor).subscribe(ref, { requestId: "device", subscription: push.subscription });
			push.lose();
			const command = {
				requestId: "native.lost.1",
				kind: "done" as const,
				target: ref,
				preview: "LOST-SYNTHETIC-UPDATE",
			};
			const lost = await service.publish(command);
			assert.equal(lost.state, "unknown");
			assert.equal(push.received.length, 1);
			assert.deepEqual(await service.publish(command), lost);
			const file = m.runtime.view().sessionFile;
			await service.dispose();
			await m.runtime.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			const restoredPeople = await createPocketPeople({
				runtime: reopened,
				namespace: "notification.recovery.people",
			});
			service = await createPocketNotifications({ ...options, runtime: reopened, people: restoredPeople });
			assert.equal(
				(await service.bind(await restoredPeople.authenticate(session.token)).status(ref)).publicKey,
				initial.publicKey,
			);
			assert.deepEqual(await service.publish(command), lost);
			assert.equal(push.received.length, 1, "uncertain push is not repeated after reopen");
			assert.equal(m.f.requests.length, 0);
			await service.dispose();
		} finally {
			await reopened?.close();
			await m.close();
			await push.close();
		}
	},
);
