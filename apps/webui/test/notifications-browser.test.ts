import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import { createServer } from "node:https";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"Pocket notification worker: real native display resolves only current cookie/device/resource metadata and closes after logout",
	{ timeout: 40000 },
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
		const device = createECDH("prime256v1");
		device.generateKeys();
		const subscription = {
			endpoint: pushOrigin + "/push/owned",
			keys: {
				p256dh: device.getPublicKey().toString("base64url"),
				auth: randomBytes(16).toString("base64url"),
			},
		};
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "worker-product") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				notifications: { endpointOrigins: [pushOrigin], trustedCa: cert.toString() },
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "notification-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=notifications]")');
			await page.allowNotifications();
			await page.click("[data-action=notifications]");
			await page.wait('document.querySelector("[data-notification-test]")?.disabled===false');
			await page.click("[data-notification-test]");
			await page.waitNotification("pakka-device-test");
			await page.wait(
				'(async()=>{const registration=await navigator.serviceWorker.ready;return (await registration.getNotifications({tag:"pakka-device-test"})).length===1;})()',
			);
			assert.equal(m.f.requests.length, 0);
			const registered: unknown = await page.evaluate(
				`(async()=>{const{createPocketClient}=await import('@pakka/client/pocket');const client=createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),list=await client.request({op:'list'}),target=list.conversations[0],result=await client.request({op:'notification.subscribe',target,input:{requestId:'owned-local-device',subscription:${JSON.stringify(subscription)}}});globalThis.__notificationTarget=target;return result.status.devices[0];})()`,
			);
			assert.ok(
				registered &&
					typeof registered === "object" &&
					"id" in registered &&
					typeof registered.id === "string",
			);
			await page.click('[aria-label="Close notifications"]');
			await page.type("textarea[name=message]", "REAL-NATIVE-NOTIFICATION");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			await page.wait(
				'(async()=>{const{createPocketClient}=await import("@pakka/client/pocket");const client=createPocketClient({endpoint:location.origin+"/pocket/rpc",csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null});return (await client.request({op:"read",target:globalThis.__notificationTarget})).snapshot.live.busy===false;})()',
			);
			const deadline = Date.now() + 4000;
			while (pushes !== 1) {
				assert.ok(Date.now() < deadline, "Real completion push deadline");
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			const state = await app.runtime
				.store({ namespace: "pocket.notifications", maxBytes: 1048576 })
				.snapshot();
			assert.ok(Array.isArray(state.data.events));
			const entry = state.data.events.at(-1);
			assert.ok(entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.id === "string");
			// CDP delivers an actual browser push event; transport/encryption is verified independently against real TLS.
			await page.evaluate(
				'navigator.serviceWorker.addEventListener("message",event=>{if(event.data?.type==="pakka.notification")globalThis.__notificationCheck=event.data;})',
			);
			await page.pushNotification({ eventId: entry.id, deviceId: registered.id });
			await page.waitNotification("pakka-" + entry.id);
			await page.wait(
				'(async()=>{const registration=await navigator.serviceWorker.ready;return (await registration.getNotifications()).some(row=>row.body==="The agent finished this conversation.");})()',
			);
			const notices = await page.evaluate(
				"(async()=>{const r=await navigator.serviceWorker.ready;return (await r.getNotifications()).map(row=>({title:row.title,body:row.body,data:row.data}));})()",
			);
			assert.doesNotMatch(JSON.stringify(notices), /REAL-NATIVE-NOTIFICATION|Bearer|local-only|apiKey/);
			const invitation = await page.evaluate(
				`(async()=>{const{createPocketClient}=await import('@pakka/client/pocket');return await createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:'invite',requestId:'mobile-notifications',role:'viewer',resources:[globalThis.__notificationTarget.conversationId],ttlMs:60000});})()`,
			);
			assert.ok(
				invitation &&
					typeof invitation === "object" &&
					"token" in invitation &&
					typeof invitation.token === "string",
			);
			const viewer = await browser.page(app.http.origin + "/#invite=" + invitation.token, {
				width: 390,
				height: 844,
			});
			await viewer.wait('document.querySelector("[data-action=signin]")');
			await viewer.type("input[name=person]", "Mobile viewer");
			await viewer.click("[data-action=signin]");
			await viewer.wait('document.querySelector("[data-conversation]")');
			await viewer.click('[aria-label="Toggle conversations"]');
			await viewer.click("[data-conversation]");
			await viewer.click("[data-action=notifications]");
			await viewer.wait('document.querySelector("[data-notification-kind=done]")');
			await viewer.click("[data-notification-kind=done]");
			await viewer.wait(
				'(async()=>{const{createPocketClient}=await import("@pakka/client/pocket");const client=createPocketClient({endpoint:location.origin+"/pocket/rpc",csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),list=await client.request({op:"list"});return (await client.request({op:"notification.status",target:list.conversations[0]})).status.preferences.done===false;})()',
			);
			assert.equal(
				await page.evaluate(
					'(async()=>{const{createPocketClient}=await import("@pakka/client/pocket");return (await createPocketClient({endpoint:location.origin+"/pocket/rpc",csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:"notification.status",target:globalThis.__notificationTarget})).status.preferences.done;})()',
				),
				true,
			);
			assert.equal(await viewer.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
			await page.click("[data-action=notifications]");
			await page.wait('document.querySelector("[data-notification-kind=done]")');
			for (const current of [page, viewer])
				await current.wait(
					'(async()=>{await document.fonts.ready;return document.getAnimations().every(animation=>animation.playState!=="running");})()',
				);
			const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "notification-screenshots");
			await mkdir(output, { recursive: true });
			await writeFile(join(output, "desktop.png"), await page.screenshot());
			await writeFile(join(output, "mobile.png"), await viewer.screenshot());
			t.diagnostic(output);
			await page.click('[aria-label="Close notifications"]');
			await page.click("[data-action=logout]");
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.wait(
				"(async()=>{const registration=await navigator.serviceWorker.ready;return (await registration.getNotifications()).length===0;})()",
			);
			await page.evaluate("globalThis.__notificationCheck=null");
			await page.pushNotification({ eventId: entry.id, deviceId: registered.id });
			await page.wait("globalThis.__notificationCheck?.displayed===false");
			assert.equal(
				await page.evaluate(
					"(async()=>{const registration=await navigator.serviceWorker.ready;return (await registration.getNotifications()).length;})()",
				),
				0,
			);
			assert.equal(m.f.requests.length, 1);
			assert.equal(pushes, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
			receiver.closeAllConnections();
			await new Promise<void>((resolve) => receiver.close(() => resolve()));
		}
	},
);
