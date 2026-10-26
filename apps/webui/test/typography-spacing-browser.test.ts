import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import {
	conversationAction,
	openAppearance,
	organizationAction,
	settleFrontend,
	toggleConversations,
} from "./frontend-controls.ts";

type Box = { x: number; y: number; right: number; bottom: number; width: number; height: number };
const separate = (a: Box, b: Box, label: string, gap = 8) => {
	assert.ok(
		b.x - a.right >= gap - 0.5 || b.y - a.bottom >= gap - 0.5,
		`${label} need ${gap}px of real layout separation: ${JSON.stringify({ a, b })}`,
	);
};

test(
	"WebUI compound labels, settings forms and graphical keyboard hints remain readable",
	{ timeout: 90000 },
	async (t) => {
		const longModel = "provider/" + "UnbrokenModelIdentifier".repeat(7);
		const profiles = [
			{ id: "long-profile", model: longModel },
			...Array.from({ length: 9 }, (_, index) => ({ id: "choice-" + index, model: "alternate-" + index })),
		];
		const m = await runtimeFixture({ profiles });
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "typography-spacing");
		await mkdir(output, { recursive: true });
		const publicRoot = join(m.f.root, "public-layout-consumer");
		await mkdir(join(publicRoot, "web"), { recursive: true });
		await Promise.all([
			writeFile(
				join(publicRoot, "manifest.json"),
				JSON.stringify({
					api: 1,
					id: "layout-primitives",
					version: "1.0.0",
					title: "Public Primitives",
					facets: { webui: { entry: "index.js", publicDir: "web" } },
					actions: [],
					commands: [],
					interfaces: [
						{
							id: "home",
							title: "Public Primitives",
							slot: "page",
							scope: "app",
							export: "Home",
							navigation: true,
						},
					],
				}),
			),
			writeFile(
				join(publicRoot, "web", "index.js"),
				`
				import { h } from "preact";
				import { useState } from "preact/hooks";
				import { Button, Field, Notice, Stack } from "@pakka/webui/components";
				export function Home() {
					const [count, setCount] = useState(0);
					return h(Stack, null,
						h("h2", null, "Public Primitives"),
						h(Field, { label: "Example Field" }, h("input", { "data-public-field": true })),
						h(Notice, null, h("span", { "data-public-copy": true }, "Layout fixture: informational text stays separate from its action."),
							h(Button, { "data-public-action": true, onClick: () => setCount(count + 1) }, "Check")),
						h("output", { "data-public-count": true }, count));
				}
			`,
			),
		]);
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "typography-spacing") },
				owner: "Operator_" + "readability".repeat(6),
				profiles: ["default", ...profiles.map((row) => row.id)],
				initial: [{ name: "Readable forms", profile: "default" }],
				extensions: [{ root: publicRoot }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "typography-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await settleFrontend(page);
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=model]")?.disabled===false');
			await t.test("owned navigation titles use Title Case", async () => {
				assert.deepEqual(
					await page.evaluate(
						`['.primary-nav [data-action=new-session] > span','.primary-nav [data-action=new-conversation] > span','[data-action=commands] > span'].map(selector=>document.querySelector(selector).textContent)`,
					),
					["New Session", "New Conversation", "Commands & Extensions"],
				);
			});
			const boxes = async (selectors: readonly string[]) =>
				(await page.evaluate(
					`(${JSON.stringify(selectors)}).map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})`,
				)) as Box[];
			const capture = async (name: string) => {
				await settleFrontend(page);
				await writeFile(join(output, name + ".png"), await page.screenshot());
			};
			for (const size of [
				{ width: 1440, height: 900 },
				{ width: 360, height: 600 },
				{ width: 390, height: 650 },
				{ width: 390, height: 844 },
			]) {
				await t.test(
					`model primary and profile have distinct rows at ${size.width}x${size.height}`,
					async () => {
						await page.resize(size);
						await settleFrontend(page);
						if (
							size.width < 760 &&
							(await page.evaluate('document.querySelector(".sidebar").getBoundingClientRect().right>0'))
						)
							await toggleConversations(page);
						await page.wait('document.querySelector("[data-action=model]")?.disabled===false');
						await page.click("[data-action=model]");
						await page.wait('document.querySelector("[data-pick-model]")');
						try {
							await capture(`models-${size.width}x${size.height}`);
							const rows =
								(await page.evaluate(`Array.from(document.querySelectorAll('[data-pick-model]')).map(node=>{
						const box=e=>{const range=document.createRange();range.selectNodeContents(e);const r=range.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
						const primary=node.querySelector('strong'), secondary=node.querySelector('small');
						return {model:node.dataset.pickModel,primary:box(primary),secondary:box(secondary),rowWidth:node.getBoundingClientRect().width,listWidth:node.parentElement.clientWidth,overflow:node.scrollWidth>node.clientWidth,primaryColor:getComputedStyle(primary).color,secondaryColor:getComputedStyle(secondary).color,weight:Number(getComputedStyle(primary).fontWeight)};
					})`)) as {
									model: string;
									primary: Box;
									secondary: Box;
									rowWidth: number;
									listWidth: number;
									overflow: boolean;
									primaryColor: string;
									secondaryColor: string;
									weight: number;
								}[];
							assert.equal(rows.length, profiles.length + 1);
							for (const row of rows) {
								assert.ok(
									row.secondary.y >= row.primary.bottom + 1,
									`model/profile must not read as one identifier: ${JSON.stringify(row)}`,
								);
								assert.notEqual(row.primaryColor, row.secondaryColor, "metadata has a secondary text role");
								assert.ok(row.weight <= 600, "identifier does not use browser-default heavy bold");
								assert.ok(
									Math.abs(row.rowWidth - row.listWidth) <= 1,
									"each option owns a full-width, stable reading row",
								);
								assert.equal(row.overflow, false, `full long model stays inside its option: ${row.model}`);
							}
						} finally {
							await page.key("Escape");
						}
					},
				);
			}

			await t.test(
				"private credentials keep labels, password input and actions separate at every viewport and larger text",
				async () => {
					await page.resize({ width: 1440, height: 900 });
					await openAppearance(page);
					await page.evaluate(
						`(()=>{const field=document.querySelector('[aria-label="Text size"]');field.value='20';field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
					);
					await page.click(".back-to-app");
					await conversationAction(page, "settings");
					await page.wait('document.querySelector("[data-credential-input]")?.disabled===false');
					try {
						assert.equal(
							await page.evaluate('document.querySelector(".settings-page h1").textContent'),
							"Conversation Settings",
						);
						assert.equal(
							await page.evaluate('document.querySelector("[data-settings-page=people] span").textContent'),
							"People & Invitations",
						);
						for (const size of [
							{ width: 1440, height: 900 },
							{ width: 360, height: 600 },
							{ width: 390, height: 650 },
							{ width: 390, height: 844 },
						]) {
							await page.resize(size);
							await page.evaluate(
								'document.querySelector("[data-credential-input]").scrollIntoView({block:"center",behavior:"instant"})',
							);
							await capture(`credentials-large-${size.width}x${size.height}`);
							const [field, replace, clear] = await boxes([
								"[data-credential-input]",
								"[data-credential-replace]",
								"[data-credential-clear]",
							]);
							const label = (await page.evaluate(
								`(()=>{const node=document.querySelector('[data-credential-input]').closest('label').firstChild,range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})()`,
							)) as Box;
							assert.ok(field && replace && clear);
							separate(label, field, "replacement label and field", 4);
							assert.ok(
								Math.abs(label.x - field.x) <= 1,
								"field label is left-aligned with its input, not centered by a parent row rule",
							);
							separate(field, replace, "replacement field and actions");
							separate(replace, clear, "replace and clear actions");
							assert.equal(
								await page.evaluate('document.querySelector("[data-credential-input]").type'),
								"password",
							);
							assert.equal(
								await page.evaluate('document.querySelector("[data-credential-input]").value'),
								"",
							);
							assert.equal(
								await page.evaluate(
									'document.documentElement.scrollWidth<=innerWidth && document.querySelector(".settings-content").scrollWidth<=document.querySelector(".settings-content").clientWidth',
								),
								true,
							);
							if (size.width < 600)
								for (const box of [field, replace, clear])
									assert.ok(box.height >= 44, "mobile controls retain 44px targets");
						}
					} finally {
						await page.click('[aria-label="Close settings"]');
					}
				},
			);

			await t.test(
				"model identities and metadata also fit with the actual 20px reading preference",
				async () => {
					for (const size of [
						{ width: 390, height: 650 },
						{ width: 1440, height: 900 },
					]) {
						await page.resize(size);
						await settleFrontend(page);
						if (
							size.width < 760 &&
							(await page.evaluate('document.querySelector(".sidebar").getBoundingClientRect().right>0'))
						)
							await toggleConversations(page);
						await page.click("[data-action=model]");
						await page.wait('document.querySelector("[data-pick-model]")');
						try {
							await capture(`models-large-${size.width}`);
							assert.equal(
								// The established UI token scales 13/14 of the reading size, not 1:1.
								// At the real 20px preference the expected identity type is 18.57px.
								await page.evaluate(`Array.from(document.querySelectorAll('[data-pick-model]')).every(node=>{
						const primary=node.querySelector('strong'), secondary=node.querySelector('small');
						return Math.abs(parseFloat(getComputedStyle(primary).fontSize)-20*13/14)<0.1 && secondary.getBoundingClientRect().top>=primary.getBoundingClientRect().bottom+1 && node.scrollWidth<=node.clientWidth;
					})`),
								true,
							);
						} finally {
							await page.key("Escape");
						}
					}
				},
			);

			await t.test("Conversation and Fork fields have gaps and subordinate section headings", async () => {
				await page.resize({ width: 1440, height: 900 });
				await conversationAction(page, "conversation");
				await page.wait('document.querySelector("input[name=forkName]")');
				try {
					await capture("conversation-form-large");
					const [name, lastEntry, create] = await boxes([
						"input[name=forkName]",
						'[aria-label="Fork through entry"]',
						"[data-action=fork]",
					]);
					assert.ok(name && lastEntry && create);
					separate(name, lastEntry, "adjacent fork fields");
					separate(lastEntry, create, "fork field and action");
					const sizes = (await page.evaluate(
						`[...document.querySelectorAll('.pocket-sheet h2,.pocket-sheet h3')].map(node=>parseFloat(getComputedStyle(node).fontSize))`,
					)) as number[];
					const [heading, subheading] = sizes;
					assert.ok(
						heading !== undefined && subheading !== undefined && subheading <= heading,
						"subsection heading does not outrank the dialog title",
					);
				} finally {
					await page.key("Escape");
				}
			});

			await t.test(
				"Team metadata, chat fields and note actions are laid out rather than pasted together",
				async () => {
					await conversationAction(page, "collaboration");
					try {
						await page.wait('document.querySelector("[data-action=save-note]")');
						await page.type("textarea[name=teamChat]", "Human layout audit; not a model input.");
						await page.click('[data-action="post-chat"]');
						await page.wait('document.querySelector("[data-chat-message]")');
						for (const size of [
							{ width: 1440, height: 900 },
							{ width: 360, height: 600 },
						]) {
							await page.resize(size);
							await page.evaluate(
								'document.querySelector("[data-action=save-note]").scrollIntoView({block:"center",behavior:"instant"})',
							);
							await capture(`team-large-${size.width}`);
							const [chat, mention, noteLabel, version, save, author, time] = await boxes([
								"textarea[name=teamChat]",
								'[aria-label="Human Team Chat" i] select',
								'[aria-label="Shared Notes" i] label',
								'[aria-label="Shared Notes" i] small',
								"[data-action=save-note]",
								"[data-chat-message] header strong",
								"[data-chat-message] header time",
							]);
							assert.ok(chat && mention && noteLabel && version && save && author && time);
							separate(chat, mention, "chat and mention fields");
							separate(noteLabel, version, "shared note field and version");
							separate(version, save, "shared note version and save action");
							separate(author, time, "chat author and timestamp");
							const overflow = await page.evaluate(
								`Array.from(document.querySelectorAll('.pocket-sheet, .pocket-sheet *')).filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>({tag:node.tagName,className:node.className,width:node.clientWidth,scroll:node.scrollWidth,wrap:getComputedStyle(node).overflowWrap})).slice(0,12)`,
							);
							assert.equal(
								await page.evaluate(
									'document.querySelector(".pocket-sheet").scrollWidth<=document.querySelector(".pocket-sheet").clientWidth',
								),
								true,
								JSON.stringify(overflow),
							);
						}
						assert.deepEqual(
							await page.evaluate(
								'Array.from(document.querySelectorAll(".pocket-sheet h2,.pocket-sheet h3"),node=>node.textContent.trim())',
							),
							["Team Collaboration", "Team Chat", "Shared Notes"],
						);
					} finally {
						await page.key("Escape");
					}
				},
			);

			await t.test("long names and roles remain readable in People", async () => {
				await page.resize({ width: 360, height: 600 });
				await organizationAction(page, "people");
				await page.wait('document.querySelector(".pocket-person-row")');
				try {
					assert.equal(
						await page.evaluate('document.querySelector(".settings-page h1").textContent.trim()'),
						"People & Invitations",
					);
					await capture("people-long-name-mobile");
					assert.equal(
						await page.evaluate(
							'document.querySelector(".pocket-person-row").scrollWidth<=document.querySelector(".pocket-person-row").clientWidth',
						),
						true,
						"long person identity wraps without pushing role/actions outside the card",
					);
				} finally {
					await page.click('[aria-label="Close people"]');
				}
			});

			await t.test("shortcut and palette direction hints use real SVG paths", async () => {
				await page.resize({ width: 1440, height: 900 });
				await page.click('[data-action="search-conversations"]');
				await page.wait('document.querySelector(".palette-footer")');
				try {
					assert.equal(
						await page.evaluate('document.querySelectorAll(".palette-footer kbd svg path").length'),
						3,
					);
					assert.doesNotMatch(
						String(await page.evaluate('document.querySelector(".palette-footer").textContent')),
						/[↑↓↵]/u,
					);
					assert.equal(await page.evaluate('document.querySelectorAll(".row-kbd svg path").length'), 1);
					assert.doesNotMatch(
						String(await page.evaluate('document.querySelector(".row-kbd").textContent')),
						/⇧/u,
					);
				} finally {
					await page.key("Escape");
				}
			});
			await t.test(
				"public Field/Notice/Button consumers retain spacing without private host styles",
				async () => {
					await page.resize({ width: 1440, height: 900 });
					await settleFrontend(page);
					await page.click("[data-interface=layout-primitives-home]");
					await page.wait('document.querySelector("[data-public-action]")');
					for (const size of [
						{ width: 1440, height: 900 },
						{ width: 360, height: 600 },
					]) {
						await page.resize(size);
						await capture("public-primitives-" + size.width);
						const [label, field, copy, action] = await boxes([
							".pocket-extension-field > span",
							"[data-public-field]",
							"[data-public-copy]",
							"[data-public-action]",
						]);
						assert.ok(label && field && copy && action);
						t.diagnostic(JSON.stringify({ publicWidth: size.width, label, field, copy, action }));
						separate(label, field, "public field label and control", 6);
						separate(copy, action, "public notice copy and its action", 8);
						assert.ok(action.height >= (size.width < 600 ? 44 : 36));
						assert.equal(
							await page.evaluate(
								'document.querySelector(".extension-page").scrollWidth<=document.querySelector(".extension-page").clientWidth',
							),
							true,
						);
					}
					await page.click("[data-public-action]");
					await page.wait('document.querySelector("[data-public-count]").textContent==="1"');
				},
			);
			assert.equal(
				m.f.requests.length,
				0,
				"reading, resizing and human collaboration never dispatch model work",
			);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
