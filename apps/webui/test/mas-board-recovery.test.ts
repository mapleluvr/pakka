import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join, resolve } from "node:path";
import { createMas } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { masWorkbenchService } from "../../../packages/mas-devpack/src/backend.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"MAS controls preserve a lost-response operation across panel reopen and reconcile without resending",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "board-recovery") },
				owner: "Owner",
				initial: [{ name: "Ordinary work", profile: "default" }],
				extensions: [{ root: resolve("packages/mas-devpack/dist") }],
				extensionServices: async (context) => {
					const mas = await createMas({
						runtime: context.runtime,
						namespace: "board.recovery",
						maxDeliveries: 8,
						maxPending: 4,
					});
					await mas.bootstrap([{ key: "agent", owner: context.ownerId }]);
					await mas.activate();
					return { mas: masWorkbenchService({ ...context, mas }) };
				},
			});
			browser = await ownedBrowser(join(m.f.root, "browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner!.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-interface=mas-devpack-board]")');
			await page.click("[data-interface=mas-devpack-board]");
			await page.wait('document.querySelector("[data-member=agent]")');
			await page.wait('[...document.querySelectorAll("link[rel=stylesheet]")].every((link) => link.sheet)');
			await page.evaluate("document.fonts.ready.then(() => true)");
			await page.wait(
				'document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).every((animation) => animation.playState !== "running")',
			);
			await page.click("[data-member=agent]");
			await page.wait('document.querySelector("[data-agent-details]")');
			await page.click("[data-agent-details]");
			await page.click("[data-agent-controls=agent]");
			await page.wait('document.querySelector("textarea[name=masMessage]")');
			await page.type("textarea[name=masMessage]", "ONE-ADMITTED-INPUT");
			await page.evaluate(
				`(()=>{const original=window.fetch;let dropped=false;window.fetch=async(...args)=>{const response=await original(...args);if(!dropped&&String(args[0]).includes('/pocket/extensions/rpc')){const request=JSON.parse(args[1].body);if(request.command?.call?.action==='send'){dropped=true;throw new TypeError('TEST: response lost after server admission');}}return response;};})()`,
			);
			await page.click("[data-mas-send]");
			await page.wait(
				'document.querySelector("[data-mas-pending]") && document.querySelector("[data-mas-reconcile]") && !document.querySelector("[data-mas-reconcile]").disabled',
			);
			assert.equal(await page.evaluate('document.querySelector("[data-mas-send]").disabled'), true);
			await page.click('[aria-label="Close Agent controls"]');
			await page.wait(
				'!document.querySelector("textarea[name=masMessage]") && document.activeElement?.getAttribute("data-agent-controls") === "agent"',
			);
			await page.click("[data-agent-controls=agent]");
			await page.wait('document.querySelector("[data-mas-pending]")');
			assert.equal(await page.evaluate('document.querySelector("[data-mas-send]").disabled'), true);
			await page.click("[data-mas-reconcile]");
			await page.wait(
				'!document.querySelector("[data-mas-pending]") && document.querySelector("[data-mas-receipt]")',
			);
			assert.equal(m.f.requests.length, 1, "Original-operation lookup never re-enters send admission");
			assert.deepEqual(m.f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
