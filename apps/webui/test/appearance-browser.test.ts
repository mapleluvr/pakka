import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { toggleConversations, openAppearance } from "./frontend-controls.ts";

// Losing persisted typography, failing to apply it, or hiding Send at a larger size must fail this real consumer.
test(
	"Pocket appearance: font and size survive reload without sending the draft, with mobile Send beside input mode",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "appearance") },
				owner: "Owner",
				initial: [{ name: "Read comfortably", profile: "default" }],
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
			await page.wait('[...document.querySelectorAll("link[rel=stylesheet]")].every(e=>e.sheet)');
			await toggleConversations(page);
			await page.click("[data-conversation]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			await page.type("textarea[name=message]", "KEEP-TYPOGRAPHY-DRAFT");
			await toggleConversations(page);
			assert.equal(
				await page.evaluate('Boolean(document.querySelector("[data-action=appearance]"))'),
				true,
				"Appearance must expose font and size preferences",
			);
			await openAppearance(page);
			await page.wait('document.querySelector("[aria-label=Font]")');
			const choose = (selector: string, value: string) =>
				page.evaluate(
					`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event("change",{bubbles:true}));})()`,
				);
			await choose('[aria-label="Font"]', "system");
			await choose('[aria-label="Text size"]', "20");
			await choose('[aria-label="Theme"]', "light");
			assert.equal(await page.evaluate("getComputedStyle(document.body).fontSize"), "20px");
			assert.match(String(await page.evaluate("getComputedStyle(document.body).fontFamily")), /system-ui/);
			assert.equal(await page.evaluate("document.documentElement.dataset.mode"), "light");
			assert.match(
				String(
					await page.evaluate(
						'getComputedStyle(document.querySelector(".pocket-font-preview code")).fontFamily',
					),
				),
				/JetBrains Mono/,
			);
			await page.click('[aria-label="Close appearance"]');
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"KEEP-TYPOGRAPHY-DRAFT",
			);
			const controls = (await page.evaluate(
				`(()=>{const mode=document.querySelector('[aria-label="Input mode"]').getBoundingClientRect(),send=document.querySelector('[data-action="send"]').getBoundingClientRect();return {mode:{left:mode.left,right:mode.right,top:mode.top,bottom:mode.bottom,width:mode.width},send:{left:send.left,right:send.right,top:send.top,bottom:send.bottom},viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
			)) as {
				mode: { left: number; right: number; top: number; bottom: number; width: number };
				send: { left: number; right: number; top: number; bottom: number };
				viewport: number;
				overflow: boolean;
			};
			assert.ok(controls.send.right <= controls.mode.left, "Input mode and Send must fit beside each other");
			assert.ok(
				Math.max(controls.mode.top, controls.send.top) < Math.min(controls.mode.bottom, controls.send.bottom),
				"Input mode and Send must share a row",
			);
			assert.ok(controls.send.right <= controls.viewport);
			assert.equal(controls.overflow, false);
			assert.equal(m.f.requests.length, 0, "Typography changes must not submit the draft");
			const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "appearance");
			await mkdir(evidence, { recursive: true });
			await writeFile(join(evidence, "mobile-20px.png"), await page.screenshot());
			await writeFile(join(evidence, "composer-controls.json"), JSON.stringify(controls, null, 2));
			await page.reload();
			await page.wait('document.querySelector("[data-action=appearance]")');
			await page.wait('[...document.querySelectorAll("link[rel=stylesheet]")].every(e=>e.sheet)');
			assert.equal(await page.evaluate("getComputedStyle(document.body).fontSize"), "20px");
			assert.match(String(await page.evaluate("getComputedStyle(document.body).fontFamily")), /system-ui/);
			assert.equal(await page.evaluate("document.documentElement.dataset.mode"), "light");
			await toggleConversations(page);
			await openAppearance(page);
			await page.wait('document.querySelector("[aria-label=Font]")');
			assert.equal(await page.evaluate('document.querySelector("[aria-label=Font]").value'), "system");
			assert.equal(await page.evaluate(`document.querySelector('[aria-label="Text size"]').value`), "20");
			await choose('[aria-label="Font"]', "serif");
			assert.match(String(await page.evaluate("getComputedStyle(document.body).fontFamily")), /ui-serif/);
			await page.click("[data-action=reset-appearance]");
			assert.equal(await page.evaluate("getComputedStyle(document.body).fontSize"), "14px");
			assert.match(String(await page.evaluate("getComputedStyle(document.body).fontFamily")), /Inter/);
			assert.equal(await page.evaluate("document.documentElement.dataset.mode"), "dark");
			await page.evaluate(
				'localStorage.setItem("pakka-typography",JSON.stringify({font:"invalid",size:-100}))',
			);
			await page.reload();
			await page.wait('document.querySelector("[data-action=appearance]")');
			await page.wait('[...document.querySelectorAll("link[rel=stylesheet]")].every(e=>e.sheet)');
			assert.equal(await page.evaluate("getComputedStyle(document.body).fontSize"), "14px");
			assert.match(String(await page.evaluate("getComputedStyle(document.body).fontFamily")), /Inter/);
			assert.equal(m.f.requests.length, 0);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
