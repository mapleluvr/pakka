import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createECDH, randomBytes } from "node:crypto";
import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { decodePocketResponse } from "../../../packages/protocol/src/pocket.ts";

test(
	"Pocket notifications HTTP: real product native completion, device registration, current cookie metadata and resource revocation",
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
				const response = await fetch(app!.http.origin + "/pocket/exchange", {
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
				return { cookies, csrf: /pakka_csrf=([^;]+)/.exec(cookies)![1]! };
			}
			const owner = await exchange(app.initialOwner.token);
			async function rpc(command: object, auth = owner) {
				const requestId = crypto.randomUUID(),
					response = await fetch(app!.http.origin + "/pocket/rpc", {
						method: "POST",
						headers: {
							Origin: app!.http.origin,
							"Content-Type": "application/json",
							Cookie: auth.cookies,
							"X-Pakka-CSRF": auth.csrf,
						},
						body: JSON.stringify({ version: 2, requestId, command }),
					});
				return { response, value: decodePocketResponse(await response.json(), requestId) };
			}
			const list = await rpc({ op: "list" });
			assert.ok("result" in list.value && list.value.result.kind === "list");
			const [target, privateTarget] = list.value.result.conversations;
			assert.ok(target && privateTarget);
			const registration = await rpc({
				op: "notification.subscribe",
				target,
				input: { requestId: "owned-device", subscription },
			});
			assert.equal(registration.response.status, 200);
			assert.ok("result" in registration.value && registration.value.result.kind === "notification");
			assert.equal(registration.value.result.status.devices.length, 1);
			assert.doesNotMatch(JSON.stringify(registration.value), /push\/test-device|privateKey|endpoint|auth/);
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
			const prefs = await rpc({
				op: "notification.preferences",
				target,
				input: { requestId: "no-chat", preferences: { chat: false } },
			});
			assert.equal(prefs.response.status, 200);
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
			const off = await rpc({
				op: "notification.unsubscribe",
				target,
				input: { requestId: "disable", deviceId: registration.value.result.status.devices[0]!.id },
			});
			assert.equal(off.response.status, 200);
			const repeated = await rpc({
				op: "submit",
				target,
				input: { requestId: "real-completion", text: "ACTUAL-NOTIFICATION-WORK", mode: "prompt" },
			});
			assert.equal(repeated.response.status, 200);
			assert.equal(m.f.requests.length, 1);
			assert.equal(pushes, 2);
		} finally {
			await app?.close();
			await m.close();
			receiver.closeAllConnections();
			await new Promise<void>((resolve) => receiver.close(() => resolve()));
		}
	},
);
