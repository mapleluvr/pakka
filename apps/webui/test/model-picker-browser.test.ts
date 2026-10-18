import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"Model picker: larger approved catalog is searchable and keyboard selection changes neither cwd nor provider budget",
	{ timeout: 30000 },
	async () => {
		const profiles = Array.from({ length: 12 }, (_, index) => ({
			id: "choice-" + index,
			model: "alternate-" + index,
		}));
		const m = await runtimeFixture({ profiles });
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "catalog") },
				owner: "Owner",
				profiles: ["default", ...profiles.map((row) => row.id)],
				initial: [{ name: "Models", profile: "default" }],
			});
			browser = await ownedBrowser(join(m.f.root, "models-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner!.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=model]")?.disabled===false');
			await page.click("[data-action=model]");
			await page.wait(`document.querySelector('[aria-label="Search models"]')`);
			await page.type('[aria-label="Search models"]', "choice-10");
			await page.wait('document.querySelectorAll("[data-pick-model]").length===1');
			assert.equal(
				await page.evaluate('document.querySelector("[data-pick-model]").dataset.pickModel'),
				"alternate-10",
			);
			await page.key("Tab");
			await page.wait('document.activeElement?.dataset.pickModel==="alternate-10"');
			await page.key("Enter");
			await page.wait(
				'!document.querySelector("[data-pick-model]")&&document.querySelector("[data-action=model]")?.textContent.includes("alternate-10")',
			);
			assert.equal(await page.evaluate('document.querySelector("[data-action=cwd]").title'), m.f.cwd);
			assert.equal(m.f.requests.length, 0);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
