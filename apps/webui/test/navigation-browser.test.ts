import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

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
			await page.wait('document.querySelector("[data-action=conversation]")');
			await page.click("[data-action=conversation]");
			await page.wait('document.querySelector("input[name=conversationName]")');
			await page.type("input[name=conversationName]", "Renamed through UI", { replace: true });
			await page.click("[data-action=rename]");
			await page.wait('document.querySelector(".pocket-title").textContent.includes("Renamed through UI")');
			await page.click("[data-action=conversation]");
			await page.click("[data-action=archive]");
			await page.wait('!document.querySelector("[data-conversation]")');
			assert.match(String(await page.evaluate("document.body.innerText")), /Archive.*not.*cancel/i);
			await page.click("[data-action=show-archived]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.type("[aria-label='Find conversations']", "does-not-exist");
			await page.wait('!document.querySelector("[data-conversation]")');
			await page.type("[aria-label='Find conversations']", "Renamed", { replace: true });
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.click("[data-action=conversation]");
			await page.click("[data-action=restore]");
			await page.wait('!document.querySelector("[role=dialog]")');
			await page.click("[data-action=show-archived]");
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
			await page.type("[aria-label='Find loaded history']", "REVIEWED-EXPLICIT");
			await page.wait('document.querySelectorAll("[data-entry]").length===1');
			await page.type("[aria-label='Find loaded history']", "", { replace: true });
			await page.click("[data-action=conversation]");
			await page.type("input[name=forkName]", "Real fork");
			await page.click("[data-action=fork]");
			await page.wait('document.querySelector(".pocket-title").textContent.includes("Real fork")');
			await page.type("textarea[name=message]", "FORK-CONTINUES");
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".pocket-receipt")?.textContent.includes("done")');
			assert.equal(m.f.requests.length, 3);
			assert.match(JSON.stringify(m.f.requests[2]), /REVIEWED-EXPLICIT-INPUT|SECOND-REVIEWED-INPUT/);
			await page.click("[data-action=people]");
			await page.wait('document.querySelector("[role=dialog]")?.contains(document.activeElement)');
			await page.key("Escape");
			await page.wait('!document.querySelector("[role=dialog]")');
			assert.equal(
				await page.evaluate('document.activeElement===document.querySelector("[data-action=people]")'),
				true,
			);
			await page.click("[data-action=people]");
			await page.wait('document.querySelector("[role=dialog]")?.contains(document.activeElement)');
			await page.evaluate("history.back()");
			await page.wait('!document.querySelector("[role=dialog]")');
			assert.equal(m.f.requests.length, 3);
			await page.click(".pocket-side-foot button");
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
