import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join, resolve } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { newConversation, openExtensionManager } from "./frontend-controls.ts";

async function setup() {
	const m = await runtimeFixture({}, undefined, (_payload, n) => ({ text: "SLASH-ACK-" + n }));
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
	const close = async () => {
		await browser?.close();
		await app?.close();
		await m.f.close();
	};
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "web") },
			owner: "Owner",
			extensions: [{ root: resolve("apps/webui/examples/preferences") }],
		});
		assert.ok(app.initialOwner);
		browser = await ownedBrowser(join(m.f.root, "chrome"));
		const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
		await page.wait('document.querySelector("[data-action=signin]")');
		await page.click("[data-action=signin]");
		await page.wait('document.querySelector("[data-interface=preferences-settings]")');
		await newConversation(page, "Slash input");
		await page.type("textarea[name=message]", "/preferences-card");
		await page.wait('document.querySelector("[data-suggestion=preferences-card]")');
		return { m, page, close };
	} catch (error) {
		await close();
		throw error;
	}
}

// Blanket slash interception or prefix-only command matching loses these real user inputs.
test("composer sends unregistered slash text verbatim to the native model", { timeout: 45000 }, async () => {
	const f = await setup();
	try {
		for (const text of ["/tmp/example.txt", "  /not-installed arguments", "/preferences-card/path", "/"]) {
			await f.page.type("textarea[name=message]", text, { replace: true });
			const count = f.m.f.requests.length + 1;
			await f.page.click("[data-action=send]");
			await f.page.wait(`document.querySelector("main").innerText.includes("SLASH-ACK-${count}")`);
			await f.page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
			assert.equal(f.m.f.requests.length, count);
			assert.equal(
				f.m.f.requests
					.at(-1)!
					.messages.filter((row) => row.role === "user")
					.at(-1)!.content,
				text,
			);
			assert.equal(await f.page.evaluate('document.querySelector("textarea[name=message]").value'), "");
		}
		assert.deepEqual(f.m.f.errors, []);
	} finally {
		await f.close();
	}
});

// A failed discovery cannot be treated as an authoritative empty command directory.
test(
	"command discovery failure does not send possible command arguments to the model",
	{ timeout: 45000 },
	async () => {
		const f = await setup();
		try {
			await f.page.evaluate(
				'window.savedSlashFetch=window.fetch; window.fetch=(...args)=>{if(String(args[0]).includes("/pocket/extensions")) return Promise.reject(new Error("Synthetic command discovery disconnect")); return window.savedSlashFetch(...args)}',
			);
			await f.page.wait('!document.querySelector("[data-interface=preferences-settings]")');
			const text = '/preferences-card {"text":"UNDISCOVERED-PRIVATE-CARD"}';
			await f.page.type("textarea[name=message]", text, { replace: true });
			await f.page.click("[data-action=send]");
			await f.page.wait('document.querySelector("[role=alert]")?.textContent.includes("unavailable")');
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(await f.page.evaluate('document.querySelector("textarea[name=message]").value'), text);
			await f.page.evaluate("window.fetch=window.savedSlashFetch");
			await f.page.wait('document.querySelector("[data-interface=preferences-settings]")');
			await f.page.click("[data-action=send]");
			await f.page.wait(
				'document.querySelector(".tool-card")?.textContent.includes("UNDISCOVERED-PRIVATE-CARD")',
			);
			assert.equal(f.m.f.requests.length, 0);
		} finally {
			await f.close();
		}
	},
);

// A handled rejection is not an unrecognized command and must never fall through to model input.
test(
	"registered slash commands retain invalid arguments and disabled commands without model fallback",
	{ timeout: 45000 },
	async () => {
		const f = await setup();
		try {
			for (const text of ["/preferences-card {INVALID-JSON}", "/preferences-card {}"]) {
				await f.page.type("textarea[name=message]", text, { replace: true });
				await f.page.click("[data-action=send]");
				await f.page.wait('document.querySelector("[role=alert]")?.textContent.includes("JSON")');
				assert.equal(f.m.f.requests.length, 0);
				assert.equal(await f.page.evaluate('document.querySelector("textarea[name=message]").value'), text);
			}
			await f.page.type("textarea[name=message]", '/preferences-card {"text":"PRIVATE-CARD"}', {
				replace: true,
			});
			await f.page.click("[data-action=send]");
			await f.page.wait('document.querySelector(".tool-card")?.textContent.includes("PRIVATE-CARD")');
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(await f.page.evaluate('document.querySelector("textarea[name=message]").value'), "");
			await openExtensionManager(f.page);
			await f.page.wait('document.querySelector(".pocket-extension-registration button")');
			// This fixture registers only the preferences extension.
			await f.page.click(".pocket-extension-registration button");
			await f.page.wait('document.querySelector(".extension-phase")?.textContent !== "ready"');
			await f.page.click(".back-to-app");
			const disabled = '/preferences-card {"text":"DISABLED-PRIVATE-CARD"}';
			await f.page.type("textarea[name=message]", disabled, { replace: true });
			await f.page.click("[data-action=send]");
			await f.page.wait('document.querySelector("[role=alert]")?.textContent.includes("unavailable")');
			assert.equal(await f.page.evaluate('document.querySelector("textarea[name=message]").value'), disabled);
			assert.equal(f.m.f.requests.length, 0);
			assert.deepEqual(f.m.f.errors, []);
		} finally {
			await f.close();
		}
	},
);
