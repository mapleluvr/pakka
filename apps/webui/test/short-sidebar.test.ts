import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPocketSchedules } from "@pakka/server/pocket";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import {
	workspaceFilesExtensionRoot,
	workspaceFilesService,
	workspaceSchedulesExtensionRoot,
	workspaceSchedulesService,
} from "../src/workflows.ts";

// Unbounded tool navigation must not consume the conversation list on a short phone screen.
test(
	"Pocket short sidebar: built-in tools and extensions scroll independently while conversations remain usable",
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
			await page.wait('[...document.querySelectorAll("link[rel=stylesheet]")].every(e=>e.sheet)');
			await page.click('[aria-label="Toggle conversations"]');
			await page.click("[data-conversation]");
			await page.wait(
				'document.querySelector("[data-interface=workspace-schedules-schedules]") && document.querySelector("[data-interface=preferences-settings]")',
			);
			await page.click('[aria-label="Toggle conversations"]');
			await page.wait('document.querySelector(".sidebar").getAnimations().every(a=>a.playState!=="running")');
			const sizes = (await page.evaluate(
				`(()=>{const tools=document.querySelector('[aria-label="Tools and extensions"]'),conversations=document.querySelector('[aria-label="Conversations"]');return tools?{toolsHeight:tools.clientHeight,toolsScroll:tools.scrollHeight,conversationHeight:conversations.clientHeight,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}:null;})()`,
			)) as null | {
				toolsHeight: number;
				toolsScroll: number;
				conversationHeight: number;
				viewport: number;
				overflow: boolean;
			};
			assert.ok(sizes, "Navigation tools need their own bounded scrolling region");
			assert.ok(sizes.toolsHeight <= sizes.viewport * 0.36, JSON.stringify(sizes));
			assert.ok(
				sizes.toolsScroll > sizes.toolsHeight,
				"Tools should scroll rather than shrink the conversation list",
			);
			assert.ok(sizes.conversationHeight >= 100, JSON.stringify(sizes));
			assert.equal(sizes.overflow, false);
			assert.equal(
				await page.evaluate(
					'document.querySelector("[data-interface=workspace-files-files]").closest("nav").getAttribute("aria-label")',
				),
				"WebUI",
			);
			assert.equal(
				await page.evaluate(
					'document.querySelector("[data-interface=workspace-schedules-schedules]").closest("nav").getAttribute("aria-label")',
				),
				"WebUI",
			);
			assert.equal(
				await page.evaluate(
					'document.querySelector("[data-interface=hello-home]").closest("nav").getAttribute("aria-label")',
				),
				"Extensions",
			);
			const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "short-sidebar");
			await mkdir(evidence, { recursive: true });
			await writeFile(join(evidence, "short-phone.png"), await page.screenshot());
			await page.click("[data-interface=preferences-settings]");
			await page.wait('document.querySelector("input[name=exampleLabel]")');
			await page.click('[aria-label="Close Example preferences"]');
			await page.click('[aria-label="Toggle conversations"]');
			await page.click("[data-conversation]:last-child");
			await page.wait('document.querySelector(".pocket-status")?.textContent==="Ready"');
			await page.type("textarea[name=message]", "KEEP-SIDEBAR-DRAFT");
			await page.click('[aria-label="Toggle conversations"]');
			await page.click('[aria-label="Close conversations"]');
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"KEEP-SIDEBAR-DRAFT",
			);
			await page.click('[aria-label="Toggle conversations"]');
			await page.click('[data-action="appearance"]');
			await page.wait("document.querySelector('[aria-label=\"Text size\"]')");
			await page.evaluate(
				`(()=>{const size=document.querySelector('[aria-label="Text size"]');size.value='24';size.dispatchEvent(new Event('change',{bubbles:true}));})()`,
			);
			await page.click('[aria-label="Close appearance"]');
			await page.click('[aria-label="Toggle conversations"]');
			const large = (await page.evaluate(
				`(()=>{const tools=document.querySelector('[aria-label="Tools and extensions"]'),sidebar=document.querySelector('.sidebar');return {tools:tools.clientHeight,overflow:getComputedStyle(sidebar).overflowY,tall:sidebar.scrollHeight>sidebar.clientHeight};})()`,
			)) as { tools: number; overflow: string; tall: boolean };
			assert.ok(
				large.tools >= 44,
				"Large text must not collapse tools to an unusable strip: " + JSON.stringify(large),
			);
			if (large.tall)
				assert.match(large.overflow, /auto|scroll/, "Extra-short screens must still reach the footer");
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
