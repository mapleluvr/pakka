import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import {
	conversationAction,
	inputMode,
	openExtensionManager,
	openAppearance,
	settleFrontend,
	type FrontendPage,
} from "./frontend-controls.ts";

const captures = join("docs", ".temp", "ui-copy-cleanup", "captures");
async function inspect(
	name: string,
	body: (
		page: FrontendPage,
		app: Awaited<ReturnType<typeof startPocket>>,
		m: Awaited<ReturnType<typeof runtimeFixture>>,
	) => Promise<void>,
	respond?: Parameters<typeof runtimeFixture>[2],
) {
	const m = await runtimeFixture({}, undefined, respond);
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, name) },
			owner: "Owner",
			initial: [{ name: "Copy project", profile: "default" }],
			extensions: [{ root: resolve("apps/webui/examples/hello"), facets: ["webui"] }],
		});
		assert.ok(app.initialOwner);
		browser = await ownedBrowser(join(m.f.root, name + "-browser"));
		const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
		await page.wait('document.querySelector("[data-action=signin]")');
		await page.click("[data-action=signin]");
		await page.wait(
			'document.querySelector(".home-create-card") && document.querySelector("[data-conversation]")',
		);
		await mkdir(captures, { recursive: true });
		await body(page, app, m);
	} finally {
		await browser?.close();
		await app?.close();
		await m.close();
	}
}

// Catches a tutorial returning to the form, a picker losing scope labels, or draft inspection creating native work.
test(
	"Concise creation: normal controls carry the operation; server/device scope stays readable while cancelled drafts leave resources unchanged",
	{ timeout: 30000 },
	async () => {
		await inspect("copy-creation", async (page, app, m) => {
			const original = app.runtime.view().conversations.length;
			assert.equal(
				await page.evaluate('document.querySelectorAll(".home-create-card > p").length'),
				0,
				"Home needs actions, not a creation tutorial",
			);
			for (const kind of ["new-conversation", "new-session"]) {
				await page.click(`.home-create-card [data-action=${JSON.stringify(kind)}]`);
				await page.wait('document.querySelector("[data-creation-form]")');
				assert.equal(
					await page.evaluate(
						'document.querySelectorAll("[data-creation-form] .pocket-secondary, [data-creation-form] .creation-parent > p").length',
					),
					0,
				);
				assert.equal(
					await page.evaluate(
						'document.querySelector("input[name=cwd]").closest("label").textContent.trim()',
					),
					"Server Directory",
				);
				await page.click('[data-action="creation-model"]');
				await page.wait('document.querySelector("[data-pick-model]")');
				assert.equal(
					await page.evaluate(
						'document.querySelectorAll(".pocket-model-picker > p.pocket-secondary").length',
					),
					0,
				);
				await page.key("Escape");
				await page.wait('!document.querySelector("[data-pick-model]")');
				await page.click('[data-action="creation-directory"]');
				await page.wait(
					'document.querySelector(".pocket-directory-browser") && !document.querySelector("[data-directory-path]").disabled',
				);
				assert.equal(
					await page.evaluate(
						'document.querySelector(".pocket-directory-picker").closest("[role=dialog]").getAttribute("aria-label")',
					),
					"Server Directory",
				);
				assert.equal(
					await page.evaluate(
						'document.querySelectorAll(".pocket-directory-picker > .pocket-secondary").length',
					),
					0,
				);
				assert.equal(
					await page.evaluate(
						'document.querySelector(".pocket-directory-picker").textContent.includes("In This Browser")',
					),
					true,
				);
				await settleFrontend(page);
				await writeFile(join(captures, kind + "-directory.png"), await page.screenshot());
				await page.key("Escape");
				await page.wait('!document.querySelector("[data-directory-path]")');
				await page.key("Escape");
				await page.wait('!document.querySelector("[data-creation-form]")');
			}
			assert.equal(app.runtime.view().conversations.length, original);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
			assert.equal(m.f.requests.length, 0);
			await writeFile(join(captures, "home.png"), await page.screenshot());
		});
	},
);

// Catches hidden accounting information becoming permanent prose, or human chat being routed to inference after its rename.
test(
	"People Chat and concise settings: contextual accounting help stays accessible and attributed human messages consume no model attempts",
	{ timeout: 30000 },
	async () => {
		await inspect("copy-people", async (page, app, m) => {
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await conversationAction(page, "settings");
			await page.wait('document.querySelector("[data-session-budget]")');
			assert.equal(
				await page.evaluate('document.querySelectorAll(".settings-view .settings-sub").length'),
				0,
			);
			assert.equal(
				await page.evaluate('document.querySelector("[data-session-budget] details")?.open'),
				false,
				"accounting help is available but not constantly expanded",
			);
			await page.click("[data-session-budget] summary");
			assert.equal(await page.evaluate('document.querySelector("[data-session-budget] details").open'), true);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-session-budget] details").textContent')),
				/cancel|unconfirmed/i,
			);
			await page.key("Enter");
			assert.equal(
				await page.evaluate('document.querySelector("[data-session-budget] details").open'),
				false,
			);
			await writeFile(join(captures, "accounting-dark.png"), await page.screenshot());
			await openAppearance(page);
			await page.type('[aria-label="Theme"]', "");
			await page.key("ArrowDown");
			await page.type('[aria-label="Text size"]', "");
			for (let count = 0; count < 3; count++) await page.key("ArrowDown");
			await page.click(".back-to-app");
			for (const width of [360, 1440]) {
				await page.resize({ width, height: 900 });
				await settleFrontend(page);
				if (await page.evaluate('document.body.classList.contains("drawer-open")')) {
					await page.click('[aria-label="Close conversations"]', { offset: { x: 0.95, y: 0.5 } });
					await settleFrontend(page);
				}
				await conversationAction(page, "settings");
				await page.wait('document.querySelector("[data-session-budget] summary")');
				const help = (await page.evaluate(
					`(()=>{const view=document.querySelector(".settings-view"),summary=view.querySelector("[data-session-budget] summary"),r=summary.getBoundingClientRect();return {font:parseFloat(getComputedStyle(summary).fontSize),hit:r.height,inside:r.x>=0&&r.right<=innerWidth,overflow:view.scrollWidth>view.clientWidth+1,open:summary.parentElement.open}})()`,
				)) as { font: number; hit: number; inside: boolean; overflow: boolean; open: boolean };
				assert.ok(help.font > 14, JSON.stringify(help));
				assert.ok(help.hit >= 44);
				assert.equal(help.inside, true);
				assert.equal(help.overflow, false);
				assert.equal(help.open, false);
				await page.click("[data-session-budget] summary");
				await settleFrontend(page);
				await writeFile(join(captures, `accounting-light-20-${width}.png`), await page.screenshot());
				await writeFile(
					join(captures, `accounting-light-20-${width}.json`),
					JSON.stringify(help, null, 2) + "\n",
				);
				await page.click(".back-to-app");
			}
			await inputMode(page, "chat");
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").placeholder'),
				"Message People…",
				"human messages identify their real recipients",
			);
			assert.equal(
				await page.evaluate('document.querySelector(".native-mode-label").textContent'),
				"People Chat",
			);
			await page.type("textarea[name=message]", "PEOPLE-ONLY-COPY");
			await page.click("[data-action=send]");
			await page.wait(
				'document.querySelector(".pocket-collaboration")?.textContent.includes("PEOPLE-ONLY-COPY")',
			);
			assert.equal(
				await page.evaluate('document.querySelector(".pocket-collaboration h2").textContent'),
				"People Chat",
			);
			assert.deepEqual(
				await page.evaluate(
					'[...document.querySelectorAll(".pocket-collaboration h3")].map(e=>e.textContent)',
				),
				["Messages", "Shared Notes"],
			);
			assert.equal(
				await page.evaluate(
					'document.querySelectorAll(".pocket-collaboration .pocket-sheet-body > .pocket-secondary").length',
				),
				0,
			);
			assert.match(
				String(await page.evaluate('document.querySelector(".pocket-collaboration").textContent')),
				/Owner/,
			);
			assert.equal(m.f.requests.length, 0);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
			await writeFile(join(captures, "people-chat.png"), await page.screenshot());
			await page.key("Escape");
			await page.wait('!document.querySelector(".pocket-collaboration")');
			await page.resize({ width: 360, height: 600 });
			await settleFrontend(page);
			const mode = (await page.evaluate(
				`(()=>{const label=document.querySelector(".native-mode-label").getBoundingClientRect(),button=document.querySelector(".native-mode-label").closest(".toolbar-left").getBoundingClientRect(),box=r=>({x:r.x,y:r.y,right:r.right,width:r.width,height:r.height});return {label:box(label),button:box(button),viewport:innerWidth,scroll:document.documentElement.scrollWidth,inside:label.x>=button.x&&label.right<=button.right&&button.x>=0&&button.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth}})()`,
			)) as { inside: boolean };
			await writeFile(join(captures, "people-chat-mobile-20.json"), JSON.stringify(mode, null, 2) + "\n");
			await writeFile(join(captures, "people-chat-mobile-20.png"), await page.screenshot());
			assert.equal(
				mode.inside,
				true,
				"the complete human-mode name remains visible at phone/20px size: " + JSON.stringify(mode),
			);
		});
	},
);

// Disabling a UI changes its availability, not already admitted native work.
test(
	"Interface disable: confirmed feedback accompanies actual UI removal while the same pending native input completes",
	{ timeout: 30000 },
	async () => {
		let release: (() => void) | undefined;
		const work = new Promise<void>((resolve) => {
			release = resolve;
		});
		await inspect(
			"copy-disable",
			async (page, app, m) => {
				try {
					await page.click("[data-conversation]");
					await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
					await page.type("textarea[name=message]", "WORK-THROUGH-UI-DISABLE");
					await page.click("[data-action=send]");
					await page.wait('document.querySelector("[data-action=stop]")');
					await openExtensionManager(page);
					await page.wait(
						'document.querySelector(".pocket-extension-registration .extension-phase")?.textContent==="ready"',
					);
					assert.equal(
						await page.evaluate('document.querySelectorAll(".settings-view .settings-sub").length'),
						0,
					);
					await page.click(".pocket-extension-registration .extension-actions button");
					await page.wait(
						'document.querySelector("[role=alert]")?.textContent.includes("Interface disabled. Running work continues.")',
					);
					await page.wait('document.querySelector(".extension-phase")?.textContent==="disabled"');
					await page.click(".back-to-app");
					assert.equal(await page.evaluate('Boolean(document.querySelector("[data-action=stop]"))'), true);
					assert.equal(m.f.requests.length, 1);
					assert.equal(app.runtime.view().budget.primaryAttempts, 1);
					release?.();
					await page.wait('document.querySelector("main").textContent.includes("SURVIVED-UI-DISABLE")');
					assert.equal(m.f.requests.length, 1);
				} finally {
					release?.();
				}
			},
			async () => {
				await work;
				return { text: "SURVIVED-UI-DISABLE" };
			},
		);
	},
);
