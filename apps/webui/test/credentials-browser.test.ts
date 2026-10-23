import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { conversationAction, organizationAction, toggleConversations } from "./frontend-controls.ts";

test(
	"WebUI private settings browser: explicit replacement and clear affect actual provider auth without round-tripping or browser persistence",
	{ timeout: 40000 },
	async (t) => {
		const replacement = "SYNTHETIC-BROWSER-PRIVATE-REPLACEMENT";
		const m = await runtimeFixture({ apiKey: "SYNTHETIC-BROWSER-BOOTSTRAP" });
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "private-browser-product") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "private-browser"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await owner.wait('document.querySelector("[data-action=signin]")');
			await owner.click("[data-action=signin]");
			await owner.wait('document.querySelector("[data-conversation]")');
			await owner.click("[data-conversation]");
			await conversationAction(owner, "settings");
			await owner.wait('document.querySelector("[data-credential-input]")');
			assert.equal(await owner.evaluate('document.querySelector("[data-credential-input]").value'), "");
			await owner.type("[data-credential-input]", replacement);
			await owner.click("[data-credential-replace]");
			await owner.wait(
				'document.querySelector("[data-credential-status]")?.dataset.version==="1"&&document.querySelector("[data-credential-input]").value===""',
			);
			assert.equal(
				await owner.evaluate(
					`JSON.stringify({...localStorage,...sessionStorage}).includes(${JSON.stringify(replacement)})||document.body.innerText.includes(${JSON.stringify(replacement)})`,
				),
				false,
			);
			await owner.click('[aria-label="Close settings"]');
			await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await owner.type("textarea[name=message]", "AFTER-PRIVATE-REPLACE");
			await owner.click("[data-action=send]");
			await owner.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.authorization[0], "Bearer " + replacement);
			await conversationAction(owner, "settings");
			await owner.wait('document.querySelector("[data-credential-clear]")?.disabled===false');
			await owner.click("[data-credential-clear]");
			await owner.wait(
				'document.querySelector("[data-credential-status]")?.dataset.version==="2"&&document.querySelector("[data-credential-status]").dataset.configured==="false"',
			);
			await owner.click('[aria-label="Close settings"]');
			await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await owner.type("textarea[name=message]", "AFTER-PRIVATE-CLEAR");
			await owner.click("[data-action=send]");
			await owner.wait('document.querySelector(".pocket-receipt")?.innerText.includes("unanswered")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(app.runtime.view().budget.primaryAttempts, 2);
			await organizationAction(owner, "people");
			await owner.wait('document.querySelector("[data-action=invite]")');
			await owner.click("[data-action=invite]");
			await owner.wait('document.querySelector("input[name=inviteLink]")?.value.includes("#invite=")');
			const viewer = await browser.page(
				String(await owner.evaluate('document.querySelector("input[name=inviteLink]").value')),
				{ width: 390, height: 844 },
			);
			await viewer.wait('document.querySelector("[data-action=signin]")');
			await viewer.type("input[name=person]", "Viewer");
			await viewer.click("[data-action=signin]");
			await viewer.wait('document.querySelector("[data-conversation]")');
			await toggleConversations(viewer);
			await viewer.click("[data-conversation]");
			await conversationAction(viewer, "settings");
			await viewer.wait('document.querySelector("[data-cost]")');
			assert.equal(
				await viewer.evaluate('Boolean(document.querySelector("[data-credential-input]"))'),
				false,
			);
			assert.equal(
				await viewer.evaluate(`document.body.innerText.includes(${JSON.stringify(replacement)})`),
				false,
			);
			await owner.click('[aria-label="Close people"]');
			await conversationAction(owner, "settings");
			await owner.wait('document.querySelector("[data-credential-status]")?.dataset.configured==="false"');
			for (const page of [owner, viewer])
				await page.wait(
					'(async()=>{await document.fonts.ready;return document.getAnimations().every(animation=>animation.playState!=="running");})()',
				);
			const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "private-settings-screenshots");
			await mkdir(output, { recursive: true });
			await writeFile(join(output, "desktop-overview.png"), await owner.screenshot());
			await owner.evaluate(
				'document.querySelector("[data-credential-clear]").scrollIntoView({block:"center",behavior:"instant"})',
			);
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

// Losing a committed replacement result must not retain its key or re-enter the write on refresh.
test(
	"WebUI private settings recovery: a lost committed response clears the input and only reads state before another explicit change",
	{ timeout: 30000 },
	async () => {
		const replacement = "SYNTHETIC-LOST-PRIVATE-REPLACEMENT";
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "private-recovery") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "private-recovery-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await conversationAction(page, "settings");
			await page.wait('document.querySelector("[data-credential-input]")?.disabled===false');
			await page.evaluate(
				`(()=>{const original=globalThis.fetch;globalThis.__credentialWrites=0;globalThis.__restorePrivateFetch=()=>{globalThis.fetch=original;};globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&JSON.parse(args[1].body).command?.op==='credential.replace'){globalThis.__credentialWrites++;const response=await original(...args);await response.arrayBuffer();throw Error('TEST LOST COMMITTED PRIVATE RESPONSE');}return original(...args);};})()`,
			);
			await page.type("[data-credential-input]", replacement);
			await page.click("[data-credential-replace]");
			await page.wait('document.querySelector("[data-credential-reload]")?.disabled===false');
			assert.equal(await page.evaluate('document.querySelector("[data-credential-input]").value'), "");
			assert.equal(await page.evaluate('document.querySelector("[data-credential-clear]").disabled'), true);
			assert.equal(await page.evaluate('document.querySelector("[data-credential-replace]").disabled'), true);
			assert.equal(
				await page.evaluate(
					`document.body.innerText.includes(${JSON.stringify(replacement)})||JSON.stringify({...localStorage,...sessionStorage}).includes(${JSON.stringify(replacement)})`,
				),
				false,
			);
			await page.evaluate("globalThis.__restorePrivateFetch()");
			await page.click("[data-credential-reload]");
			await page.wait(
				'!document.querySelector("[data-credential-reload]")&&document.querySelector("[data-credential-status]")?.dataset.version==="1"',
			);
			assert.equal(await page.evaluate("globalThis.__credentialWrites"), 1);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
			await page.click('[aria-label="Close settings"]');
			await conversationAction(page, "settings");
			await page.wait('document.querySelector("[data-credential-input]")?.disabled===false');
			assert.equal(await page.evaluate('document.querySelector("[data-credential-input]").value'), "");
			await page.click('[aria-label="Close settings"]');
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await page.type("textarea[name=message]", "AFTER-LOST-PRIVATE-RESULT");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.authorization[0], "Bearer " + replacement);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
