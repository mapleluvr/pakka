import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { findInConversation } from "./frontend-controls.ts";

test(
	"Pocket history browser: explicit earlier pages remain searchable across live updates without implicit inference",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "history-product") },
				owner: "Owner",
				initial: [{ name: "History", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			const actor = await app.people.authenticate(app.initialOwner.token),
				client = app.workspace.bind(actor),
				ref = (await client.list())[0]!;
			for (let i = 0; i < 270; i++)
				await client.display(ref, {
					requestId: "display-" + i,
					kind: "card",
					text: "HISTORY-CANARY-" + String(i).padStart(3, "0"),
				});
			assert.equal(m.f.requests.length, 0);
			browser = await ownedBrowser(join(m.f.root, "history-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=show-earlier]")');
			assert.equal(
				await page.evaluate(
					'document.querySelector(".conversation-scroll").textContent.includes("HISTORY-CANARY-000")',
				),
				false,
			);
			await findInConversation(page, "HISTORY-CANARY-000");
			await page.wait('document.querySelectorAll("[data-entry]").length===0');
			await page.click("[data-action=show-earlier]");
			await page.wait(
				'document.querySelector(".conversation-scroll").textContent.includes("HISTORY-CANARY-000")',
			);

			assert.equal(
				await page.evaluate('Boolean(document.querySelector("[data-action=show-earlier]"))'),
				false,
			);
			assert.equal(m.f.requests.length, 0);
			await page.type("textarea[name=message]", "AFTER-READING-EXPLICIT-SEND");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".pocket-receipt")?.textContent.includes("done")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(
				await page.evaluate(
					'document.querySelector(".conversation-scroll").textContent.includes("HISTORY-CANARY-000")',
				),
				true,
			);
			assert.doesNotMatch(JSON.stringify(m.f.requests), /HISTORY-CANARY/);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
