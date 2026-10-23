import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { conversationAction } from "./frontend-controls.ts";

// Dropping errorMessage at the wire boundary must not strand a reopened Conversation in Connecting.
test(
	"WebUI error history: a cleared-credential failure stays readable after restart without replay",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		const runtime = { ...m.config, dataDir: join(m.f.root, "error-history") };
		const initial = [{ name: "Error history", profile: "default" }];
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({ runtime, owner: "Owner", initial });
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "error-history-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await conversationAction(page, "settings");
			await page.wait('document.querySelector("[data-credential-clear]")?.disabled===false');
			await page.click("[data-credential-clear]");
			await page.wait('document.querySelector("[data-credential-status]")?.dataset.configured==="false"');
			await page.click('[aria-label="Close settings"]');
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await page.type("textarea[name=message]", "ERROR-HISTORY-ORIGINAL");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".pocket-receipt")?.textContent.includes("unanswered")');
			const sessionFile = app.runtime.view().sessionFile,
				origin = app.http.origin;
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			assert.equal(m.f.requests.length, 0);
			await app.close();
			app = undefined;
			app = await startPocket({
				runtime: { ...runtime, reopenSessionFile: sessionFile },
				transport: { port: Number(new URL(origin).port) },
				owner: "Owner",
				initial,
			});
			await page.navigate(origin);
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("main")?.textContent.includes("ERROR-HISTORY-ORIGINAL")');
			await page.wait(
				'document.querySelector("[data-message-error]")?.textContent.includes("Configured provider credential unavailable")',
			);
			assert.equal(await page.evaluate('document.querySelector("[data-action=send]").disabled'), false);
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			assert.equal(
				m.f.requests.length,
				0,
				"Reading failed history cannot dispatch or fall back to the bootstrap credential",
			);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
