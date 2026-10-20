import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// A tiling/theme regression, a dead demo composer, or losing native input during
// the shell migration must fail at the served product boundary, not a prototype.
test(
	"Devin-like shell: real home creation, native input and responsive navigation",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture({ profiles: [{ id: "alternate", model: "alternate-model" }] });
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "devin-shell");
		try {
			await mkdir(evidence, { recursive: true });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "shell") },
				owner: "Owner",
				profiles: ["default", "alternate"],
				initial: [{ name: "Existing project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.wait(
				'[...document.querySelectorAll("link[rel=stylesheet]")].every(e=>e.sheet) && document.fonts.status === "loaded"',
			);
			await writeFile(join(evidence, "baseline-or-home-desktop.png"), await page.screenshot());
			const shell = (await page.evaluate(
				`(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};return {sidebar:box('#pocket-sidebar'),main:box('main.pane'),bg:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
			)) as {
				sidebar: { x: number; y: number; w: number; h: number };
				main: { x: number; y: number; w: number; h: number };
				bg: string;
				font: string;
				overflow: boolean;
			};
			assert.deepEqual(
				shell.sidebar,
				{ x: 0, y: 0, w: 300, h: 900 },
				"flat full-height 300px rail, no desktop tiling gaps",
			);
			assert.equal(shell.main.x, 300);
			assert.equal(shell.bg, "rgb(20, 20, 20)");
			assert.match(shell.font, /Inter/);
			assert.equal(shell.overflow, false);
			await page.click('[data-action="collapse-sidebar"]');
			assert.equal(await page.evaluate('document.querySelector("main.pane").getBoundingClientRect().x'), 0);
			await page.click('[data-action="expand-sidebar"]');
			// After sign-in focus can be on body, outside the app root. Shortcuts must still work.
			await page.evaluate(
				'document.body.dispatchEvent(new KeyboardEvent("keydown", {key:"k", ctrlKey:true, bubbles:true}))',
			);
			await page.wait('document.querySelector("[role=dialog]")');
			assert.equal(
				await page.evaluate('document.activeElement.getAttribute("aria-label")'),
				"Search conversations",
				"search must be ready for typing",
			);
			await page.key("Escape");
			await page.click('[data-action="search-conversations"]');
			await page.wait('document.querySelector("[role=dialog]")');
			await page.type('[aria-label="Search conversations"]', "Existing");
			await page.click("[data-search-conversation]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			assert.match(
				String(await page.evaluate('document.querySelector(".pocket-title").textContent')),
				/Existing project/,
			);
			await page.click('[data-action="model"]');
			await page.wait('document.querySelector("[data-pick-model=alternate-model]")');
			await page.click('[data-pick-model="alternate-model"]');
			await page.wait(
				'document.querySelector("[data-action=model]")?.textContent.includes("alternate-model") && !document.querySelector("[role=dialog]")',
			);
			await page.click('[data-action="home"]');
			await page.wait('document.querySelector("[data-home-create]")');
			await page.type('[aria-label="Conversation name"]', "Real new work");
			await page.click("[data-home-create]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			assert.match(
				String(await page.evaluate('document.querySelector(".pocket-title").textContent')),
				/Real new work/,
			);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-action=model]").textContent')),
				/alternate-model/,
				"home creation inherits the last selected Conversation configuration",
			);
			assert.equal(m.f.requests.length, 0, "creating or searching must not infer a model request");
			await page.type("textarea[name=message]", "SHELL-NATIVE-INPUT");
			await page.click('[data-action="send"]');
			await page.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.requests[0]?.model, "alternate-model");
			assert.ok(JSON.stringify(m.f.requests[0]!.messages).includes("SHELL-NATIVE-INPUT"));
			await writeFile(join(evidence, "conversation-desktop.png"), await page.screenshot());
			for (const size of [
				{ width: 390, height: 844 },
				{ width: 360, height: 600 },
			]) {
				await page.resize(size);
				await page.click('[aria-label="Toggle conversations"]');
				await page.click('[data-action="home"]');
				const home = (await page.evaluate(
					`(()=>{const e=document.querySelector('.pocket-home-card').getBoundingClientRect();return {w:e.width,x:e.x,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
				)) as { w: number; x: number; overflow: boolean };
				assert.equal(home.x, 22);
				assert.equal(home.w, size.width - 44);
				assert.equal(home.overflow, false);
				await page.click('[data-action="commands"]');
				await page.wait('document.querySelector("[role=dialog]")?.contains(document.activeElement)');
				await page.key("Escape");
				await page.wait('!document.querySelector("[role=dialog]")');
				await page.click('[data-action="people"]');
				await page.wait('document.querySelector("[role=dialog]")?.contains(document.activeElement)');
				await page.key("Escape");
				await page.wait('!document.querySelector("[role=dialog]")');
				await writeFile(join(evidence, `home-${size.width}x${size.height}.png`), await page.screenshot());
				await page.click('[aria-label="Toggle conversations"]');
				await page.key("Escape");
				assert.equal(
					await page.evaluate('document.activeElement.getAttribute("aria-label")'),
					"Toggle conversations",
				);
			}
			await page.resize({ width: 1440, height: 900 });
			await page.click('[data-action="appearance"]');
			await page.wait('document.querySelector("[aria-label=Theme]")');
			await page.evaluate(
				'(()=>{const e=document.querySelector("[aria-label=Theme]");e.value="light";e.dispatchEvent(new Event("change",{bubbles:true}));})()',
			);
			await page.click('[aria-label="Close appearance"]');
			assert.equal(
				await page.evaluate("getComputedStyle(document.body).backgroundColor"),
				"rgb(252, 252, 252)",
			);
			await writeFile(join(evidence, "home-desktop-light.png"), await page.screenshot());
			await page.click('[data-action="search-conversations"]');
			await page.wait('document.querySelector("[role=dialog]")');
			await writeFile(join(evidence, "search-desktop-light.png"), await page.screenshot());
			await page.key("Escape");
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.errors.length, 0);
			await writeFile(join(evidence, "shell.json"), JSON.stringify(shell, null, 2));
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
