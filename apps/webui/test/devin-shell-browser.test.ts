import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import {
	settleFrontend,
	toggleConversations,
	openAppearance,
	organizationAction,
	newConversation,
} from "./frontend-controls.ts";

// Geometry belongs to devin-adoption-browser; this consumer catches lost native
// configuration inheritance and accidental submission from home/navigation.
test(
	"Devin frontend: the creation dialog inherits the selected model; responsive navigation preserves explicit native input",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture({ profiles: [{ id: "alternate", model: "alternate-model" }] });
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "devin-shell");
		try {
			await mkdir(evidence, { recursive: true });
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "shell") },
				owner: "Owner",
				profiles: ["default", "alternate"],
				initial: [{ name: "Existing project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "chrome"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait(
				'document.querySelector("[data-conversation]") || document.querySelector("[data-action=signin]")',
			);
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await settleFrontend(page);
			await page.click('[data-action="collapse-sidebar"]');
			assert.equal(await page.evaluate('document.querySelector("#main").getBoundingClientRect().x'), 0);
			await page.click('[data-action="expand-sidebar"]');
			await page.evaluate(
				'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true}))',
			);
			await page.wait('document.querySelector(".palette")?.contains(document.activeElement)');
			await page.type('input[aria-label="Search conversations"]', "Existing");
			await page.click("[data-search-conversation]");
			await page.wait('document.querySelector(".pocket-status")?.textContent==="Ready"');
			await page.click('[data-action="model"]');
			await page.wait('document.querySelector("[data-pick-model=alternate-model]")');
			await page.click('[data-pick-model="alternate-model"]');
			await page.wait(
				'document.querySelector("[data-action=model]")?.textContent.includes("alternate-model") && !document.querySelector("[role=dialog]")',
			);
			await newConversation(page, "Real new work");
			await page.wait('document.querySelector(".pocket-status")?.textContent==="Ready"');
			assert.match(
				String(await page.evaluate('document.querySelector(".pocket-title").textContent')),
				/Real new work/,
			);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-action=model]").textContent')),
				/alternate-model/,
			);
			assert.equal(m.f.requests.length, 0);
			await page.type("textarea[name=message]", "SHELL-NATIVE-INPUT");
			await page.click('[data-action="send"]');
			await page.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.requests[0]?.model, "alternate-model");
			assert.ok(JSON.stringify(m.f.requests[0]!.messages).includes("SHELL-NATIVE-INPUT"));
			await writeFile(join(evidence, "conversation-desktop.png"), await page.screenshot());
			for (const size of [
				{ width: 390, height: 844 },
				{ width: 360, height: 600 },
			]) {
				await page.resize(size);
				await settleFrontend(page);
				await page.navigate(app.http.origin);
				await page.wait('document.querySelector(".home-create-card")');
				await settleFrontend(page);
				assert.equal(
					await page.evaluate(
						`(()=>{const n=document.querySelector(".home-create-card > p"),b=n.getBoundingClientRect(),r=document.createRange();r.selectNodeContents(n);return document.documentElement.scrollWidth<=innerWidth&&[...r.getClientRects()].every(p=>p.left>=b.left&&p.right<=b.right&&p.top>=b.top&&p.bottom<=b.bottom);})()`,
					),
					true,
					"Home guidance is fully visible on the phone",
				);
				await page.click('[aria-label="Commands & Extensions"]');
				await page.wait('document.querySelector(".palette")?.contains(document.activeElement)');
				await page.key("Escape");
				await page.wait('!document.querySelector(".palette")');
				await organizationAction(page, "people");
				await page.wait(`document.querySelector('[aria-label="Close people"]')`);
				await page.key("Escape");
				await settleFrontend(page);
				if (await page.evaluate('document.body.classList.contains("drawer-open")')) {
					await page.key("Escape");
					await settleFrontend(page);
				}
				await writeFile(join(evidence, `home-${size.width}.png`), await page.screenshot());
			}
			await page.resize({ width: 1440, height: 900 });
			await settleFrontend(page);
			await openAppearance(page);
			await page.wait('document.querySelector("[aria-label=Theme]")');
			await page.evaluate(
				'(()=>{const e=document.querySelector("[aria-label=Theme]");e.value="light";e.dispatchEvent(new Event("change",{bubbles:true}));})()',
			);
			await page.click('[aria-label="Close appearance"]');
			assert.equal(
				await page.evaluate("getComputedStyle(document.body).backgroundColor"),
				"rgb(252, 252, 252)",
			);
			await writeFile(join(evidence, "home-desktop-light.png"), await page.screenshot());
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
