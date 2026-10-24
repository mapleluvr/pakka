import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, toggleConversations } from "./frontend-controls.ts";

test(
	"composer focus follows the rounded outer card for pointer and keyboard input",
	{ timeout: 60000 },
	async (t) => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "composer-focus");
		try {
			await mkdir(evidence, { recursive: true });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "composer-focus") },
				owner: "Focus Operator",
				initial: [{ name: "Keyboard Focus", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await settleFrontend(page);
			type Focus = {
				active: boolean;
				focusVisible: boolean;
				card: { outline: number; style: string; offset: number; radius: number };
				surface: { outline: number; shadow: string };
				inputOutline: number;
				visible: boolean;
				overflow: boolean;
			};
			const inspect = async () =>
				(await page.evaluate(`(() => {
			const input = document.querySelector('textarea'), card = input.closest('.composer-card'), surface = card.querySelector('.composer-surface');
			const c = getComputedStyle(card), s = getComputedStyle(surface), i = getComputedStyle(input), box = card.getBoundingClientRect();
			return { active: document.activeElement === input, focusVisible: input.matches(':focus-visible'),
				card: { outline: parseFloat(c.outlineWidth), style: c.outlineStyle, offset: parseFloat(c.outlineOffset), radius: parseFloat(c.borderTopLeftRadius) },
				surface: { outline: s.outlineStyle === "none" ? 0 : parseFloat(s.outlineWidth), shadow: s.boxShadow }, inputOutline: i.outlineStyle === "none" ? 0 : parseFloat(i.outlineWidth),
				visible: box.x >= 3 && box.right <= innerWidth - 3, overflow: document.documentElement.scrollWidth > innerWidth };
		})()`)) as Focus;
			for (const width of [1440, 390]) {
				await page.resize({ width, height: 900 });
				await settleFrontend(page);
				for (const view of ["home", "conversation"]) {
					await t.test(`${view} ${width}px pointer and Tab`, async () => {
						if (view === "conversation") {
							if (width < 768) await toggleConversations(page);
							await page.click("[data-conversation]");
							await page.wait('document.querySelector("#replyInput")');
						} else if (await page.evaluate('!!document.querySelector("#replyInput")')) {
							if (width < 768) await toggleConversations(page);
							await page.click('[data-action="home"]');
							await page.wait('document.querySelector("#composerInput")');
						}
						await settleFrontend(page);
						await page.click("textarea");
						const pointer = await inspect();
						await writeFile(join(evidence, `${view}-${width}-pointer.png`), await page.screenshot());
						assert.equal(pointer.active, true);
						assert.equal(
							pointer.surface.outline,
							0,
							"the internal surface must not draw the rectangular blue outline",
						);
						assert.equal(pointer.inputOutline, 0, "do not introduce a second textarea rectangle");
						assert.equal(pointer.card.outline, 2, "text input focus is visible at the outer card");
						assert.ok(pointer.card.radius >= 16, "focus follows the rounded card");
						assert.equal(pointer.overflow, false);
						await page.key("Tab");
						await page.key("Tab", true);
						const keyboard = await inspect();
						assert.equal(keyboard.active, true, "native Tab order returns to the editor");
						assert.equal(keyboard.focusVisible, true);
						assert.equal(keyboard.card.outline, 2);
						assert.equal(keyboard.card.style, "solid");
						assert.ok(keyboard.card.offset >= 2);
						assert.equal(keyboard.surface.outline, 0);
						assert.equal(keyboard.visible, true, "the full focus ring fits in the viewport");
						await writeFile(join(evidence, `${view}-${width}-keyboard.png`), await page.screenshot());
						await writeFile(
							join(evidence, `${view}-${width}.json`),
							JSON.stringify({ pointer, keyboard }, null, 2),
						);
					});
				}
			}
			assert.equal(m.f.requests.length, 0, "focus and navigation never submit model work");
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
