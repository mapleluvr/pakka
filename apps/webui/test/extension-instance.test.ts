import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"Extension interface: old callbacks cannot close/notify/reopen a replacement; disable removes only its public UI",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		const root = join(m.f.root, "late-ui");
		await mkdir(join(root, "web"), { recursive: true });
		await writeFile(
			join(root, "manifest.json"),
			JSON.stringify({
				api: 1,
				id: "late",
				version: "1.0.0",
				title: "Late interface",
				facets: { webui: { publicDir: "web", entry: "index.js" } },
				actions: [],
				commands: [],
				interfaces: [
					{ id: "home", title: "Late view", slot: "page", scope: "app", export: "Home", navigation: true },
				],
			}),
		);
		await writeFile(
			join(root, "web/index.js"),
			`import {h} from "preact";import {Button} from "@pakka/webui/components";export function Home({context}){return h("div",null,h("output",{"data-instance":""},context.instanceId),h(Button,{"data-late":"",onClick:()=>{setTimeout(()=>{globalThis.lateCallbackFinished=true;context.close();context.notice("STALE-INTERFACE-NOTICE");context.open("home");},200);context.close();}},"Close, then finish later"));}`,
		);
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "web-data") },
				owner: "Owner",
				initial: [{ name: "Kept work", profile: "default" }],
				extensions: [{ root }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token, {
				width: 390,
				height: 844,
			});
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-interface=late-home]")');
			await page.click('[aria-label="Toggle conversations"]');
			await page.click("[data-interface=late-home]");
			await page.wait('document.querySelector("[data-instance]")');
			await page.wait('!document.querySelector(".drawer-open")');
			const previous = await page.evaluate('document.querySelector("[data-instance]").textContent');
			await page.click("[data-late]");
			await page.wait('!document.querySelector("[data-instance]")');
			await page.click('[aria-label="Toggle conversations"]');
			await page.click("[data-interface=late-home]");
			await page.wait('!document.querySelector(".drawer-open")');
			await page.wait('document.querySelector("[data-instance]")');
			const replacement = await page.evaluate('document.querySelector("[data-instance]").textContent');
			assert.notEqual(replacement, previous);
			await page.wait("globalThis.lateCallbackFinished === true");
			assert.equal(await page.evaluate('document.querySelector("[data-instance]").textContent'), replacement);
			assert.equal(await page.evaluate('document.body.innerText.includes("STALE-INTERFACE-NOTICE")'), false);
			assert.equal(await page.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
			await page.click("[data-action=commands]");
			await page.wait('document.querySelector(".pocket-extension-registration button")');
			await page.click(".pocket-extension-registration button");
			await page.wait(
				'!document.querySelector("[data-interface=late-home]") && !document.querySelector("[data-instance]")',
			);
			await page.evaluate(
				'document.querySelector("[role=dialog]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))',
			);
			assert.equal(
				app.runtime.view().conversations.length,
				2,
				"runtime root and initial workspace Conversation are both retained",
			);
			assert.equal(m.f.requests.length, 0);
			await page.click('[aria-label="Toggle conversations"]');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=send]")?.disabled === false');
			await page.type("textarea[name=message]", "WORK-AFTER-UI-DISABLE");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector("main").innerText.includes("done")');
			assert.equal(m.f.requests.length, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
