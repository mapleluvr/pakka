import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { toggleConversations, settleFrontend } from "./frontend-controls.ts";

// Dismissal must preserve the selected resource and draft without inference.
test(
	"Pocket mobile sidebar: outside click and Escape return to the same conversation without sending the draft",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "web") },
				owner: "Owner",
				initial: [{ name: "Mobile draft", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token, {
				width: 390,
				height: 844,
			});
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await toggleConversations(page);
			await page.click("[data-conversation]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			await settleFrontend(page);
			await page.type("textarea[name=message]", "KEEP-THIS-UNSENT-DRAFT");
			const target = await page.evaluate(
				'document.querySelector("[data-conversation][aria-current=true]").dataset.conversation',
			);
			await toggleConversations(page);
			await page.click('[aria-label="Session options"]');
			assert.equal(await page.evaluate('document.body.classList.contains("drawer-open")'), true);
			await page.key("Escape");
			await settleFrontend(page);
			assert.equal(
				await page.evaluate('document.querySelector(".scrim").getAttribute("aria-label")'),
				"Close conversations",
				"The shaded area must expose a named dismissal action",
			);
			// Only the right-hand strip is visible; the drawer covers the scrim centre.
			await page.click('[aria-label="Close conversations"]', { offset: { x: 0.95, y: 0.5 } });
			await settleFrontend(page);
			await page.wait('document.querySelector(".sidebar").getBoundingClientRect().right <= 0');
			assert.equal(
				await page.evaluate(
					'document.querySelector("[data-conversation][aria-current=true]").dataset.conversation',
				),
				target,
			);
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"KEEP-THIS-UNSENT-DRAFT",
			);
			assert.equal(
				await page.evaluate('document.activeElement?.getAttribute("aria-label")'),
				"Toggle conversations",
			);
			await toggleConversations(page);
			await page.key("Escape");
			await settleFrontend(page);
			await page.wait('document.querySelector(".sidebar").getBoundingClientRect().right <= 0');
			assert.equal(
				await page.evaluate('document.activeElement?.getAttribute("aria-label")'),
				"Toggle conversations",
			);
			assert.equal(m.f.requests.length, 0, "Dismissal never submits the draft");
			assert.equal(m.f.errors.length, 0);
			const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "mobile-sidebar");
			await mkdir(evidence, { recursive: true });
			await writeFile(join(evidence, "dismissed.png"), await page.screenshot());
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
