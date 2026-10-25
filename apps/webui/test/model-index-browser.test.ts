import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { openConversations } from "./frontend-controls.ts";

type Browser = Awaited<ReturnType<typeof ownedBrowser>>;
type Page = Awaited<ReturnType<Browser["page"]>>;
const search = '[aria-label="Search models"]';
const active = '.pocket-model-picker [role="option"][aria-selected="true"]';

async function withPicker(
	profiles: { id: string; model: string }[],
	run: (
		page: Page,
		app: Awaited<ReturnType<typeof startPocket>>,
		m: Awaited<ReturnType<typeof runtimeFixture>>,
	) => Promise<void>,
) {
	const m = await runtimeFixture({ profiles });
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined, browser: Browser | undefined;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "catalog") },
			owner: "Owner",
			profiles: ["default", ...profiles.map((row) => row.id)],
			initial: [{ name: "Model Index", profile: "default" }],
		});
		browser = await ownedBrowser(join(m.f.root, "index-browser"));
		const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner!.token);
		await page.wait('document.querySelector("[data-action=signin]")');
		await page.click("[data-action=signin]");
		await page.wait('document.querySelector("[data-conversation]")');
		await page.click("[data-conversation]");
		await page.wait('document.querySelector("[data-action=model]")?.disabled===false');
		await page.click("[data-action=model]");
		await page.wait('document.querySelector("[data-pick-model]")');
		await run(page, app, m);
	} finally {
		await browser?.close();
		await app?.close();
		await m.close();
	}
}

async function position(page: Page, text: string) {
	await page.wait(
		'document.querySelector("[data-model-position]")?.textContent.trim()===' + JSON.stringify(text),
	);
	assert.equal(
		await page.evaluate(
			`(()=>{const input=document.querySelector(${JSON.stringify(search)}),row=document.querySelector(${JSON.stringify(active)});return document.activeElement===input&&input.getAttribute('aria-activedescendant')===(row?.id??null)})()`,
		),
		true,
		"arrow navigation keeps search focus and exposes the highlighted option to assistive technology",
	);
}

test(
	"Model index: small catalogs support fuzzy input, cyclic navigation, empty results and cancellation",
	{ timeout: 30000 },
	async () => {
		await withPicker(
			[
				{ id: "research", model: "azure/reasoning-pro" },
				{ id: "fast", model: "orion/instant" },
			],
			async (page, app, m) => {
				assert.equal(
					await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(search)}))`),
					true,
					"even a three-model catalog has an immediately available search index",
				);
				const closeSize = (await page.evaluate(
					'(()=>{const r=document.querySelector(".pocket-sheet > header button").getBoundingClientRect();return {width:r.width,height:r.height}})()',
				)) as { width: number; height: number };
				assert.ok(
					closeSize.width >= 44 && closeSize.height >= 44,
					`the standalone Close icon has a 44px hit target: ${JSON.stringify(closeSize)}`,
				);
				await position(page, "1 / 3");
				await page.key("ArrowUp");
				await position(page, "3 / 3");
				assert.equal(
					await page.evaluate(`document.querySelector(${JSON.stringify(active)}).dataset.pickModel`),
					"orion/instant",
				);
				await page.key("ArrowDown");
				await position(page, "1 / 3");
				await page.key("ArrowDown");
				await position(page, "2 / 3");
				assert.equal(
					await page.evaluate('document.querySelector("[data-current-model]").dataset.pickModel'),
					"local-model",
					"browsing a candidate does not move the applied-model marker",
				);
				await page.key("Tab");
				await page.wait('document.activeElement?.dataset.pickModel==="azure/reasoning-pro"');
				await page.key("Tab");
				assert.equal(
					await page.evaluate('document.activeElement?.getAttribute("aria-label")'),
					"Close model picker",
				);
				await page.key("Tab", true);
				assert.equal(
					await page.evaluate("document.activeElement?.dataset.pickModel"),
					"azure/reasoning-pro",
					"reverse Tab returns to the highlighted row, not an excluded option",
				);
				await page.key("Tab", true);
				await position(page, "2 / 3");
				await page.type(search, "REAS AZ", { replace: true });
				await page.wait('document.querySelectorAll("[data-pick-model]").length===1');
				await position(page, "1 / 1");
				assert.equal(
					await page.evaluate(`document.querySelector(${JSON.stringify(active)}).dataset.pickModel`),
					"azure/reasoning-pro",
					"tokens can match model segments in a different order and ignore case",
				);
				// Supplemental DOM-event guard: this does not claim native OS IME acceptance.
				await page.evaluate(
					`document.querySelector(${JSON.stringify(search)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))`,
				);
				await position(page, "1 / 1");
				assert.match(
					String(await page.evaluate('document.querySelector("[data-action=model]").textContent')),
					/local-model/,
				);
				await page.type(search, "az/reas", { replace: true });
				await page.wait('document.querySelectorAll("[data-pick-model]").length===1');
				await position(page, "1 / 1");
				await page.type(search, "no-such-model-xyz", { replace: true });
				await page.wait('document.querySelectorAll("[data-pick-model]").length===0');
				await position(page, "0 / 0");
				await page.key("Enter");
				assert.equal(await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(search)}))`), true);
				await page.type(search, "   ", { replace: true });
				await position(page, "1 / 3");
				await page.key("Escape");
				await page.wait('!document.querySelector(".pocket-model-picker")');
				assert.equal(await page.evaluate("document.activeElement?.dataset.action"), "model");
				assert.match(
					String(await page.evaluate('document.querySelector("[data-action=model]").textContent')),
					/local-model/,
				);
				await page.click("[data-action=model]");
				await position(page, "1 / 3");
				await page.key("Enter");
				await page.wait('!document.querySelector(".pocket-model-picker")');
				assert.equal(m.f.requests.length, 0);
				assert.equal(app.runtime.view().budget.primaryAttempts, 0);
			},
		);
	},
);

test(
	"Model index: long lists retain visible input/index and ranked keyboard confirmation reaches the real provider",
	{ timeout: 45000 },
	async () => {
		await withPicker(
			Array.from({ length: 12 }, (_, index) => ({
				id: "choice-" + index,
				model:
					index === 11
						? "remote/reasoning-professional-with-a-long-model-identifier-11"
						: "alternate-" + index,
			})),
			async (page, app, m) => {
				assert.equal(
					await page.evaluate('document.activeElement?.getAttribute("aria-label")'),
					"Search models",
					"opening the index is ready for typing rather than requiring another click",
				);
				await position(page, "1 / 13");
				const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "model-index");
				await mkdir(output, { recursive: true });
				for (const [name, width, height, theme, size] of [
					["desktop-dark", 1440, 900, "dark", 14],
					["desktop-light", 1440, 900, "light", 14],
					["phone-dark", 360, 600, "dark", 14],
					["phone-light-large", 390, 650, "light", 20],
				] as const) {
					await page.resize({ width, height });
					// CDP viewport acknowledgement precedes the page's resize/Sheet layout commit.
					await page.wait(
						'(()=>{const r=document.querySelector(".pocket-sheet").getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()',
					);
					await page.evaluate(
						`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.style.setProperty('--text-size',${JSON.stringify(size + "px")})`,
					);
					await page.key("ArrowUp");
					await position(page, "13 / 13");
					const geometry = (await page.evaluate(
						`(()=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},row=document.querySelector(${JSON.stringify(active)}),list=row.parentElement,input=document.querySelector(${JSON.stringify(search)});return {row:box(row),list:box(list),input:box(input),position:box(document.querySelector('[data-model-position]')),scroll:list.scrollTop,inputFont:parseFloat(getComputedStyle(input).fontSize),captionFonts:['.pocket-model-search','.pocket-model-index','.pocket-model-keys'].map(selector=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)),overflow:document.documentElement.scrollWidth>innerWidth,ink:getComputedStyle(row).boxShadow,viewport:{width:innerWidth,height:innerHeight}}})()`,
					)) as {
						row: { x: number; y: number; right: number; bottom: number; height: number };
						list: { x: number; y: number; right: number; bottom: number };
						input: { x: number; y: number; right: number; bottom: number };
						position: { x: number; y: number; right: number; bottom: number };
						scroll: number;
						inputFont: number;
						captionFonts: number[];
						overflow: boolean;
						ink: string;
					};
					await writeFile(join(output, name + ".json"), JSON.stringify(geometry, null, 2) + "\n");
					await writeFile(join(output, name + ".png"), await page.screenshot());
					assert.ok(geometry.scroll > 0, "navigation scrolls the list to the final candidate");
					assert.ok(
						geometry.row.y >= geometry.list.y - 1 && geometry.row.bottom <= geometry.list.bottom + 1,
						`the complete active row is visible: ${JSON.stringify(geometry)}`,
					);
					for (const box of [geometry.input, geometry.position])
						assert.ok(
							box.x >= 0 && box.y >= 0 && box.right <= width && box.bottom <= height,
							`input and position stay visible: ${JSON.stringify(geometry)}`,
						);
					assert.equal(geometry.overflow, false);
					assert.notEqual(
						geometry.ink,
						"none",
						"candidate has a visible indicator distinct from the current-model check",
					);
					if (width < 600) assert.ok(geometry.inputFont >= 16, "phone search avoids implicit input zoom");
					if (size === 20)
						assert.ok(
							geometry.captionFonts.every((font) => font >= 17),
							"search labels, index and keyboard hints respect larger text",
						);
					assert.ok(geometry.row.height >= 44, "model rows retain touch targets");
					await page.key("ArrowDown");
					await position(page, "1 / 13");
				}
				await page.type(search, "choice-1");
				await page.wait('document.querySelectorAll("[data-pick-model]").length===3');
				await position(page, "1 / 3");
				assert.equal(
					await page.evaluate(`document.querySelector(${JSON.stringify(active)}).dataset.pickModel`),
					"alternate-1",
					"the exact profile identifier ranks before its longer prefix matches",
				);
				await page.key("ArrowDown");
				await position(page, "2 / 3");
				assert.equal(
					await page.evaluate(`document.querySelector(${JSON.stringify(active)}).dataset.pickModel`),
					"alternate-10",
				);
				await page.type(search, "al10", { replace: true });
				await page.wait('document.querySelectorAll("[data-pick-model]").length===1');
				await position(page, "1 / 1");
				assert.equal(
					await page.evaluate(`document.querySelector(${JSON.stringify(active)}).dataset.pickModel`),
					"alternate-10",
					"nonconsecutive ordered characters find the model",
				);
				assert.equal(m.f.requests.length, 0);
				await page.key("Enter");
				await page.wait(
					'!document.querySelector(".pocket-model-picker")&&document.querySelector("[data-action=model]")?.textContent.includes("alternate-10")',
				);
				assert.equal(await page.evaluate('document.querySelector("[data-action=cwd]").title'), m.f.cwd);
				assert.equal(app.runtime.view().budget.primaryAttempts, 0);
				await page.reload();
				await page.wait('document.querySelector("[data-conversation]")');
				await openConversations(page);
				await page.click("[data-conversation]");
				await page.wait(
					'document.querySelector("[data-action=model]")?.textContent.includes("alternate-10")',
				);
				await page.type('textarea[name="message"]', "INDEX-CONFIRM");
				await page.click("[data-action=send]");
				await page.wait('document.querySelector("main").textContent.includes("LOCAL-ANSWER")');
				assert.equal(m.f.requests.length, 1);
				assert.equal(m.f.requests[0]?.model, "alternate-10");
				assert.match(JSON.stringify(m.f.requests[0]), /PAKKA-SYSTEM/);
			},
		);
	},
);
