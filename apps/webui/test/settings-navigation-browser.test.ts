import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, toggleConversations } from "./frontend-controls.ts";

// Catches a Settings launcher that opens a menu, or loses the active conversation
// while moving between the configuration pages.
test(
	"Settings: one click opens configuration pages and Back returns to the conversation",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "settings-navigation") },
				owner: "Owner",
				initial: [{ name: "Configuration project", profile: "default" }],
				extensions: [{ root: resolve("apps/webui/examples/preferences") }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await settleFrontend(page);
			await page.click("[data-conversation]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			await page.type("textarea[name=message]", "UNSENT SETTINGS DRAFT");
			for (const size of [
				{ width: 1440, height: 900 },
				{ width: 360, height: 600 },
			]) {
				await page.resize(size);
				await settleFrontend(page);
				if (size.width < 600) await toggleConversations(page);
				await page.click('.sidebar-footer [aria-label="Settings"]');
				await page.wait('document.querySelector(".settings-view [aria-label=Theme]")');
				assert.equal(
					await page.evaluate('document.querySelectorAll("[role=menu]").length'),
					0,
					"a single Settings activation enters the page without an intermediate menu",
				);
				if (size.width === 1440) {
					await page.evaluate(
						`(()=>{const original=globalThis.fetch;let first=true;globalThis.fetch=async(...args)=>{const response=await original(...args);if(first&&typeof args[1]?.body==='string'&&JSON.parse(args[1].body).command?.op==='people'){first=false;globalThis.__peopleHeld=true;await new Promise(resolve=>{globalThis.__releasePeople=resolve;});globalThis.__peopleReleased=true;}return response;};})()`,
					);
					await page.click('[data-settings-page="people"]');
					await page.wait("globalThis.__peopleHeld");
					await page.click('[data-settings-page="appearance"]');
					await page.evaluate("globalThis.__releasePeople()");
					await page.wait("globalThis.__peopleReleased");
					await settleFrontend(page);
					assert.equal(
						await page.evaluate('document.querySelector(".settings-page h1")?.textContent'),
						"Appearance",
						"a late People read must not replace the subsequently chosen category",
					);
				}
				await page.click('[data-settings-page="configuration"]');
				await page.wait('document.querySelector("[data-settings-model]")');
				await page.click('[data-settings-page="people"]');
				await page.wait(`document.querySelector('[aria-label="Invite Role"]')`);
				await page.click('[data-settings-page="extensions"]');
				await page.wait('document.querySelector(".extension-manager-list")');
				await page.click('[data-settings-page="appearance"]');
				await page.wait('document.querySelector("[aria-label=Theme]")');
				assert.equal(await page.evaluate('document.querySelectorAll(".settings-view").length'), 1);
				assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
				await page.click(".back-to-app");
				await page.wait('!document.querySelector(".settings-view")');
				await settleFrontend(page);
				assert.equal(
					await page.evaluate('document.querySelector("textarea[name=message]")?.value'),
					"UNSENT SETTINGS DRAFT",
				);
			}
			assert.equal(m.f.requests.length, 0, "configuration navigation never submits the unsent draft");
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
