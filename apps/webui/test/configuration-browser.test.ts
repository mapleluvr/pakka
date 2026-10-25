import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { conversationAction, organizationAction, toggleConversations } from "./frontend-controls.ts";

test(
	"WebUI configuration browser: compact model choice changes provider input while mobile viewer cannot configure or read Session totals",
	{ timeout: 45000 },
	async (t) => {
		const m = await runtimeFixture({
			apiKey: "PRIVATE-SETTINGS-CANARY",
			profiles: [
				{ id: "alternate", model: "alternate-model", cwd: process.cwd(), systemPrompt: "ALT-INSTRUCTION" },
				{ id: "hidden", model: "PRIVATE-HIDDEN-MODEL" },
			],
		});
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "settings-product") },
				owner: "Owner",
				profiles: ["default", "alternate"],
				initial: [{ name: "Project", profile: "default" }],
			});
			browser = await ownedBrowser(join(m.f.root, "settings-browser"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner!.token);
			await owner.wait('document.querySelector("[data-action=signin]")');
			await owner.click("[data-action=signin]");
			await owner.wait('document.querySelector("[data-conversation]")');
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("[data-action=model]")?.disabled===false');
			await conversationAction(owner, "settings");
			await owner.wait('document.querySelector("[data-cost]")');
			assert.match(
				String(await owner.evaluate('document.querySelector("[data-cost]").innerText')),
				/unknown/i,
			);
			assert.equal(await owner.evaluate('Boolean(document.querySelector("[data-session-budget]"))'), true);
			assert.equal(
				await owner.evaluate(
					'document.body.innerText.includes("PRIVATE-HIDDEN-MODEL")||document.body.innerText.includes("PRIVATE-SETTINGS-CANARY")',
				),
				false,
			);
			await owner.click('[aria-label="Close settings"]');
			await owner.click("[data-action=model]");
			await owner.wait('document.querySelector("[data-pick-model]")');
			assert.deepEqual(
				await owner.evaluate(
					'[...document.querySelectorAll("[data-pick-model]")].map(row=>row.dataset.pickModel)',
				),
				["local-model", "alternate-model"],
			);
			assert.equal(m.f.requests.length, 0);
			await owner.click("[data-pick-model=alternate-model]");
			await owner.wait(
				'!document.querySelector("[data-pick-model]")&&document.querySelector("[data-action=model]")?.textContent.includes("alternate-model")',
			);
			assert.equal(await owner.evaluate('document.querySelector("[data-action=cwd]").title'), m.f.cwd);
			await owner.type("textarea[name=message]", "ACTUAL-SETTINGS-WORK");
			await owner.click("[data-action=send]");
			await owner.wait('document.querySelector("main").textContent.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.requests[0]?.model, "alternate-model");
			assert.doesNotMatch(JSON.stringify(m.f.requests[0]), /ALT-INSTRUCTION/);
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			await organizationAction(owner, "people");
			await owner.wait('document.querySelector("[data-action=invite]")');
			await owner.click("[data-action=invite]");
			await owner.wait('document.querySelector("input[name=inviteLink]")?.value.includes("#invite=")');
			const viewer = await browser.page(
				String(await owner.evaluate('document.querySelector("input[name=inviteLink]").value')),
				{ width: 390, height: 650 },
			);
			await viewer.wait('document.querySelector("[data-action=signin]")');
			await viewer.type("input[name=person]", "Viewer");
			await viewer.click("[data-action=signin]");
			await viewer.wait('document.querySelector("[data-conversation]")');
			await toggleConversations(viewer);
			await viewer.click("[data-conversation]");
			await viewer.wait(
				'document.querySelector(".pocket-status")?.textContent==="Ready"&&document.querySelector("[data-action=cwd]")?.title===' +
					JSON.stringify(m.f.cwd),
			);
			await conversationAction(viewer, "settings");
			await viewer.wait('document.querySelector("[data-cost]")');
			assert.equal(await viewer.evaluate('document.querySelector("[data-action=model]").disabled'), true);
			assert.equal(await viewer.evaluate('document.querySelector("[data-action=cwd]").disabled'), true);
			assert.equal(await viewer.evaluate('document.querySelector("[data-action=cwd]").title'), m.f.cwd);
			assert.equal(await viewer.evaluate('Boolean(document.querySelector("[data-session-budget]"))'), false);
			assert.equal(
				await viewer.evaluate('Boolean(document.querySelector("[data-credential-input]"))'),
				false,
			);
			assert.equal(await viewer.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
			await owner.click('[aria-label="Close people"]');
			await conversationAction(owner, "settings");
			await owner.wait('document.querySelector("[data-cost]")');
			const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "settings-screenshots");
			await mkdir(output, { recursive: true });
			for (const [name, page] of [
				["desktop", owner],
				["mobile", viewer],
			] as const) {
				await page.wait(
					'(async()=>{await document.fonts.ready;return document.getAnimations().every(animation=>animation.playState!=="running");})()',
				);
				await writeFile(join(output, name + ".png"), await page.screenshot());
			}
			t.diagnostic(output);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
