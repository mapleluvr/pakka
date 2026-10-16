import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketSchedules } from "../../server/src/pocket-schedules.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceSchedulesExtensionRoot, workspaceSchedulesService } from "../src/workflows.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"Pocket schedule panel recovery: losing an admitted response survives interface replacement and read-only reconciliation never schedules twice",
	{ timeout: 25000 },
	async (t) => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			const prepared = createPocketSchedules({ namespace: "recovery.schedules", maxSchedules: 8 });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "schedule-recovery"), jobs: [prepared.definition] },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				extensions: [{ root: workspaceSchedulesExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => ({
					schedules: await workspaceSchedulesService(context, prepared),
				}),
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "schedule-recovery-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-interface=workspace-schedules-schedules]")');
			await page.click("[data-interface=workspace-schedules-schedules]");
			await page.wait('document.querySelector("[data-schedule-add]")');
			await page.type("[data-schedule-text]", "ONCE-AFTER-LOST-SCHEDULE-RESPONSE");
			await page.evaluate('document.querySelector("[data-schedule-delay]").value=""');
			await page.type("[data-schedule-delay]", "2");
			await page.evaluate(
				`(()=>{const original=globalThis.fetch;globalThis.__scheduleAdds=0;globalThis.__restoreScheduleFetch=()=>{globalThis.fetch=original;};globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&args[1].body.includes('"action":"add"')){globalThis.__scheduleAdds++;const response=await original(...args);await response.arrayBuffer();throw Error('TEST LOST COMMITTED SCHEDULE RESPONSE');}return original(...args);};})()`,
			);
			await page.click("[data-schedule-add]");
			await page.wait('document.querySelector("[data-schedule-reconcile]")?.disabled===false');
			assert.equal(await page.evaluate('document.querySelector("[data-schedule-add]").disabled'), true);
			await page.evaluate("globalThis.__restoreScheduleFetch()");
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("textarea[name=message]")');
			await page.click("[data-interface=workspace-schedules-schedules]");
			await page.wait('document.querySelector("[data-schedule-reconcile]")?.disabled===false');
			await page.click("[data-schedule-reconcile]");
			await page.wait('!document.querySelector("[data-schedule-reconcile]")');
			assert.equal(await page.evaluate("globalThis.__scheduleAdds"), 1);
			await t.waitFor(() => assert.equal(m.f.requests.length, 1), { timeout: 5000 });
			await page.wait('document.querySelector("[data-schedule-state]")?.textContent.includes("done")');
			assert.equal(await page.evaluate('document.querySelectorAll("[data-schedule]").length'), 1);
			assert.ok(JSON.stringify(m.f.requests[0]).includes("ONCE-AFTER-LOST-SCHEDULE-RESPONSE"));
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
