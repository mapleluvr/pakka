import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import {
	conversationAction,
	organizationAction,
	openConversationMenu,
	findInConversation,
	openAppearance,
} from "./frontend-controls.ts";

test(
	"Pocket navigation browser: rename/archive/search/restore, reviewed resend, real fork and keyboard history have actual subsequent effects",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "navigation-product") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "navigation-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await openConversationMenu(page);
			await conversationAction(page, "conversation");
			await page.wait('document.querySelector("input[name=conversationName]")');
			await page.type("input[name=conversationName]", "Renamed through UI", { replace: true });
			await page.click("[data-action=rename]");
			await page.wait('document.querySelector(".pocket-title").textContent.includes("Renamed through UI")');
			await conversationAction(page, "conversation");
			await page.click("[data-action=archive]");
			await page.wait('!document.querySelector("[data-conversation]")');
			assert.match(String(await page.evaluate("document.body.innerText")), /Archive.*not.*cancel/i);
			await page.click("[data-action=search-conversations]");
			await page.wait('document.querySelector("[data-action=show-archived]")');
			await page.click("[data-action=show-archived]");
			assert.equal(
				await page.evaluate('document.querySelector("[data-action=show-archived]").checked'),
				true,
				"Archived sessions checkbox is selected by the real pointer",
			);
			await page.wait('document.querySelector("[data-search-conversation]")');
			await page.type('input[aria-label="Search conversations"]', "does-not-exist");
			await page.wait('!document.querySelector("[data-search-conversation]")');
			await page.type('input[aria-label="Search conversations"]', "Renamed", { replace: true });
			await page.wait('document.querySelector("[data-search-conversation]")');
			await page.click("[data-search-conversation]");
			await conversationAction(page, "conversation");
			await page.click("[data-action=restore]");
			await page.wait('!document.querySelector("[role=dialog]")');
			await page.click("[data-action=search-conversations]");
			await page.wait('document.querySelector("[data-action=show-archived]")');
			await page.click("[data-action=show-archived]");
			await page.key("Escape");
			await page.type("textarea[name=message]", "REVIEWED-EXPLICIT-INPUT");
			await page.click("[data-action=send]");
			await page.wait('document.querySelectorAll("[data-role=assistant]").length===1');
			assert.equal(m.f.requests.length, 1);
			await page.click("[data-action=use-draft]");
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"REVIEWED-EXPLICIT-INPUT",
			);
			assert.equal(m.f.requests.length, 1, "copy to draft is not a resend");
			await page.type("textarea[name=message]", "SECOND-REVIEWED-INPUT", { replace: true });
			await page.click("[data-action=send]");
			await page.wait('document.querySelectorAll("[data-role=assistant]").length===2');
			await findInConversation(page, "REVIEWED-EXPLICIT");
			await page.wait('document.querySelectorAll("[data-entry]").length===1');
			await findInConversation(page, "");
			await conversationAction(page, "conversation");
			await page.type("input[name=forkName]", "Real fork");
			await page.click("[data-action=fork]");
			await page.wait('document.querySelector(".pocket-title").textContent.includes("Real fork")');
			await page.type("textarea[name=message]", "FORK-CONTINUES");
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".pocket-receipt")?.textContent.includes("done")');
			assert.equal(m.f.requests.length, 3);
			assert.match(JSON.stringify(m.f.requests[2]), /REVIEWED-EXPLICIT-INPUT|SECOND-REVIEWED-INPUT/);
			await organizationAction(page, "people");
			await page.wait('document.querySelector("[role=dialog]")?.contains(document.activeElement)');
			await page.key("Escape");
			await page.wait('!document.querySelector("[role=dialog]")');
			assert.equal(
				await page.evaluate('document.activeElement===document.querySelector(".org-trigger")'),
				true,
			);
			await organizationAction(page, "people");
			await page.wait('document.querySelector("[role=dialog]")?.contains(document.activeElement)');
			await page.evaluate("history.back()");
			await page.wait('!document.querySelector("[role=dialog]")');
			assert.equal(m.f.requests.length, 3);
			await openAppearance(page);
			await page.evaluate(
				`(()=>{const theme=document.querySelector("[aria-label=Theme]");theme.value="light";theme.dispatchEvent(new Event("change",{bubbles:true}));})()`,
			);
			await page.click('[aria-label="Close appearance"]');
			const appearance = await page.evaluate("document.documentElement.dataset.mode");
			await page.reload();
			await page.wait('document.querySelectorAll("[data-conversation]").length===2');
			assert.equal(await page.evaluate("document.documentElement.dataset.mode"), appearance);
			assert.equal(m.f.requests.length, 3);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
