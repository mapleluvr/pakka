import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { conversationAction, organizationAction } from "./frontend-controls.ts";

test(
	"WebUI notification links select visible conversation history in an already open document without replaying input",
	{ timeout: 40000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "notification-link-product") },
				owner: "Owner",
				initial: [
					{ name: "Notification target", profile: "default" },
					{ name: "Other conversation", profile: "default" },
				],
			});
			assert.ok(app.initialOwner);
			const rows = await app.workspace
				.bind(await app.people.authenticate(app.initialOwner.token))
				.navigation();
			const target = rows.find((row) => row.name === "Notification target")?.ref,
				other = rows.find((row) => row.name === "Other conversation")?.ref;
			assert.ok(target && other);
			browser = await ownedBrowser(join(m.f.root, "notification-link-browser"));
			const page = await browser.page(
				app.http.origin + "/#signin=" + app.initialOwner.token + "&conversation=" + target.conversationId,
			);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector(".pocket-title")?.textContent==="Notification target"');
			await page.wait('document.querySelector(".pocket-status")?.textContent==="Ready"');
			await page.type("textarea[name=message]", "NOTIFICATION-LINK-INPUT");
			await page.click("[data-action=send]");
			await page.wait(
				'document.querySelector("[data-role=assistant]")?.textContent.includes("LOCAL-ANSWER")',
			);
			await page.click('[data-conversation="' + other.conversationId + '"]');
			await page.wait('document.querySelector(".pocket-title")?.textContent==="Other conversation"');
			await conversationAction(page, "settings");
			await page.wait('document.querySelector("[role=dialog]")');
			await page.evaluate('globalThis.__notificationDocument="original-document"');
			await page.navigate(app.http.origin + "/#conversation=" + target.conversationId);
			await page.wait('document.querySelector(".pocket-title")?.textContent==="Notification target"');
			await page.wait('document.querySelector("main")?.textContent.includes("NOTIFICATION-LINK-INPUT")');
			await page.wait(
				'document.querySelector("[data-role=assistant]")?.textContent.includes("LOCAL-ANSWER")',
			);
			assert.equal(await page.evaluate("globalThis.__notificationDocument"), "original-document");
			assert.equal(await page.evaluate("location.hash"), "");
			assert.equal(await page.evaluate('!!document.querySelector("[role=dialog]")'), false);
			assert.equal(m.f.requests.length, 1, "following a notification never replays the submitted input");

			await page.navigate(app.http.origin + "/#conversation=not-visible");
			await page.wait('location.hash===""');
			assert.equal(
				await page.evaluate('document.querySelector(".pocket-title").textContent'),
				"Notification target",
			);
			assert.equal(m.f.requests.length, 1);

			await organizationAction(page, "logout");
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.navigate(app.http.origin + "/#conversation=" + target.conversationId);
			await page.wait('location.hash===""');
			assert.equal(await page.evaluate('!!document.querySelector("[data-action=signin]")'), true);
			assert.doesNotMatch(
				String(await page.evaluate("document.body.textContent")),
				/NOTIFICATION-LINK-INPUT|LOCAL-ANSWER/,
			);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
