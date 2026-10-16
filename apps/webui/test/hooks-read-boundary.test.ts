import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceHooksExtensionRoot, workspaceHooksService } from "../src/workflows.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"Pocket hooks private read: a real setup response delayed across panel replacement cannot reveal a key in the new instance",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "late-hooks") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				extensions: [{ root: workspaceHooksExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => ({
					hooks: await workspaceHooksService(context, { namespace: "late.hooks" }),
				}),
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "late-hook-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-interface=workspace-hooks-hooks]")');
			await page.click("[data-interface=workspace-hooks-hooks]");
			await page.wait('document.querySelector("[data-hook-name]")?.disabled===false');
			await page.type("[data-hook-name]", "Late private setup");
			await page.click("[data-hook-create]");
			await page.wait('document.querySelector("[data-hook-setup]")?.disabled===false');
			await page.click("[data-hook-setup]");
			await page.wait('document.querySelector("[data-hook-secret]")?.value.length===43');
			const secret = await page.evaluate('document.querySelector("[data-hook-secret]").value');
			assert.equal(typeof secret, "string");
			await page.click("[data-hook-hide-setup]");
			await page.evaluate(
				`(()=>{const original=globalThis.fetch;const gate=new Promise(resolve=>globalThis.__releaseHookSetup=resolve);globalThis.__hookSetupReads=0;globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&JSON.parse(args[1].body).command?.call?.action==='credentials'){globalThis.__hookSetupReads++;const response=await original(...args),bytes=await response.arrayBuffer();globalThis.__hookSetupHeld=true;await gate;globalThis.__hookSetupReleased=true;return new Response(bytes,{status:response.status,headers:response.headers});}return original(...args);};globalThis.__restoreHookFetch=()=>{globalThis.fetch=original;};})()`,
			);
			await page.click("[data-hook-setup]");
			await page.wait("globalThis.__hookSetupHeld===true");
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("textarea[name=message]")');
			await page.click("[data-interface=workspace-hooks-hooks]");
			await page.wait('document.querySelector("[data-hook-setup]")?.disabled===false');
			await page.evaluate("globalThis.__restoreHookFetch();globalThis.__releaseHookSetup();");
			await page.wait("globalThis.__hookSetupReleased===true");
			await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
			assert.equal(await page.evaluate('document.querySelector("[data-hook-private-setup]")===null'), true);
			assert.equal(await page.evaluate("globalThis.__hookSetupReads"), 1);
			assert.equal(
				await page.evaluate(
					`document.body.innerText.includes(${JSON.stringify(secret)})||JSON.stringify({...localStorage,...sessionStorage}).includes(${JSON.stringify(secret)})`,
				),
				false,
			);
			assert.equal(m.f.requests.length, 0);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
