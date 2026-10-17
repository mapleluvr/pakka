import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// Losing dismissal or allowing a background click to submit must fail this real mobile browser consumer.
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
			await page.click('[aria-label="Toggle conversations"]');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			await page.type("textarea[name=message]", "KEEP-THIS-UNSENT-DRAFT");
			const target = await page.evaluate(
				'document.querySelector("[data-conversation].selected").dataset.conversation',
			);
			await page.click('[aria-label="Toggle conversations"]');
			await page.wait('getComputedStyle(document.querySelector(".sidebar")).display !== "none"');
			// Interacting with the sidebar itself must leave it open.
			await page.click('[aria-label="Find conversations"]');
			assert.equal(
				await page.evaluate('getComputedStyle(document.querySelector(".sidebar")).display !== "none"'),
				true,
			);
			assert.equal(
				await page.evaluate(`Boolean(document.querySelector('[aria-label="Close conversations"]'))`),
				true,
				"The shaded area beside the sidebar needs an actionable close target",
			);
			await page.click('[aria-label="Close conversations"]');
			await page.wait('getComputedStyle(document.querySelector(".sidebar")).display === "none"');
			assert.equal(
				await page.evaluate('document.querySelector("[data-conversation].selected").dataset.conversation'),
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
			await page.click('[aria-label="Toggle conversations"]');
			await page.wait('getComputedStyle(document.querySelector(".sidebar")).display !== "none"');
			await page.key("Escape");
			await page.wait('getComputedStyle(document.querySelector(".sidebar")).display === "none"');
			assert.equal(
				await page.evaluate('document.activeElement?.getAttribute("aria-label")'),
				"Toggle conversations",
			);
			assert.equal(m.f.requests.length, 0, "Dismissing navigation must never submit the draft");
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
