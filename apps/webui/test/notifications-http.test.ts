import { POCKET_VERSION } from "@pakka/protocol/pocket";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createECDH, randomBytes } from "node:crypto";
import { createServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { decodePocketResponse } from "../../../packages/protocol/src/pocket.ts";
import {
	WEBUI_SERVICE_API,
	WEBUI_SERVICE_PATH,
	WEBUI_NOTIFICATION_EVENT_PATH,
	decodeWebUiResponse,
	decodeNotificationEvent,
	type NotificationRequest,
} from "../../../packages/protocol/src/webui.ts";

test(
	"WebUI notifications HTTP: real product native completion, device registration, current cookie metadata and resource revocation",
	{ timeout: 25000 },
	async (t) => {
		const key = await readFile(new URL("./tls/key.pem", import.meta.url)),
			cert = await readFile(new URL("./tls/cert.pem", import.meta.url));
		let pushes = 0;
		const receiver = createServer({ key, cert }, (req, res) => {
			req.resume();
			req.once("end", () => {
				pushes++;
				res.writeHead(201);
				res.end();
			});
		});
		await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
		const address = receiver.address();
		assert.ok(address && typeof address !== "string");
		const pushOrigin = `https://127.0.0.1:${address.port}`;
		const pair = createECDH("prime256v1");
		pair.generateKeys();
		const subscription = {
			endpoint: pushOrigin + "/push/test-device",
			keys: {
				p256dh: pair.getPublicKey().toString("base64url"),
				auth: randomBytes(16).toString("base64url"),
			},
		};
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let relay: ReturnType<typeof createHttpServer> | undefined,
			relayedWrites = 0,
			relayedStatus = 0;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "notification-http") },
				owner: "Owner",
				initial: [
					{ name: "Project", profile: "default" },
					{ name: "Private", profile: "default" },
				],
				notifications: { endpointOrigins: [pushOrigin], trustedCa: cert.toString() },
			});
			assert.ok(app.initialOwner);
			async function exchange(token: string, invite = false) {
				const response = await fetch(app!.http.origin + "/pakka-webui/exchange", {
					method: "POST",
					headers: { Origin: app!.http.origin, "Content-Type": "application/json" },
					body: JSON.stringify({
						kind: invite ? "invite" : "session",
						token,
						...(invite ? { name: "Viewer" } : {}),
					}),
				});
				assert.equal(response.status, 200);
				const cookies = response.headers
					.getSetCookie()
					.map((value) => value.split(";")[0])
					.join("; ");
				const actor = await app!.people.authenticate(/pakka_pocket=([^;]+)/.exec(cookies)![1]!);
				return {
					cookies,
					csrf: /pakka_csrf=([^;]+)/.exec(cookies)![1]!,
					personId: app!.people.current(actor).id,
				};
			}
			const owner = await exchange(app.initialOwner.token);
			async function rpc(command: object, auth = owner, endpoint = app!.http.origin) {
				const requestId = crypto.randomUUID(),
					response = await fetch(endpoint + "/pakka-webui/rpc", {
						method: "POST",
						headers: {
							Origin: app!.http.origin,
							"Content-Type": "application/json",
							Cookie: auth.cookies,
							"X-Pakka-CSRF": auth.csrf,
							"X-Pakka-Person": auth.personId,
							"X-Pakka-Server": app!.http.serverId,
						},
						body: JSON.stringify({ version: POCKET_VERSION, requestId, command }),
					});
				return { response, value: decodePocketResponse(await response.json(), requestId) };
			}
			async function lookup(original: NotificationRequest, auth = owner) {
				const requestId = crypto.randomUUID(),
					response = await fetch(app!.http.origin + WEBUI_SERVICE_PATH, {
						method: "POST",
						headers: {
							Origin: app!.http.origin,
							"Content-Type": "application/json",
							Cookie: auth.cookies,
							"X-Pakka-CSRF": auth.csrf,
						},
						body: JSON.stringify({
							api: WEBUI_SERVICE_API,
							requestId,
							binding: { personId: auth.personId, serverId: app!.http.serverId },
							command: { op: "notification.lookup", original },
						}),
					});
				return { response, value: decodeWebUiResponse(await response.json(), requestId) };
			}
			const list = await rpc({ op: "list" });
			assert.ok("result" in list.value && list.value.result.kind === "list");
			const [target, privateTarget] = list.value.result.conversations;
			assert.ok(target && privateTarget);
			const originalRegistration = {
				op: "notification.subscribe" as const,
				target,
				input: { requestId: "owned-device", subscription },
			};
			const registration = await rpc(originalRegistration);
			assert.equal(registration.response.status, 200);
			assert.ok("result" in registration.value && registration.value.result.kind === "notification");
			assert.equal(registration.value.result.status.devices.length, 1);
			assert.doesNotMatch(JSON.stringify(registration.value), /push\/test-device|privateKey|endpoint|auth/);
			const registered = await lookup(originalRegistration);
			assert.ok("result" in registered.value && registered.value.result.kind === "notification-operation");
			assert.deepEqual(registered.value.result.status, registration.value.result.status);
			const missing = await lookup({
				...originalRegistration,
				input: { ...originalRegistration.input, requestId: "not-written" },
			});
			assert.ok("result" in missing.value && missing.value.result.kind === "notification-operation");
			assert.equal(missing.value.result.status, null);
			assert.equal(pushes, 0);
			const sent = await rpc({
				op: "submit",
				target,
				input: { requestId: "real-completion", text: "ACTUAL-NOTIFICATION-WORK", mode: "prompt" },
			});
			assert.ok("result" in sent.value && sent.value.result.kind === "receipt");
			const done = await rpc({ op: "wait", id: sent.value.result.receipt.id });
			assert.ok("result" in done.value && done.value.result.kind === "receipt");
			assert.equal(done.value.result.receipt.status, "done");
			await t.waitFor(() => assert.equal(pushes, 1), { timeout: 4000 });
			const events = await app.runtime
				.store({ namespace: "pocket.notifications", maxBytes: 1048576 })
				.snapshot();
			assert.ok(Array.isArray(events.data.events));
			const savedEvent = events.data.events[0];
			assert.ok(
				savedEvent &&
					typeof savedEvent === "object" &&
					!Array.isArray(savedEvent) &&
					typeof savedEvent.id === "string",
			);
			const eventPath =
				WEBUI_NOTIFICATION_EVENT_PATH +
				"?eventId=" +
				savedEvent.id +
				"&deviceId=" +
				registration.value.result.status.devices[0]!.id;
			const metadata = await fetch(app.http.origin + eventPath, { headers: { Cookie: owner.cookies } });
			assert.equal(metadata.status, 200);
			assert.match(metadata.headers.get("cache-control") ?? "", /no-store/);
			assert.equal(
				decodeNotificationEvent(await metadata.json()).target.conversationId,
				target.conversationId,
			);
			assert.equal(
				(
					await fetch(app.http.origin + eventPath + "&eventId=" + savedEvent.id, {
						headers: { Cookie: owner.cookies },
					})
				).status,
				400,
			);
			assert.equal(
				(
					await fetch(
						app.http.origin + eventPath.replace(WEBUI_NOTIFICATION_EVENT_PATH, "/pocket/notifications/event"),
						{ headers: { Cookie: owner.cookies } },
					)
				).status,
				404,
			);
			assert.equal(m.f.requests.length, 1);
			const actor = await app.people.authenticate(/pakka_pocket=([^;]+)/.exec(owner.cookies)![1]!);
			const invitation = await app.people.invite(actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewer = await exchange(invitation.token, true);
			const foreign = await lookup(originalRegistration, viewer);
			assert.ok("result" in foreign.value && foreign.value.result.kind === "notification-operation");
			assert.equal(foreign.value.result.status, null);
			assert.equal(
				(await fetch(app.http.origin + eventPath, { headers: { Cookie: viewer.cookies } })).status,
				403,
			);
			assert.equal(
				(await rpc({ op: "notification.status", target: privateTarget }, viewer)).response.status,
				403,
			);
			const malformed = await rpc({
				op: "notification.subscribe",
				target,
				input: { requestId: "forged", subscription, actorId: "owner" },
			});
			assert.equal(malformed.response.status, 400);
			const chat = {
				op: "collaboration.post",
				target,
				input: { requestId: "human-update", text: "PRIVATE-HUMAN-NOTIFICATION-CANARY" },
			};
			assert.equal((await rpc(chat)).response.status, 200);
			await t.waitFor(() => assert.equal(pushes, 2), { timeout: 4000 });
			await rpc(chat);
			const originalPreferences = {
				op: "notification.preferences" as const,
				target,
				input: { requestId: "no-chat", preferences: { chat: false } },
			};
			relay = createHttpServer(async (request, response) => {
				try {
					const chunks: Buffer[] = [];
					for await (const chunk of request) chunks.push(chunk);
					relayedWrites++;
					const upstream = await fetch(app!.http.origin + "/pakka-webui/rpc", {
						method: "POST",
						headers: {
							Origin: app!.http.origin,
							"Content-Type": "application/json",
							Cookie: owner.cookies,
							"X-Pakka-CSRF": owner.csrf,
							"X-Pakka-Person": owner.personId,
							"X-Pakka-Server": app!.http.serverId,
						},
						body: Buffer.concat(chunks),
					});
					relayedStatus = upstream.status;
					await upstream.arrayBuffer();
					response.destroy();
				} catch {
					response.destroy();
				}
			});
			await new Promise<void>((resolve) => relay!.listen(0, "127.0.0.1", resolve));
			const relayAddress = relay.address();
			assert.ok(relayAddress && typeof relayAddress !== "string");
			await assert.rejects(
				rpc(originalPreferences, owner, `http://127.0.0.1:${relayAddress.port}`),
				/fetch|socket|network/i,
			);
			assert.equal(relayedWrites, 1);
			assert.equal(relayedStatus, 200);
			const prefs = await lookup(originalPreferences);
			assert.equal(prefs.response.status, 200);
			assert.ok(
				"result" in prefs.value &&
					prefs.value.result.kind === "notification-operation" &&
					prefs.value.result.status,
			);
			assert.equal(prefs.value.result.status.preferences.chat, false);
			await rpc({ ...chat, input: { ...chat.input, requestId: "filtered-chat" } });
			const pendingEvents = await app.runtime
				.store({ namespace: "pocket.notifications", maxBytes: 1048576 })
				.snapshot();
			assert.ok(Array.isArray(pendingEvents.data.events));
			await t.waitFor(
				async () => {
					const saved = await app!.runtime
						.store({ namespace: "pocket.notifications", maxBytes: 1048576 })
						.snapshot();
					assert.ok(Array.isArray(saved.data.events) && saved.data.events.length === 3);
				},
				{ timeout: 3000 },
			);
			assert.equal(pushes, 2, "repeating a post or filtering chat does not send another push");
			assert.doesNotMatch(JSON.stringify(m.f.requests), /PRIVATE-HUMAN-NOTIFICATION-CANARY/);
			await rpc({
				op: "notification.preferences",
				target,
				input: { requestId: "later-preferences", preferences: { done: false } },
			});
			const sharedPreferences = await rpc({ op: "notification.status", target: privateTarget });
			assert.ok(
				"result" in sharedPreferences.value && sharedPreferences.value.result.kind === "notification",
			);
			assert.equal(sharedPreferences.value.result.status.preferences.done, false);
			const oldPreferences = await lookup(originalPreferences);
			assert.ok(
				"result" in oldPreferences.value &&
					oldPreferences.value.result.kind === "notification-operation" &&
					oldPreferences.value.result.status,
			);
			assert.equal(oldPreferences.value.result.status.preferences.done, true);
			const second = await rpc({
				...originalRegistration,
				target: privateTarget,
				input: { ...originalRegistration.input, requestId: "same-device-other-target" },
			});
			assert.ok("result" in second.value && second.value.result.kind === "notification");
			assert.equal(
				second.value.result.status.devices[0]?.id,
				registration.value.result.status.devices[0]!.id,
			);
			const originalOff = {
				op: "notification.unsubscribe" as const,
				target,
				input: { requestId: "disable", deviceId: registration.value.result.status.devices[0]!.id },
			};
			const off = await rpc(originalOff);
			assert.equal(off.response.status, 200);
			const otherOff = await rpc({ op: "notification.status", target: privateTarget });
			assert.ok("result" in otherOff.value && otherOff.value.result.kind === "notification");
			assert.equal(
				otherOff.value.result.status.devices.length,
				0,
				"deactivation covers every resource of this device",
			);
			const confirmedOff = await lookup(originalOff);
			assert.ok(
				"result" in confirmedOff.value &&
					confirmedOff.value.result.kind === "notification-operation" &&
					confirmedOff.value.result.status,
			);
			assert.equal(confirmedOff.value.result.status.devices.length, 0);
			assert.equal(
				(await fetch(app.http.origin + eventPath, { headers: { Cookie: owner.cookies } })).status,
				403,
			);
			const repeated = await rpc({
				op: "submit",
				target,
				input: { requestId: "real-completion", text: "ACTUAL-NOTIFICATION-WORK", mode: "prompt" },
			});
			assert.equal(repeated.response.status, 200);
			assert.equal(m.f.requests.length, 1);
			assert.equal(pushes, 2);
			const current = await app.workspace.bind(actor).configure(target, "default");
			assert.notEqual(current.incarnation, target.incarnation);
			assert.equal(
				(await lookup({ ...originalRegistration, target: current })).response.status === 200,
				false,
			);
			const originalAfterBinding = await lookup(originalRegistration);
			assert.ok(
				"result" in originalAfterBinding.value &&
					originalAfterBinding.value.result.kind === "notification-operation",
			);
			assert.deepEqual(originalAfterBinding.value.result.status, registration.value.result.status);
			const file = app.runtime.view().sessionFile,
				token = /pakka_pocket=([^;]+)/.exec(owner.cookies)![1]!;
			await app.close();
			app = undefined;
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "notification-http"), reopenSessionFile: file },
				owner: "Owner",
				initial: [
					{ name: "Project", profile: "default" },
					{ name: "Private", profile: "default" },
				],
				notifications: { endpointOrigins: [pushOrigin], trustedCa: cert.toString() },
			});
			const restoredOwner = await exchange(token);
			const restored = await lookup(originalRegistration, restoredOwner);
			assert.ok("result" in restored.value && restored.value.result.kind === "notification-operation");
			assert.deepEqual(restored.value.result.status, registration.value.result.status);
			const restoredPreferences = await lookup(originalPreferences, restoredOwner);
			assert.ok(
				"result" in restoredPreferences.value &&
					restoredPreferences.value.result.kind === "notification-operation" &&
					restoredPreferences.value.result.status,
			);
			assert.equal(restoredPreferences.value.result.status.preferences.chat, false);
			const restoredActor = await app.people.authenticate(
				/pakka_pocket=([^;]+)/.exec(restoredOwner.cookies)![1]!,
			);
			await app.people.revokePerson(restoredActor, viewer.personId);
			assert.equal((await lookup(originalRegistration, viewer)).response.status, 401);
			assert.equal(relayedWrites, 1);
			assert.equal(pushes, 2);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await app?.close();
			await m.close();
			if (relay) {
				relay.closeAllConnections();
				await new Promise<void>((resolve) => relay!.close(() => resolve()));
			}
			receiver.closeAllConnections();
			await new Promise<void>((resolve) => receiver.close(() => resolve()));
		}
	},
);
