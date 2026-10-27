import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { openAppearance, openConversations, settleFrontend, type FrontendPage } from "./frontend-controls.ts";

const captures = join("docs", ".temp", "navigation-controls", "captures");
async function inspectUi(
	name: string,
	inspect: (page: FrontendPage, m: Awaited<ReturnType<typeof runtimeFixture>>) => Promise<void>,
) {
	const m = await runtimeFixture();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined,
		browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({ runtime: { ...m.config, dataDir: join(m.f.root, name) }, owner: "Owner" });
		assert.ok(app.initialOwner);
		browser = await ownedBrowser(join(m.f.root, name + "-browser"));
		const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
		await page.wait('document.querySelector("[data-action=signin]")');
		await page.click("[data-action=signin]");
		await page.wait(
			'document.querySelector(".home-create-card") && document.querySelector("[data-navigation-mode]") && !document.querySelector("[data-navigation-mode]").disabled',
		);
		await mkdir(captures, { recursive: true });
		await inspect(page, m);
	} finally {
		await browser?.close();
		await app?.close();
		await m.close();
	}
}
async function navigation(page: FrontendPage) {
	const response = (await page.evaluate(
		`fetch('/pocket/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Pakka-CSRF':document.cookie.match(/(?:^|; )pakka_csrf=([^;]+)/)[1]},body:JSON.stringify({version:2,requestId:crypto.randomUUID(),command:{op:'navigation.read'}})}).then(async r=>({status:r.status,body:await r.json()}))`,
	)) as { status: number; body: { result: { view: { mode: string; version: number } } } };
	assert.equal(response.status, 200);
	return response.body.result.view;
}
async function reading(page: FrontendPage, theme: "dark" | "light", size: number) {
	await openAppearance(page);
	await page.type('[aria-label="Theme"]', "");
	await page.key(theme === "light" ? "ArrowDown" : "ArrowUp");
	await page.type('[aria-label="Text size"]', "");
	for (let index = 0; index < (size - 14) / 2; index++) await page.key("ArrowDown");
	await page.click(".back-to-app");
	await settleFrontend(page);
	if (await page.evaluate('document.body.classList.contains("drawer-open")')) {
		await page.click('[aria-label="Close conversations"]', { offset: { x: 0.95, y: 0.5 } });
		await settleFrontend(page);
	}
}

// A native select, saving on arrow browsing, losing parent focus, or a separate popup theme must fail here.
test(
	"Grouping menu: shared themed popup supports keyboard cancellation, explicit persisted choice and normal Tab without model input",
	{ timeout: 45000 },
	async () => {
		await inspectUi("grouping-menu", async (page, m) => {
			for (const settings of [
				{ theme: "dark" as const, size: 14, width: 1440, height: 900 },
				{ theme: "light" as const, size: 20, width: 360, height: 600 },
			]) {
				await reading(page, settings.theme, settings.size);
				await page.resize({ width: settings.width, height: settings.height });
				await openConversations(page);
				await page.wait('!document.querySelector("[data-navigation-mode]").disabled');
				const before = await navigation(page);
				assert.equal(
					await page.evaluate('document.querySelector("[data-navigation-mode]").tagName'),
					"BUTTON",
					"grouping must use the workbench popup rather than a system select",
				);
				await page.click(".org-trigger");
				await page.wait('document.querySelector(".org-menu")');
				const sharedStyle = await page.evaluate(
					`(()=>{const s=getComputedStyle(document.querySelector('.org-menu'));return {background:s.backgroundColor,color:s.color,radius:s.borderRadius,shadow:s.boxShadow,font:s.fontSize}})()`,
				);
				await page.key("Escape");
				await page.click("[data-navigation-mode]");
				await page.wait(
					'document.querySelector(".grouping-menu [role=menuitemradio]") && getComputedStyle(document.querySelector(".grouping-menu")).visibility === "visible"',
				);
				const sample = (await page.evaluate(
					`(()=>{const popup=document.querySelector('.grouping-menu'),r=popup.getBoundingClientRect(),s=getComputedStyle(popup);return {inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,style:{background:s.backgroundColor,color:s.color,radius:s.borderRadius,shadow:s.boxShadow,font:s.fontSize},checked:popup.querySelector('[aria-checked=true]')?.dataset.navigationChoice,focused:document.activeElement?.dataset.navigationChoice,marked:Boolean(popup.querySelector('[aria-checked=true] svg'))}})()`,
				)) as { inside: boolean; style: unknown; checked: string; focused: string; marked: boolean };
				assert.equal(sample.inside, true);
				assert.deepEqual(sample.style, sharedStyle);
				assert.equal(sample.checked, before.mode);
				assert.equal(sample.focused, before.mode);
				assert.equal(sample.marked, true);
				const fonts = (await page.evaluate(
					'[getComputedStyle(document.querySelector(".grouping-menu .menu-row")).fontSize,getComputedStyle(document.querySelector("[data-navigation-mode]")).fontSize]',
				)) as string[];
				assert.equal(fonts[0], fonts[1], "menu choices scale with the same UI text role as their trigger");
				if (settings.size === 20)
					assert.ok(parseFloat(fonts[0]!) > 14, "enlarged menu text cannot stay at the small default size");
				await writeFile(
					join(captures, `menu-${settings.theme}-${settings.width}.json`),
					JSON.stringify({ ...sample, fonts }, null, 2) + "\n",
				);
				await writeFile(
					join(captures, `menu-${settings.theme}-${settings.width}.png`),
					await page.screenshot(),
				);
				const other = before.mode === "default" ? "session" : "default";
				await page.key("ArrowDown");
				assert.equal(await page.evaluate("document.activeElement?.dataset.navigationChoice"), other);
				assert.equal(
					await page.evaluate(
						'document.querySelector(".grouping-menu [aria-checked=true]").dataset.navigationChoice',
					),
					before.mode,
				);
				await page.key("Escape");
				await page.wait('!document.querySelector(".grouping-menu")');
				assert.equal(
					await page.evaluate('document.activeElement===document.querySelector("[data-navigation-mode]")'),
					true,
				);
				assert.deepEqual(await navigation(page), before, "browsing and Escape cannot save a preference");
				await page.key("Enter");
				await page.wait('document.querySelector(".grouping-menu")');
				await page.key(other === "session" ? "End" : "Home");
				await page.key("Enter");
				await page.wait(
					`!document.querySelector('.grouping-menu')&&!document.querySelector('[data-navigation-mode]').disabled&&document.querySelector('[data-navigation-mode]').value===${JSON.stringify(other)}`,
				);
				assert.equal((await navigation(page)).mode, other);
				await page.reload();
				await openConversations(page);
				await page.wait(
					`document.querySelector('[data-navigation-mode]')?.value===${JSON.stringify(other)}&&!document.querySelector('[data-navigation-mode]').disabled`,
				);
				await page.click("[data-navigation-mode]");
				await page.wait('document.querySelector(".grouping-menu")');
				assert.equal(await page.evaluate("document.activeElement?.dataset.navigationChoice"), other);
				await page.key("Tab");
				await page.wait('!document.querySelector(".grouping-menu")');
				assert.equal(
					await page.evaluate(
						'document.activeElement!==document.body && !document.activeElement.closest("[role=menu]") && document.activeElement!==document.querySelector("[data-navigation-mode]")',
					),
					true,
					"Tab must leave the menu, not be sent back to its trigger",
				);
				await page.click("[data-navigation-mode]");
				await page.wait('document.querySelector(".grouping-menu")');
				await page.click(`[data-navigation-choice=${JSON.stringify(before.mode)}]`);
				await page.wait(
					`!document.querySelector('[data-navigation-mode]').disabled&&document.querySelector('[data-navigation-mode]').value===${JSON.stringify(before.mode)}`,
				);
				assert.equal((await navigation(page)).mode, before.mode);
				assert.equal(m.f.requests.length, 0);
			}
		});
	},
);

// A one-sided filled button, missing/stranded separator, clipped focus, or regressed SVG/text centers must fail here.
test(
	"Home creation pair: equal transparent actions and a short gray divider retain alignment and real dialog behavior at 20px/phone sizes",
	{ timeout: 45000 },
	async () => {
		await inspectUi("home-creation-pair", async (page, m) => {
			for (const settings of [
				{ theme: "dark" as const, size: 14 },
				{ theme: "light" as const, size: 20 },
			]) {
				await reading(page, settings.theme, settings.size);
				for (const viewport of [
					{ width: 1440, height: 900 },
					{ width: 360, height: 600 },
					{ width: 390, height: 650 },
				]) {
					await page.resize(viewport);
					await settleFrontend(page);
					const sample = (await page.evaluate(
						`(()=>{const box=r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}),buttons=Array.from(document.querySelectorAll('.home-create-card [data-action=new-conversation],.home-create-card [data-action=new-session]')),actions=buttons.map(button=>{const s=getComputedStyle(button),r=button.getBoundingClientRect(),i=button.querySelector('svg').getBoundingClientRect(),text=Array.from(button.childNodes).find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()),range=document.createRange();range.selectNodeContents(text);const words=range.getBoundingClientRect();return {...box(r),background:s.backgroundColor,weight:s.fontWeight,font:s.fontSize,iconWidth:i.width,iconHeight:i.height,gap:words.left-i.right,centerDelta:Math.abs(words.y+words.height/2-i.y-i.height/2)}}),divider=document.querySelector('[data-creation-divider]');return {backdrop:getComputedStyle(document.body).backgroundColor,actions,divider:divider?{...box(divider.getBoundingClientRect()),hidden:divider.getAttribute('aria-hidden'),tab:divider.tabIndex,color:getComputedStyle(divider).backgroundColor}:null,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
					)) as {
						backdrop: string;
						actions: {
							x: number;
							y: number;
							right: number;
							bottom: number;
							width: number;
							height: number;
							background: string;
							weight: string;
							font: string;
							iconWidth: number;
							iconHeight: number;
							gap: number;
							centerDelta: number;
						}[];
						divider: null | {
							x: number;
							y: number;
							right: number;
							height: number;
							width: number;
							hidden: string;
							tab: number;
							color: string;
						};
						overflow: boolean;
					};
					await writeFile(
						join(captures, `home-${settings.theme}-${viewport.width}.png`),
						await page.screenshot(),
					);
					await writeFile(
						join(captures, `home-${settings.theme}-${viewport.width}.json`),
						JSON.stringify(sample, null, 2) + "\n",
					);
					assert.deepEqual(
						sample.actions.map((a) => a.background),
						["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"],
						"both creation actions must be transparent, not one filled pill",
					);
					assert.equal(sample.actions[0].weight, sample.actions[1].weight);
					assert.equal(sample.actions[0].font, sample.actions[1].font);
					assert.ok(sample.divider, "the two creation actions need a real short divider");
					assert.ok(
						sample.divider.width > 0 &&
							sample.divider.width <= 2 &&
							sample.divider.height >= 10 &&
							sample.divider.height <= 24,
					);
					assert.ok(
						sample.divider.x > sample.actions[0].right && sample.divider.right < sample.actions[1].x,
						"the divider stays between its two actions even on a phone",
					);
					assert.ok(
						Math.abs(
							sample.divider.y +
								sample.divider.height / 2 -
								sample.actions[0].y -
								sample.actions[0].height / 2,
						) <= 1,
					);
					assert.equal(sample.divider.hidden, "true");
					assert.ok(sample.divider.tab < 0);
					const rgba = sample.divider.color.match(/[\d.]+/g)!.map(Number),
						backdrop = sample.backdrop.match(/[\d.]+/g)!.map(Number),
						alpha = rgba[3] ?? 1,
						rgb = rgba.slice(0, 3).map((value, index) => value * alpha + backdrop[index]! * (1 - alpha));
					assert.ok(
						Math.max(...rgb) - Math.min(...rgb) <= 2 && rgb[0]! >= 50 && rgb[0]! <= 210,
						"the visible, alpha-composited divider is a neutral gray",
					);
					assert.equal(sample.overflow, false);
					for (const action of sample.actions) {
						assert.ok(action.width >= 44 && action.height >= 44);
						assert.equal(action.iconWidth, 24);
						assert.equal(action.iconHeight, 24);
						assert.ok(action.gap >= 7.5);
						assert.ok(action.centerDelta <= 2);
						assert.ok(action.x >= 0 && action.right <= viewport.width);
					}
				}
			}
			for (const [action, label] of [
				["new-conversation", "New Conversation"],
				["new-session", "New Session"],
			]) {
				if (action === "new-session") {
					await page.key("Tab");
					assert.equal(
						await page.evaluate(
							'document.activeElement===document.querySelector(".home-create-card [data-action=new-session]")',
						),
						true,
						"the decorative divider adds no Tab stop",
					);
					assert.equal(
						await page.evaluate(
							'document.activeElement.matches(":focus-visible") && getComputedStyle(document.activeElement).outlineStyle !== "none"',
						),
						true,
					);
					await page.key("Enter");
				} else await page.click(`.home-create-card [data-action=${JSON.stringify(action)}]`);
				await page.wait('document.querySelector("[data-creation-form]")');
				assert.equal(
					await page.evaluate('document.querySelector(".pocket-sheet header h2").textContent'),
					label,
				);
				await page.key("Escape");
				await page.wait('!document.querySelector("[data-creation-form]")');
				assert.equal(
					await page.evaluate(
						`document.activeElement===document.querySelector('.home-create-card [data-action=${JSON.stringify(action)}]')`,
					),
					true,
				);
			}
			assert.equal(m.f.requests.length, 0);
		});
	},
);
