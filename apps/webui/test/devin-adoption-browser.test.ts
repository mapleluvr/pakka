import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// Catches the rejected implementation: retaining the old controls/layout and
// styling them with a theme instead of adopting the reference frontend.
// Expected geometry is hand-copied from the independently run reference,
// docs/.../final/reference-runtime-check.json, NOT calculated by our renderer.
test(
	"reference frontend adoption: retained reference chrome, explicit creation without home naming, palette and real conversation",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "devin-adoption");
		try {
			await mkdir(evidence, { recursive: true });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "adoption") },
				owner: "Owner",
				profiles: ["default"],
				initial: [{ name: "Real project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click('[data-action="signin"]');
			await page.wait('document.querySelector("[data-conversation]")');
			await page.wait(
				'[...document.querySelectorAll("link[rel=stylesheet]")].every(e=>e.sheet) && document.fonts.status === "loaded"',
			);
			const shape = (await page.evaluate(
				`(()=>{const b=s=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};return {newSession:b('.primary-nav .new-session'),hero:b('.hero-head'),card:b('#composerCard'),toolbar:b('#composerCard .composer-toolbar'),editor:document.querySelector('#composerInput')?.tagName ?? null,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
			)) as {
				newSession: unknown;
				hero: { x: number; y: number; w: number; h: number };
				card: unknown;
				toolbar: unknown;
				editor: unknown;
				overflow: boolean;
			};
			await writeFile(join(evidence, "home-desktop.png"), await page.screenshot());
			await writeFile(join(evidence, "home-desktop.json"), JSON.stringify(shape, null, 2));
			assert.deepEqual(
				{ ...shape, hero: { x: shape.hero.x, w: shape.hero.w, h: shape.hero.h } },
				{
					newSession: { x: 8, y: 44, w: 278, h: 30 },
					hero: { x: 520, w: 700, h: 30 },
					card: null,
					toolbar: null,
					editor: null,
					overflow: false,
				},
				"retained reference chrome keeps its geometry; creation must not reuse the home composer",
			);
			await page.click('[data-action="search-conversations"]');
			await page.wait('document.querySelector(".palette[role=dialog]")?.contains(document.activeElement)');
			assert.equal(
				await page.evaluate('document.querySelector(".palette").getBoundingClientRect().width'),
				680,
			);
			await page.type('input[aria-label="Search conversations"]', "Real");
			await page.click("[data-search-conversation]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			assert.equal(m.f.requests.length, 0, "navigation never submits model work");
			await page.type("textarea[name=message]", "ADOPTED-FRONTEND-REAL-INPUT");
			await page.click('[data-action="send"]');
			await page.wait('document.querySelector(".message-list")?.innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			assert.ok(JSON.stringify(m.f.requests[0]?.messages).includes("ADOPTED-FRONTEND-REAL-INPUT"));
			await writeFile(join(evidence, "conversation-desktop.png"), await page.screenshot());
			for (const size of [
				{ width: 390, height: 844 },
				{ width: 360, height: 600 },
			]) {
				await page.resize(size);
				await page.wait(
					`(()=>{const e=document.querySelector('[aria-label="Toggle conversations"]'),r=e?.getBoundingClientRect();return r&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
				);
				await page.click('[aria-label="Toggle conversations"]');
				await page.wait('document.querySelector(".sidebar").getBoundingClientRect().x === 0');
				await page.key("Escape");
				await page.wait('document.querySelector(".sidebar").getBoundingClientRect().right < 0');
				await page.navigate(app.http.origin);
				await page.wait('document.querySelector(".home-create-card")');
				const mobile = await page.evaluate(
					`(()=>{const r=document.querySelector('.home-create-card').getBoundingClientRect();return {x:r.x,w:r.width,h:r.height,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
				);
				assert.ok(
					mobile &&
						typeof mobile === "object" &&
						"x" in mobile &&
						"w" in mobile &&
						"h" in mobile &&
						"overflow" in mobile,
				);
				assert.equal(mobile.overflow, false);
				assert.ok(
					Number(mobile.x) >= 0 && Number(mobile.x) + Number(mobile.w) <= size.width,
					"creation actions fit the actual phone viewport",
				);
				assert.ok(Number(mobile.h) >= 44);
				assert.equal(
					await page.evaluate(
						'Boolean(document.querySelector("#composerCard,#composerInput,[data-home-create]"))',
					),
					false,
				);
				await writeFile(join(evidence, `home-${size.width}.png`), await page.screenshot());
			}
			await page.resize({ width: 1440, height: 900 });
			await page.click('[data-action="open-settings"]');
			await page.wait('document.querySelector("[aria-label=Theme]")');
			assert.equal(
				await page.evaluate('document.querySelectorAll(".settings-view").length'),
				1,
				"Settings adopts the reference page, not the old right-hand Sheet",
			);
			assert.equal(
				await page.evaluate('document.querySelector(".settings-rail").getBoundingClientRect().width'),
				300,
			);
			await writeFile(join(evidence, "appearance-desktop.png"), await page.screenshot());
			assert.equal(
				await page.evaluate(
					'[...document.fonts].some(font=>font.family.replaceAll(\'"\',\'\') === "Inter" && font.status === "loaded")',
				),
				true,
				"removing legacy CSS must not remove the self-hosted Inter face",
			);
			await page.evaluate(
				'(()=>{const e=document.querySelector("[aria-label=\\"Text size\\"]");e.value="20";e.dispatchEvent(new Event("change",{bubbles:true}))})()',
			);
			assert.equal(await page.evaluate("getComputedStyle(document.body).fontSize"), "20px");
			assert.equal(m.f.requests.length, 1, "changing typography must not send work");
			await page.click("[data-action=reset-appearance]");
			await page.click('[aria-label="Close appearance"]');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			await page.click('[aria-label="Conversation options"]');
			await page.click("[data-action=settings]");
			await page.wait('document.querySelector("[data-settings-model]")');
			assert.equal(
				await page.evaluate('document.querySelectorAll(".settings-view").length'),
				1,
				"real configuration uses the reference Settings route",
			);
			assert.ok(await page.evaluate('Boolean(document.querySelector("[data-session-budget]"))'));
			await writeFile(join(evidence, "configuration-desktop.png"), await page.screenshot());
			await page.click('[aria-label="Close settings"]');
			await page.click('[aria-label="Conversation options"]');
			await page.click("[data-action=notifications]");
			await page.wait('document.querySelector("[aria-label=Notifications]")');
			assert.equal(
				await page.evaluate('document.querySelectorAll(".settings-view").length'),
				1,
				"notification settings use the same page anatomy",
			);
			await page.click('[aria-label="Close notifications"]');
			await page.click(".org-trigger");
			await page.click("[data-action=people]");
			await page.wait('document.querySelector("[aria-label=\\"Invite role\\"]")');
			assert.equal(
				await page.evaluate('document.querySelectorAll(".settings-view").length'),
				1,
				"people and invitations are a Settings page, not an old panel",
			);
			assert.equal(m.f.requests.length, 1, "reading real settings must not replay native work");
			await writeFile(join(evidence, "people-desktop.png"), await page.screenshot());
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
