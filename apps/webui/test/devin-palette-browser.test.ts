import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend } from "./frontend-controls.ts";

// Commands -> Settings is a same-commit dialog handoff, not a dismissal.
// Keep a native pointer and browser-history trace so a vanished view cannot pass.
test(
	"Devin palette: keyboard/search and extension settings preserve the dialog handoff on desktop and phone",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "palette");
		let recordHistory: (() => Promise<void>) | undefined;
		try {
			await mkdir(evidence, { recursive: true });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "web") },
				owner: "Owner",
				extensions: [
					{ root: resolve("apps/webui/examples/hello") },
					{ root: resolve("apps/webui/examples/preferences") },
				],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("#composerInput")');
			await settleFrontend(page);
			await page.evaluate(
				`(()=>{globalThis.sheetHistory=[];for(const name of ['pushState','replaceState','back']){const original=history[name].bind(history);history[name]=(...args)=>{globalThis.sheetHistory.push({op:name,before:history.state?.pakkaSheet??null,after:args[0]?.pakkaSheet??null});return original(...args);};}addEventListener('popstate',()=>globalThis.sheetHistory.push({op:'popstate',state:history.state?.pakkaSheet??null}));})()`,
			);
			recordHistory = async () => {
				await writeFile(
					join(evidence, "history.json"),
					JSON.stringify(await page.evaluate("globalThis.sheetHistory"), null, 2),
				);
			};
			for (const size of [
				{ width: 1440, height: 900 },
				{ width: 360, height: 600 },
			]) {
				await page.resize(size);
				await settleFrontend(page);
				await page.click('[aria-label="Commands and extensions"]');
				await page.wait('document.querySelector(".palette input")===document.activeElement');
				assert.equal(
					await page.evaluate('Boolean(document.querySelector(".pocket-sheet"))'),
					false,
					"Commands must use the reference palette, not the old modal",
				);
				await page.type('[aria-label="Find command"]', "preferences");
				await page.wait('document.querySelector(".palette [data-interface=preferences-settings]")');
				await page.key("ArrowDown");
				assert.equal(
					await page.evaluate('document.activeElement?.getAttribute("data-command")'),
					"preferences-status",
				);
				await page.key("Enter");
				await page.wait('!document.querySelector(".palette")');
				assert.equal(m.f.requests.length, 0, "A read command must not send a model request");
				await page.click('[aria-label="Commands and extensions"]');
				await page.wait('document.querySelector(".palette")');
				await writeFile(join(evidence, `commands-${size.width}.png`), await page.screenshot());
				await page.click("[data-action=manage-extensions]");
				await page.wait('document.querySelector(".settings-view")?.contains(document.activeElement)');
				// Two subsequent protocol round trips distinguish a retained dialog from a
				// transient mount immediately undone by the previous sheet's history.back().
				await writeFile(join(evidence, `extensions-${size.width}.png`), await page.screenshot());
				assert.equal(await page.evaluate('document.querySelectorAll(".settings-view").length'), 1);
				assert.equal(
					await page.evaluate('document.querySelectorAll(".pocket-extension-registration").length'),
					2,
				);
				assert.equal(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
				assert.equal(
					await page.evaluate(
						`[...document.querySelectorAll(".pocket-extension-registration")].every(row => {const buttons=[...row.querySelectorAll("button")],rects=buttons.map(button=>button.getBoundingClientRect());return row.closest(".settings-card") && getComputedStyle(row).display==="flex" && rects.every(rect=>rect.height>=28) && rects.every((rect,index)=>index===0 || rect.left-rects[index-1].right>=8 || rect.top-rects[index-1].bottom>=8);})`,
					),
					true,
					"Extension registrations use reference Settings cards and separated native action targets",
				);
				await page.key("Escape");
				await page.wait('!document.querySelector(".settings-view")');
				await settleFrontend(page);
				assert.equal(
					await page.evaluate('document.activeElement?.getAttribute("aria-label")'),
					"Commands and extensions",
					"Handoff preserves the original connected focus-return target",
				);
			}
			await page.resize({ width: 1440, height: 900 });
			await settleFrontend(page);
			await page.click("[data-action=search-conversations]");
			await page.wait('document.querySelector(".palette input")===document.activeElement');
			await page.click(".palette [data-action=commands]");
			await page.wait(`document.querySelector('[aria-label="Find command"]')===document.activeElement`);
			await page.type('[aria-label="Find command"]', "preferences");
			await page.wait('document.querySelector(".palette [data-command=preferences-status]")');
			await page.key("Escape");
			await page.wait('!document.querySelector(".palette")');
			assert.equal(m.f.requests.length, 0);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await recordHistory?.();
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
