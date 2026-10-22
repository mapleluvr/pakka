import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createMas } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { masWorkbenchService } from "../../../packages/mas-devpack/src/backend.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"MAS frontend adoption: one workspace header, Graph/Activity/Agents and contextual inspector",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let team: Awaited<ReturnType<typeof createMas>> | undefined;
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "mas-devin-adoption");
		try {
			await mkdir(evidence, { recursive: true });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "adopted-team") },
				owner: "Owner",
				profiles: ["default"],
				extensions: [{ root: resolve("packages/mas-devpack/dist") }],
				extensionServices: async (context) => {
					const mas = await createMas({
						runtime: context.runtime,
						namespace: "adopted.team",
						maxDeliveries: 16,
						maxPending: 8,
					});
					team = mas;
					await mas.bootstrap([
						{ key: "coordinator", owner: context.ownerId, profile: "default" },
						{ key: "reviewer", owner: context.ownerId, profile: "default" },
					]);
					await mas.activate();
					return { mas: masWorkbenchService({ ...context, mas }) };
				},
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-interface=mas-devpack-board]")');
			await page.click("[data-interface=mas-devpack-board]");
			await page.wait('document.querySelector("[data-member=coordinator]")');
			await page.wait('[...document.querySelectorAll("link[rel=stylesheet]")].every(e=>e.sheet)');
			await writeFile(join(evidence, "team-desktop.png"), await page.screenshot());
			assert.deepEqual(
				await page.evaluate(
					'[...document.querySelectorAll(".board-head .board-tabs button")].map(e=>e.textContent)',
				),
				["Graph", "Activity", "Agents"],
				"one reference-style segmented navigation; no nested Graph/Log and Canvas/List bars",
			);
			assert.equal(
				await page.evaluate('document.querySelectorAll(".pocket-extension-surface > header").length'),
				0,
				"the host must not duplicate the page-owned Team header",
			);
			await page.click("[data-board-options]");
			await page.click("[data-member=coordinator]");
			assert.equal(
				await page.evaluate('document.querySelector(".graph-view-options").open'),
				false,
				"view options close on an outside selection",
			);
			await page.wait('document.querySelector("[data-open-conversation=coordinator]")');
			assert.deepEqual(
				await page.evaluate(
					'(()=>{const e=document.querySelector(".graph-selection"),r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {w:r.width,right:r.right===p.right,top:r.top===p.top}})()',
				),
				{ w: 320, right: true, top: true },
			);
			assert.deepEqual(
				await page.evaluate(
					'(()=>{const e=document.querySelector("[data-agent=coordinator]"),r=e.getBoundingClientRect();return {w:r.width,radius:getComputedStyle(e).borderRadius}})()',
				),
				{ w: 224, radius: "12px" },
			);
			await writeFile(join(evidence, "team-selection.png"), await page.screenshot());
			assert.equal(m.f.requests.length, 0);
			await page.click("[data-agent-details]");
			await page.click("[data-agent-controls=coordinator]");
			await page.wait('document.querySelector("textarea[name=masMessage]")');
			assert.equal(
				await page.evaluate('document.querySelectorAll(".mas-member .composer-card.compact").length'),
				1,
				"member input uses the same compact composer anatomy, not the old form",
			);
			assert.equal(await page.evaluate('document.querySelectorAll(".mas-member select").length'), 0);
			await page.click('[aria-label="Member input mode"]');
			await page.click("[data-mas-mode=steer]");
			await page.click('[aria-label="Member input mode"]');
			await page.click("[data-mas-mode=prompt]");
			await page.click("[data-member-management]");
			await page.click("[data-mas-retire]");
			await page.wait('document.querySelector("[data-mas-confirm-retire]")');
			assert.ok(team);
			assert.equal(
				(await team.view()).members.find((member) => member.key === "coordinator")?.phase,
				"active",
				"opening retirement confirmation does not mutate membership",
			);
			await page.click("[data-mas-cancel-retire]");
			await writeFile(join(evidence, "member-controls.png"), await page.screenshot());
			await page.click('[aria-label="Close Agent controls"]');
			await page.wait('!document.querySelector("textarea[name=masMessage]")');
			assert.equal(m.f.requests.length, 0);
			await page.click("[data-open-conversation=coordinator]");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			await page.type("textarea[name=message]", "TEAM-NEW-FRONTEND-INPUT");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".message-list")?.innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			await page.click("[data-return-extension]");
			await page.wait('document.querySelector("[data-member=coordinator][aria-pressed=true]")');
			await page.click("[data-board-mode=list]");
			await page.wait('document.querySelector(".graph-agent-list")');
			await page.click("[data-board-tab=history]");
			await page.wait('document.querySelector(".graph-history")');
			await page.click("[data-board-mode=canvas]");
			await page.wait('document.querySelector(".graph-canvas")');
			await page.resize({ width: 390, height: 844 });
			await page.wait('document.querySelector(".sidebar").getBoundingClientRect().right < 0');
			assert.equal(await page.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
			await writeFile(join(evidence, "team-mobile.png"), await page.screenshot());
			assert.equal(m.f.requests.length, 1, "view navigation never submits or replays work");
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
