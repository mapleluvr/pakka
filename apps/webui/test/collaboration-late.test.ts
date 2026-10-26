import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { conversationAction } from "./frontend-controls.ts";

// Only response delivery is delayed: the real authorized HTTP request completes. A closure capturing
// an earlier resource must not reopen its sheet or publish its contents into the newly selected view.
test(
	"WebUI collaboration: a real late read cannot reopen or populate another Conversation",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "late-data") },
				owner: "Owner",
				initial: [
					{ name: "First resource", profile: "default" },
					{ name: "Second resource", profile: "default" },
				],
			});
			assert.ok(app.initialOwner);
			const initialActor = await app.people.authenticate(app.initialOwner.token),
				workspace = app.workspace.bind(initialActor),
				refs = await workspace.list();
			await workspace.display(refs[1]!, {
				requestId: "ready-marker",
				kind: "card",
				text: "SECOND-RESOURCE-COMMITTED-READY",
			});
			browser = await ownedBrowser(join(m.f.root, "late-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelectorAll("[data-conversation]").length===2');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await page.evaluate(
				`(()=>{const send=window.fetch;window.fetch=async(...args)=>{const response=await send(...args);let input;try{input=JSON.parse(args[1]?.body??'{}');}catch{return response;}if(input.command?.op==='collaboration.read'&&!window.__held){window.__held=true;await new Promise(resolve=>{window.__release=resolve;});window.__settled=true;}return response;};})()`,
			);
			await conversationAction(page, "collaboration");
			await page.wait("window.__held===true");
			await page.click(
				`[data-session=${JSON.stringify(refs[1]!.sessionId)}][data-conversation=${JSON.stringify(refs[1]!.conversationId)}]`,
			);
			await page.wait(
				'document.querySelector(".pocket-title").innerText==="Second resource" && document.querySelector("main").innerText.includes("SECOND-RESOURCE-COMMITTED-READY")',
			);
			await page.evaluate("window.__release()");
			await page.wait("window.__settled===true");
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
			assert.equal(
				await page.evaluate(`Boolean(document.querySelector('[aria-label="Team Collaboration"]'))`),
				false,
			);
			assert.equal(
				await page.evaluate('document.querySelector(".pocket-title").innerText'),
				"Second resource",
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
