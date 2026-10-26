import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { openAppearance, openConversations, settleFrontend } from "./frontend-controls.ts";

const longModel = "local-preview/very-long-model-identity-" + "readable-".repeat(18);
test(
	"Creation dialog layout: phone and desktop, 20px light/dark, nested pickers and keyboard focus keep complete controls without a home composer",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const directory =
			process.env.PAKKA_CREATION_LAYOUT_DIR ?? join("docs", ".temp", "session-creation", "layout-current");
		await mkdir(directory, { recursive: true });
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: {
					...m.config,
					dataDir: join(m.f.root, "creation-layout"),
					profiles: [{ id: "long", model: longModel }],
				},
				owner: "Owner",
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "creation-layout-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector(".app-shell")');
			for (const reading of [
				{ theme: "dark", size: 14 },
				{ theme: "light", size: 20 },
			]) {
				await openAppearance(page);
				await page.type('[aria-label="Theme"]', "");
				await page.key(reading.theme === "light" ? "ArrowDown" : "ArrowUp");
				await page.type('[aria-label="Text size"]', "");
				for (let index = 0; index < (reading.size - 14) / 2; index++) await page.key("ArrowDown");
				await page.click(".back-to-app");
				for (const size of [
					{ width: 1440, height: 900 },
					{ width: 360, height: 600 },
					{ width: 390, height: 650 },
				]) {
					await page.resize(size);
					assert.equal(
						await page.evaluate(
							'Array.from(document.querySelectorAll(".home-create-card button")).every(node=>{const r=node.getBoundingClientRect();return r.width>=44&&r.height>=44})',
						),
						true,
						"home creation and commands have complete hit areas, not an input-bar remnant",
					);
					const homeActions = await page.evaluate(
						`Array.from(document.querySelectorAll('.home-create-card [data-action="new-conversation"], .home-create-card [data-action="new-session"]'),button=>{const icon=button.querySelector('svg').getBoundingClientRect(),text=Array.from(button.childNodes).find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim()),range=document.createRange();range.selectNodeContents(text);const words=range.getBoundingClientRect();return {action:button.dataset.action,display:getComputedStyle(button).display,gap:words.left-icon.right,centerDelta:Math.abs(words.y+words.height/2-icon.y-icon.height/2)}})`,
					);
					console.log(
						JSON.stringify({ homeActions, theme: reading.theme, size: reading.size, width: size.width }),
					);
					for (const action of homeActions as { action: string; gap: number; centerDelta: number }[]) {
						assert.ok(action.centerDelta <= 2, `${action.action}: icon and words must share a visual center`);
						assert.ok(action.gap >= 7.5, `${action.action}: icon and words require an actual 8px gap`);
					}
					await openConversations(page);
					await page.click('.primary-nav [data-action="new-conversation"]');
					await page.wait('document.querySelector("[data-creation-form] input[name=name]")');
					assert.equal(
						await page.evaluate("document.activeElement?.name"),
						"name",
						"async loading must focus the actual dialog name input",
					);
					await page.click('[data-action="creation-model"]');
					await page.wait('document.querySelector("[data-model-search]")');
					assert.equal(
						await page.evaluate('document.activeElement?.hasAttribute("data-model-search")'),
						true,
					);
					assert.equal(
						await page.evaluate(
							'document.querySelector(".pocket-model-picker").textContent.includes("Approved Models")',
						),
						false,
						"model configuration is not another grant",
					);
					await page.click(`[data-pick-model=${JSON.stringify(longModel)}]`);
					await page.wait(
						`document.querySelector('[data-action="creation-model"]').textContent.includes(${JSON.stringify(longModel)}) && !document.querySelector('[data-model-search]')`,
					);
					await settleFrontend(page);
					const label = `${reading.theme}-${reading.size}-${size.width}x${size.height}`;
					await writeFile(join(directory, label + ".png"), await page.screenshot());
					const geometry = (await page.evaluate(
						`(()=>{const sheet=document.querySelector('.pocket-sheet:has(> .creation-body)'), form=sheet.querySelector('[data-creation-form]');const box=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return {sheet:box(sheet),overflow:sheet.scrollWidth>sheet.clientWidth+1,fields:Array.from(form.querySelectorAll('.creation-field')).map(node=>{const first=node.firstChild, range=document.createRange();range.selectNodeContents(first);const r=range.getBoundingClientRect(), control=node.querySelector('input,select,button');return {name:node.textContent.slice(0,30),gap:control.getBoundingClientRect().top-r.bottom,font:parseFloat(getComputedStyle(control).fontSize)}}),targets:Array.from(sheet.querySelectorAll('button')).map(node=>({name:node.getAttribute('aria-label')||node.textContent,box:box(node)}))}})()`,
					)) as {
						sheet: { x: number; y: number; right: number; bottom: number };
						overflow: boolean;
						fields: { name: string; gap: number; font: number }[];
						targets: { name: string; box: { width: number; height: number } }[];
					};
					await writeFile(join(directory, label + ".json"), JSON.stringify(geometry, null, 2));
					assert.equal(geometry.overflow, false, JSON.stringify(geometry));
					assert.ok(
						await page.evaluate(
							'document.querySelector("[data-action=creation-model]").getBoundingClientRect().height<=120',
						),
						"the model preview must not consume the entire dialog; its picker is the full-name reading path",
					);
					assert.ok(
						geometry.sheet.x >= -1 &&
							geometry.sheet.right <= size.width + 1 &&
							geometry.sheet.y >= -1 &&
							geometry.sheet.bottom <= size.height + 1,
						"the dialog is inside the real viewport",
					);
					for (const field of geometry.fields) {
						assert.ok(field.gap >= 4, `labels do not join the following control: ${JSON.stringify(field)}`);
						assert.ok(
							field.font >= (reading.size * 13) / 14 - 0.1,
							`new fields use the actual reading preference: ${JSON.stringify(field)}`,
						);
					}
					for (const target of geometry.targets)
						assert.ok(
							target.box.width >= 44 && target.box.height >= 44,
							`complete 44px targets: ${JSON.stringify(target)}`,
						);
					await page.click('[data-action="creation-directory"]');
					await page.wait('document.querySelector("[data-directory-path]")');
					await page.key("Escape");
					assert.equal(
						await page.evaluate('Boolean(document.querySelector("[data-creation-form]"))'),
						true,
						"nested Escape closes only the directory picker",
					);
					assert.equal(await page.evaluate("document.activeElement?.dataset.action"), "creation-directory");
					await page.type("[data-create-confirm]", "");
					await page.key("Tab");
					assert.equal(
						await page.evaluate('document.activeElement?.getAttribute("aria-label")'),
						"Close creation",
					);
					await page.key("Tab", true);
					assert.equal(
						await page.evaluate('document.activeElement?.hasAttribute("data-create-confirm")'),
						true,
					);
					await page.key("Escape");
					assert.equal(await page.evaluate('Boolean(document.querySelector("[role=dialog]"))'), false);
					assert.equal(
						await page.evaluate(
							'document.activeElement?.matches(".primary-nav [data-action=new-conversation]")',
						),
						true,
						"focus returns to the original creation entry",
					);
					assert.equal(
						await page.evaluate('Boolean(document.querySelector("#composerInput,[data-home-create]"))'),
						false,
					);
				}
			}
			assert.equal(m.f.requests.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
