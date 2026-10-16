import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

type Browser = Awaited<ReturnType<typeof ownedBrowser>>;
type Page = Awaited<ReturnType<Browser["page"]>>;
async function openSettings(page: Page) {
	await page.wait('document.querySelector("[data-action=settings]")');
	await page.click("[data-action=settings]");
	await page.wait('document.querySelector("[data-model-choice]")');
}
async function login(page: Page) {
	await page.wait('document.querySelector("[data-action=signin]")');
	await page.click("[data-action=signin]");
	await page.wait('document.querySelector("[data-conversation]")');
	await page.click("[data-conversation]");
}

// A completed native configure with a lost HTTP response must not be repeated, even when the old SSE resource stops updating.
test(
	"Pocket settings recovery: lost configure response locks mutations and explicit workspace reload only reads the new incarnation",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture({ profiles: [{ id: "alternate", model: "alternate-model" }] });
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, browser: Browser | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "recovery") },
				owner: "Owner",
				profiles: ["default", "alternate"],
				initial: [{ name: "Project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "recovery-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await login(page);
			await openSettings(page);
			const before = app.runtime.view().conversations.find((ref) => ref.key !== "root")!;
			await page.evaluate(
				`(()=>{const original=globalThis.fetch;globalThis.__configureCount=0;globalThis.__restoreFetch=()=>{globalThis.fetch=original;};globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&JSON.parse(args[1].body).command?.op==='configure'){globalThis.__configureCount++;const response=await original(...args);await response.arrayBuffer();throw Error('TEST LOST COMMITTED CONFIGURATION RESPONSE');}return original(...args);};const select=document.querySelector('[data-model-choice]');select.value='alternate';select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
			);
			await page.click("[data-save-configuration]");
			await page.wait('document.querySelector("[data-reload-configuration]")?.disabled===false');
			assert.equal(await page.evaluate('document.querySelector("[data-save-configuration]").disabled'), true);
			const changed = app.runtime.view().conversations.find((ref) => ref.key === before.key)!;
			assert.equal(changed.profile, "alternate");
			assert.notEqual(changed.incarnation, before.incarnation);
			await page.evaluate("globalThis.__restoreFetch()");
			await page.click("[data-reload-configuration]");
			await page.wait(
				'!document.querySelector("[data-reload-configuration]")&&document.querySelector("[data-action=send]")?.disabled===false',
			);
			assert.deepEqual(
				app.runtime.view().conversations.find((ref) => ref.key === before.key),
				changed,
			);
			assert.equal(await page.evaluate("globalThis.__configureCount"), 1);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
			await page.type("textarea[name=message]", "AFTER-LOST-CONFIGURATION");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.requests[0]?.model, "alternate-model");
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);

// A read can complete after the user closes one sheet and mounts another. It may not replace the new sheet's profile or usage.
test(
	"Pocket settings recovery: a real delayed response from the old resource cannot populate the replacement sheet",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture({ profiles: [{ id: "alternate", model: "alternate-model" }] });
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, browser: Browser | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "late") },
				owner: "Owner",
				profiles: ["default", "alternate"],
				initial: [
					{ name: "First", profile: "default" },
					{ name: "Second", profile: "alternate" },
				],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "late-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await login(page);
			await page.evaluate(
				`(()=>{const original=globalThis.fetch;let first=true;globalThis.__settingsHeld=false;globalThis.fetch=async(...args)=>{const response=await original(...args);if(first&&typeof args[1]?.body==='string'&&JSON.parse(args[1].body).command?.op==='configuration'){first=false;globalThis.__settingsHeld=true;await new Promise(resolve=>{globalThis.__releaseSettings=resolve;});}return response;};})()`,
			);
			await page.click("[data-action=settings]");
			await page.wait("globalThis.__settingsHeld");
			await page.click('[aria-label="Close settings"]');
			const second = app.runtime.view().conversations.find((ref) => ref.profile === "alternate")!;
			await page.click('[data-conversation="' + second.conversationId + '"]');
			await openSettings(page);
			assert.equal(await page.evaluate('document.querySelector("[data-model-choice]").value'), "alternate");
			await page.evaluate("globalThis.__releaseSettings()");
			await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
			assert.equal(await page.evaluate('document.querySelector("[data-model-choice]").value'), "alternate");
			assert.equal(await page.evaluate('document.querySelector(".pocket-title").innerText'), "Second");
			assert.equal(m.f.requests.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
