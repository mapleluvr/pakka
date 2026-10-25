import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { conversationAction, toggleConversations, newConversation } from "./frontend-controls.ts";

// Real UI choices must independently reach the provider/current cwd, preserve drafts, and survive page reload.
test(
	"Conversation configuration browser: configured models need no preset grant and remain independent of title-only directories on 3:5 mobile",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		const child = join(m.f.cwd, "child"),
			other = join(m.f.root, "other");
		await mkdir(child);
		await mkdir(other);
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: {
					...m.config,
					dataDir: join(m.f.root, "product"),
					profiles: [
						{ id: "alternate", model: "alternate-model", cwd: other, systemPrompt: "MUST-NOT-APPLY" },
					],
				},
				owner: "Owner",
				// The alternate model is available without granting its full Agent preset.
				profiles: ["default"],
				initial: [{ name: "Independent", profile: "default" }],
			});
			browser = await ownedBrowser(join(m.f.root, "independent-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner!.token, {
				width: 360,
				height: 600,
			});
			await page.wait('document.querySelector("[data-action=signin]")');
			assert.equal(
				await page.evaluate("innerWidth === 360 && document.documentElement.scrollWidth <= 360"),
				true,
				"Sign-in must fit a 360px viewport without changing pointer coordinates",
			);
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await toggleConversations(page);
			await page.wait(
				'document.querySelector(".sidebar").getAnimations().every(a=>a.playState==="finished"||a.playState==="idle")',
			);
			await page.click("[data-conversation]");
			await page.wait(
				'document.querySelector("[data-action=cwd]")?.textContent.includes(' + JSON.stringify(m.f.cwd) + ")",
			);
			await page.type("textarea[name=message]", "DRAFT-KEEP");
			await conversationAction(page, "settings");
			await page.wait('document.querySelector("[data-cost]")');
			assert.equal(
				await page.evaluate(
					'Boolean(document.querySelector("[data-model-choice],[data-save-configuration],[data-action=cwd] [role=combobox]"))',
				),
				false,
			);
			assert.equal(
				await page.evaluate(
					`document.querySelector('[aria-label="Conversation Settings"]').textContent.includes("Working directory")`,
				),
				false,
			);
			await page.click('[aria-label="Close settings"]');
			await page.evaluate('document.documentElement.style.fontSize="24px"');
			await page.click("[data-action=cwd]");
			await page.wait('document.querySelector("[data-directory-path]")');
			await page.wait(
				`Array.from(document.querySelectorAll('[data-directory]')).some(node=>node.dataset.directory===${JSON.stringify(child)})`,
			);
			await page.click("[data-directory=" + JSON.stringify(child) + "]");
			await page.wait('document.querySelector("[data-directory-path]")?.value===' + JSON.stringify(child));
			await page.click("[data-favorite-directory]");
			await page.wait(
				'document.querySelector("[data-favorite-directory]")?.getAttribute("aria-pressed")==="true"',
			);
			const shots = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "independent-configuration");
			await mkdir(shots, { recursive: true });
			await writeFile(join(shots, "directory-360x600-24px.png"), await page.screenshot());
			await writeFile(
				join(shots, "directory-geometry.json"),
				JSON.stringify(
					await page.evaluate(
						`(()=>{const r=document.querySelector("[data-use-directory]").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,viewport:{width:innerWidth,height:innerHeight},scroll:document.documentElement.scrollWidth};})()`,
					),
					null,
					2,
				),
			);
			assert.equal(
				await page.evaluate(
					'(()=>{const r=document.querySelector("[data-use-directory]").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth})()',
				),
				true,
				"Directory confirmation remains visible at 360×600 with 24px text",
			);
			await page.click("[data-use-directory]");
			await page.wait(
				'!document.querySelector("[data-use-directory]")&&document.querySelector("[data-action=cwd]")?.textContent.includes(' +
					JSON.stringify(child) +
					")",
			);
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"DRAFT-KEEP",
			);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-action=model]").textContent')),
				/local-model/,
			);
			await page.click("[data-action=model]");
			await page.wait('document.querySelector("[data-pick-model=alternate-model]")');
			await writeFile(join(shots, "model-360x600-24px.png"), await page.screenshot());
			await page.click("[data-pick-model=alternate-model]");
			await page.wait(
				'!document.querySelector("[data-pick-model]")&&document.querySelector("[data-action=model]")?.textContent.includes("alternate-model")',
			);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-action=cwd]").textContent')),
				/child/,
			);
			assert.equal(m.f.requests.length, 0);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
			await page.click("[data-action=cwd]");
			await page.wait(`document.querySelector('[aria-label="Favorite directories"]')`);
			assert.match(
				String(
					await page.evaluate(`document.querySelector('[aria-label="Favorite directories"]').textContent`),
				),
				/child/,
			);
			await page.click('[aria-label="Close directory picker"]');
			await page.click("[data-action=send]");
			await page.wait('document.querySelector("main").textContent.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests[0]?.model, "alternate-model");
			assert.doesNotMatch(JSON.stringify(m.f.requests[0]), /MUST-NOT-APPLY/);
			await toggleConversations(page);
			await page.wait(
				'document.querySelector(".sidebar").getAnimations().every(a=>a.playState==="finished"||a.playState==="idle")',
			);
			await newConversation(page, "Inherited");
			await page.wait(
				'document.querySelector(".pocket-title")?.textContent.includes("Inherited")&&document.querySelector("[data-action=model]")?.textContent.includes("alternate-model")',
			);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-action=cwd]").textContent')),
				/child/,
			);
			const reload = await page.evaluate(
				'(()=>{const ref=document.querySelector("[data-conversation][aria-current=true]").dataset.conversation;return location.origin+"/#conversation="+encodeURIComponent(ref)})()',
			);
			await page.navigate(String(reload));
			await page.wait(
				'document.querySelector("[data-action=model]")?.textContent.includes("alternate-model")',
			);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-action=cwd]").textContent')),
				/child/,
			);
			assert.equal(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
