import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, toggleConversations } from "./frontend-controls.ts";

test(
	"composer focus follows the rounded outer card for pointer and keyboard input",
	{ timeout: 60000 },
	async (t) => {
		const release = deferred();
		const m = await runtimeFixture({}, undefined, async () => {
			await release.promise;
			return { text: "FOCUS CHECK COMPLETE" };
		});
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
			// Read the rendered PNG: an outline in computed style can still be almost entirely clipped.
			const buttonFocus = async (label: string) => {
				const box = (await page.evaluate(`(() => {
					const button = document.activeElement, r = button.getBoundingClientRect();
					return { x: r.x, y: r.y, width: r.width, height: r.height,
						name: button.getAttribute('aria-label') ?? button.textContent.trim(), visible: button.matches(':focus-visible') };
				})()`)) as { x: number; y: number; width: number; height: number; name: string; visible: boolean };
				const image = PNG.sync.read(await page.screenshot());
				const cx = Math.round(box.x + box.width / 2),
					cy = Math.round(box.y + box.height / 2);
				const edges = {
					top: [cx - 3, Math.ceil(box.y)],
					bottom: [cx - 3, Math.floor(box.y + box.height) - 6],
					left: [Math.ceil(box.x), cy - 3],
					right: [Math.floor(box.x + box.width) - 6, cy - 3],
				};
				const pixels = Object.fromEntries(
					Object.entries(edges).map(([edge, [x, y]]) => {
						let count = 0;
						for (let dy = 0; dy < 6; dy++)
							for (let dx = 0; dx < 6; dx++) {
								const i = ((y! + dy) * image.width + x! + dx) * 4;
								if (
									image.data[i + 2]! - image.data[i]! >= 45 &&
									image.data[i + 2]! - image.data[i + 1]! >= 25
								)
									count++;
							}
						return [edge, count];
					}),
				);
				const crop = new PNG({ width: Math.ceil(box.width) + 12, height: Math.ceil(box.height) + 12 });
				PNG.bitblt(image, crop, Math.floor(box.x) - 6, Math.floor(box.y) - 6, crop.width, crop.height, 0, 0);
				await writeFile(join(evidence, `${label}.png`), PNG.sync.write(crop));
				return { ...box, pixels };
			};
			const tabTo = async (selector: string) => {
				for (let i = 0; i < 16; i++) {
					await page.key("Tab");
					if (await page.evaluate(`document.activeElement.matches(${JSON.stringify(selector)})`)) return;
				}
				assert.fail("Native Tab order did not reach " + selector);
			};
			for (const width of [1440, 390]) {
				await page.resize({ width, height: 900 });
				await settleFrontend(page);
				for (const view of ["conversation"]) {
					await t.test(`${view} ${width}px pointer and Tab`, async () => {
						// Home creation is now a configuration dialog, not another composer.
						if (width < 768) await toggleConversations(page);
						await page.click("[data-conversation]");
						await page.wait('document.querySelector("#replyInput")');
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
					await t.test(`${view} ${width}px Tab visibly outlines each split button`, async () => {
						await page.type("textarea", "UNSENT FOCUS CHECK", { replace: true });
						const results = [];
						for (const theme of ["dark", "light"]) {
							await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
							await page.click("textarea");
							await tabTo(".send-btn");
							results.push(await buttonFocus(`${view}-${width}-${theme}-send`));
							await page.key("Tab");
							assert.equal(await page.evaluate('document.activeElement.matches(".send-caret")'), true);
							results.push(await buttonFocus(`${view}-${width}-${theme}-caret`));
							await page.type("textarea", "", { replace: true });
							await tabTo(".send-caret");
							results.push(await buttonFocus(`${view}-${width}-${theme}-empty-caret`));
							await page.type("textarea", "UNSENT FOCUS CHECK", { replace: true });
						}
						await tabTo(".send-caret");
						await writeFile(
							join(evidence, `${view}-${width}-buttons.json`),
							JSON.stringify(results, null, 2),
						);
						for (const result of results) {
							assert.equal(result.visible, true);
							for (const [edge, count] of Object.entries(result.pixels))
								assert.ok(
									count >= 4,
									`${result.name}: ${edge} focus edge must be painted, got ${count} accent pixels`,
								);
						}
						await page.key("Enter");
						await page.wait('document.querySelector(".menu[role=menu]")');
						await page.key("Escape");
						await page.wait('!document.querySelector(".menu[role=menu]")');
						assert.equal(await page.evaluate('document.activeElement.matches(".send-caret")'), true);
						await page.evaluate('document.documentElement.dataset.theme = "dark"');
					});
				}
			}
			assert.equal(m.f.requests.length, 0, "focus and navigation never submit model work");
			await t.test("Stop, Steer Send and mode retain separate focus while a real turn runs", async () => {
				await page.type("textarea", "HOLD FOR KEYBOARD CHECK", { replace: true });
				await page.click("[data-action=send]");
				await page.wait('document.querySelector(".stop-btn")');
				await page.click(".send-caret");
				await page.click('[data-input-mode="steer"]');
				await page.wait('document.querySelector(".native-mode-label")?.textContent === "Steer"');
				await page.click("textarea");
				const results = [];
				for (const target of [".stop-btn", ".send-btn", ".send-caret"]) {
					await tabTo(target);
					results.push(await buttonFocus(`running-${target.slice(1)}`));
				}
				await writeFile(join(evidence, "running-buttons.json"), JSON.stringify(results, null, 2));
				for (const result of results) {
					assert.equal(result.visible, true);
					for (const [edge, count] of Object.entries(result.pixels))
						assert.ok(
							count >= 4,
							`${result.name}: ${edge} focus edge must be painted, got ${count} accent pixels`,
						);
				}
				await page.key("Tab", true);
				await page.key("Tab", true);
				assert.equal(await page.evaluate('document.activeElement.matches(".stop-btn")'), true);
				await page.key("Enter");
				await page.wait('!document.querySelector(".stop-btn")');
				assert.equal(
					m.f.requests.length,
					1,
					"only the deliberate running-turn check called the local provider",
				);
			});
		} finally {
			release.resolve();
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
