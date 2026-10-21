import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPocketSchedules } from "@pakka/server/pocket";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, toggleConversations, openAppearance } from "./frontend-controls.ts";
import {
	workspaceFilesExtensionRoot,
	workspaceFilesService,
	workspaceSchedulesExtensionRoot,
	workspaceSchedulesService,
} from "../src/workflows.ts";

// Extensions use the reference palette rather than an expanding legacy rail.
// A short screen must still reach sessions, settings and actual extension UI.
test(
	"Pocket short sidebar: sessions remain usable and extensions stay reachable through the palette",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture(
			{},
			{ maxConversations: 32, maxPrimaryAttempts: 32, maxAuxiliaryAttempts: 8 },
		);
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			const schedules = createPocketSchedules({ namespace: "short.schedules", maxSchedules: 16 });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "web"), jobs: [schedules.definition] },
				owner: "Owner",
				initial: Array.from({ length: 12 }, (_, index) => ({
					name: "Conversation " + (index + 1),
					profile: "default",
				})),
				extensions: [
					{ root: workspaceFilesExtensionRoot },
					{ root: workspaceSchedulesExtensionRoot },
					{ root: resolve("apps/webui/examples/hello") },
					{ root: resolve("apps/webui/examples/preferences") },
				],
				extensionServices: async (context) => ({
					files: await workspaceFilesService(context, {
						namespace: "short.files",
						roots: [{ id: "project", path: m.f.cwd, resources: "*", writable: true, git: false }],
					}),
					schedules: await workspaceSchedulesService(context, schedules),
				}),
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token, {
				width: 360,
				height: 600,
			});
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelectorAll("[data-conversation]").length===12');
			await toggleConversations(page);
			assert.equal(
				await page.evaluate(
					`(()=>{const n=document.querySelector(".session-list");return n.clientHeight>=100&&n.scrollHeight>n.clientHeight&&document.documentElement.scrollWidth<=innerWidth;})()`,
				),
				true,
				"Sessions retain their own usable scroll region",
			);
			assert.equal(
				await page.evaluate(
					`(()=>{const n=document.querySelector('[data-action="appearance"]'),r=n.getBoundingClientRect();return r.bottom<=innerHeight&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,
				),
				true,
				"Settings remains visible and hit-testable",
			);
			await page.click("[data-conversation]:last-child");
			await page.wait('document.querySelector(".pocket-status")?.textContent==="Ready"');
			await settleFrontend(page);
			await toggleConversations(page);
			await page.click("[data-action=commands]");
			await page.wait('document.querySelector(".palette [data-interface=preferences-settings]")');
			for (const id of [
				"workspace-files-files",
				"workspace-schedules-schedules",
				"hello-home",
				"preferences-settings",
			])
				assert.equal(
					await page.evaluate(`Boolean(document.querySelector('.palette [data-interface="${id}"]'))`),
					true,
				);
			await page.click(".palette [data-interface=preferences-settings]");
			await page.wait('document.querySelector("input[name=exampleLabel]")');
			await settleFrontend(page);
			await page.click('[aria-label="Close Example preferences"]');
			await settleFrontend(page);
			await toggleConversations(page);
			await page.click("[data-conversation]:last-child");
			await page.wait('document.querySelector(".pocket-status")?.textContent==="Ready"');
			await settleFrontend(page);
			await page.type("textarea[name=message]", "KEEP-SIDEBAR-DRAFT");
			await toggleConversations(page);
			await page.click('[aria-label="Close conversations"]', { offset: { x: 0.95, y: 0.5 } });
			await settleFrontend(page);
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"KEEP-SIDEBAR-DRAFT",
			);
			await openAppearance(page);
			await page.wait(`document.querySelector('[aria-label="Text size"]')`);
			await page.evaluate(
				`(()=>{const n=document.querySelector('[aria-label="Text size"]');n.value='24';n.dispatchEvent(new Event('change',{bubbles:true}));})()`,
			);
			await page.click('[aria-label="Close appearance"]');
			await settleFrontend(page);
			if (!(await page.evaluate('document.body.classList.contains("drawer-open")')))
				await toggleConversations(page);
			assert.equal(await page.evaluate("getComputedStyle(document.body).fontSize"), "24px");
			assert.equal(
				await page.evaluate(
					`(()=>{const n=document.querySelector('[data-action="appearance"]'),r=n.getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&r.bottom<=innerHeight&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,
				),
				true,
			);
			const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "short-sidebar");
			await mkdir(evidence, { recursive: true });
			await writeFile(join(evidence, "short-phone-large-text.png"), await page.screenshot());
			assert.equal(m.f.requests.length, 0);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
