import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { newConversation } from "./frontend-controls.ts";

// Removing generic slots/command dispatch or accidentally prompting on slash must fail this real-browser consumer.
test(
	"Extension browser: unchanged GUI-only and settings packages use public slots, one Preact, shared slash/button dispatch and private state",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "web") },
				owner: "Owner",
				extensions: [
					{ root: resolve("apps/webui/examples/hello") },
					{ root: resolve("apps/webui/examples/preferences") },
				],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-interface=hello-home]")');
			await page.click("[data-interface=hello-home]");
			await page.wait('document.querySelector("[data-hello-count]")?.textContent === "0"');
			await page.click("[data-increment]");
			await page.wait('document.querySelector("[data-hello-count]")?.textContent === "1"');
			assert.equal(await page.evaluate('document.querySelectorAll("[data-conversation]").length'), 0);
			assert.equal(m.f.requests.length, 0);
			await page.click("[data-open-about]");
			await page.wait('document.querySelector("[role=dialog]")?.textContent.includes("Public interface")');
			await page.evaluate(
				'document.querySelector("[role=dialog]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))',
			);
			await page.wait('!document.querySelector("[role=dialog]")');
			await page.click("[data-action=commands]");
			await page.wait('document.querySelector("[data-command=hello-open]")');
			await page.click("[data-command=hello-open]");
			await page.wait('document.querySelector("[data-hello-count]")');
			await page.click("[data-interface=preferences-settings]");
			await page.wait('document.querySelector("input[name=exampleLabel]")');
			await page.type("input[name=exampleLabel]", "PRIVATE-PREFERENCE-CANARY");
			await page.click("[data-save-label]");
			await page.wait(
				'document.querySelector("[data-current-label]")?.textContent === "PRIVATE-PREFERENCE-CANARY"',
			);
			await page.click('[aria-label="Close Example preferences"]');
			await page.click("[data-action=commands]");
			await page.wait('document.querySelector("[data-command=preferences-status]")');
			await page.click("[data-command=preferences-status]");
			await page.wait(
				'document.querySelector("[role=alert]")?.textContent.includes("PRIVATE-PREFERENCE-CANARY")',
			);
			await newConversation(page, "Commands work");
			await page.wait(
				'document.querySelector("textarea[name=message]") && document.querySelector("[data-action=send]")?.disabled === false',
			);
			await page.type("textarea[name=message]", "/preferences-status");
			await page.wait('document.querySelector("[data-suggestion=preferences-status]")');
			await page.click("[data-suggestion=preferences-status]");
			await page.wait('document.querySelector("textarea[name=message]").value === ""');
			assert.equal(m.f.requests.length, 0);
			await page.click("[data-action=commands]");
			await page.wait('document.querySelector("[data-command=preferences-card]")');
			await page.click("[data-command=preferences-card]");
			await page.wait(
				'document.querySelector("[role=alert]")?.textContent.includes("/preferences-card") && document.querySelector("[role=alert]")?.textContent.includes("text")',
			);
			assert.equal(
				m.f.requests.length,
				0,
				"A command missing its required input must explain usage without invoking a model",
			);
			await page.type("textarea[name=message]", '/preferences-card {"text":"DISPLAY-CARD-CANARY"}');
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".tool-card")?.textContent.includes("DISPLAY-CARD-CANARY")');
			assert.equal(m.f.requests.length, 0);
			await page.type("textarea[name=message]", "ORDINARY-MODEL-INPUT");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector("main").innerText.includes("done")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(JSON.stringify(m.f.requests).includes("DISPLAY-CARD-CANARY"), false);
			assert.equal(JSON.stringify(m.f.requests).includes("PRIVATE-PREFERENCE-CANARY"), false);
			const actor = await app.people
				.authenticate((await page.evaluate("document.cookie.match(/pakka_csrf=([^;]+)/)[1]")) as string)
				.catch(() => null);
			assert.equal(actor, null, "a CSRF value never authenticates a person");
			const out = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "extension-browser");
			await mkdir(out, { recursive: true });
			await writeFile(join(out, "desktop.png"), await page.screenshot());
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
