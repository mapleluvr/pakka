import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketSchedules } from "../../server/src/pocket-schedules.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceSchedulesExtensionRoot, workspaceSchedulesService } from "../src/workflows.ts";
import { ownedBrowser } from "./browser.ts";
import { toggleConversations } from "./frontend-controls.ts";

test(
	"Pocket automation panel: actual human schedules native work, leaving the interface keeps it alive, a viewer is read-only and cancel fences delivery",
	{ timeout: 30000 },
	async (t) => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			const prepared = createPocketSchedules({ namespace: "browser.schedules", maxSchedules: 16 });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "scheduled-product"), jobs: [prepared.definition] },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				extensions: [{ root: workspaceSchedulesExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => ({
					schedules: await workspaceSchedulesService(context, prepared),
				}),
			});
			assert.ok(app.initialOwner);
			const target = app.runtime.view().conversations.at(-1)!;
			const admin = await app.people.authenticate(app.initialOwner.token),
				invite = await app.people.invite(admin, {
					requestId: "viewer",
					role: "viewer",
					resources: [target.conversationId],
					ttlMs: 60000,
				});
			assert.ok(invite.token);
			const session = await app.people.redeem(invite.token, "Viewer");
			browser = await ownedBrowser(join(m.f.root, "schedule-inspection"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token),
				viewer = await browser.page(app.http.origin + "/#signin=" + session.token, {
					width: 390,
					height: 844,
				});
			for (const page of [owner, viewer]) {
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				if (page === viewer) await toggleConversations(page);
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-interface=workspace-schedules-schedules]")');
			}
			await owner.click("[data-interface=workspace-schedules-schedules]");
			await owner.wait('document.querySelector("[data-schedule-text]")');
			await owner.type("[data-schedule-text]", "ACTUAL-SCHEDULED-BROWSER-WORK");
			await owner.evaluate('document.querySelector("[data-schedule-delay]").value=""');
			await owner.type("[data-schedule-delay]", "2");
			assert.equal(await owner.evaluate('document.querySelector("[data-schedule-delay]").value'), "2");
			await owner.click("[data-schedule-add]");
			await owner.wait('document.querySelector("[data-schedule-state]")');
			assert.equal(m.f.requests.length, 0);
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("textarea[name=message]")');
			await t.waitFor(() => assert.equal(m.f.requests.length, 1), { timeout: 5000 });
			assert.ok(JSON.stringify(m.f.requests[0]).includes("ACTUAL-SCHEDULED-BROWSER-WORK"));
			await owner.click("[data-interface=workspace-schedules-schedules]");
			await owner.wait('document.querySelector("[data-schedule-state]")?.textContent.includes("done")');
			await toggleConversations(viewer);
			await viewer.click("[data-interface=workspace-schedules-schedules]");
			await viewer.wait('document.querySelector("[data-schedule-state]")');
			assert.equal(
				await viewer.evaluate(
					'document.querySelectorAll("[data-schedule-add],[data-schedule-cancel]").length',
				),
				0,
			);
			await owner.type("[data-schedule-text]", "NEVER-AFTER-CANCEL");
			await owner.evaluate('document.querySelector("[data-schedule-delay]").value=""');
			await owner.type("[data-schedule-delay]", "60");
			await owner.click("[data-schedule-add]");
			await owner.wait('document.querySelector("[data-schedule-cancel]")?.disabled===false');
			await owner.click("[data-schedule-cancel]");
			await owner.wait(
				'[...document.querySelectorAll("[data-schedule-state]")].some(node=>node.textContent.includes("cancelled"))',
			);
			assert.equal(m.f.requests.length, 1);
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			await viewer.wait('document.querySelectorAll("[data-schedule]").length===2');
			assert.equal(
				await viewer.evaluate('getComputedStyle(document.querySelector(".schedule-row")).borderTopStyle'),
				"solid",
				"the declared public stylesheet is actually mounted",
			);
			assert.equal(
				await viewer.evaluate(
					'(()=>{const e=document.querySelector("[data-workspace-schedules]");return e.getBoundingClientRect().right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1;})()',
				),
				true,
				"the mobile contribution is not horizontally clipped",
			);
			for (const page of [owner, viewer])
				await page.wait(
					'(async()=>{await document.fonts.ready;return document.getAnimations().every(animation=>animation.playState!=="running");})()',
				);
			for (const page of [owner, viewer])
				await page.evaluate(
					'(()=>{for(let node=document.querySelector("[data-workspace-schedules]");node;node=node.parentElement)node.scrollTop=0;})()',
				);
			const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "schedules-screenshots");
			await mkdir(output, { recursive: true });
			await writeFile(join(output, "desktop.png"), await owner.screenshot());
			await writeFile(join(output, "mobile.png"), await viewer.screenshot());
			t.diagnostic(output);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
