import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"Pocket settings browser: actual model choice changes provider input and mobile viewer cannot configure or read Session totals",
	{ timeout: 45000 },
	async (t) => {
		const m = await runtimeFixture({
			apiKey: "PRIVATE-SETTINGS-CANARY",
			profiles: [
				{ id: "alternate", model: "alternate-model", systemPrompt: "ALT-INSTRUCTION" },
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
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "settings-browser"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await owner.wait('document.querySelector("[data-action=signin]")');
			await owner.click("[data-action=signin]");
			await owner.wait('document.querySelector("[data-conversation]")');
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("[data-action=settings]")');
			await owner.click("[data-action=settings]");
			await owner.wait('document.querySelector("[data-model-choice]")');
			assert.deepEqual(
				await owner.evaluate(
					'[...document.querySelectorAll("[data-model-choice] option")].map(option=>option.value)',
				),
				["default", "alternate"],
			);
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
			await owner.evaluate(
				'(()=>{const select=document.querySelector("[data-model-choice]");select.value="alternate";select.dispatchEvent(new Event("change",{bubbles:true}));})()',
			);
			await owner.click("[data-save-configuration]");
			await owner.wait(
				'!document.querySelector("[data-save-configuration]")&&document.querySelector("[data-action=send]")?.disabled===false',
			);
			await owner.type("textarea[name=message]", "ACTUAL-SETTINGS-WORK");
			await owner.click("[data-action=send]");
			await owner.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.requests[0]?.model, "alternate-model");
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			await owner.click("[data-action=people]");
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
			await viewer.click('[aria-label="Toggle conversations"]');
			await viewer.click("[data-conversation]");
			await viewer.click("[data-action=settings]");
			await viewer.wait('document.querySelector("[data-model-choice]")');
			assert.equal(await viewer.evaluate('document.querySelector("[data-model-choice]").disabled'), true);
			assert.equal(await viewer.evaluate('Boolean(document.querySelector("[data-session-budget]"))'), false);
			assert.equal(await viewer.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
			await owner.click('[aria-label="Close people"]');
			await owner.click("[data-action=settings]");
			await owner.wait('document.querySelector("[data-model-choice]")');
			for (const page of [owner, viewer])
				await page.wait(
					'(async()=>{await document.fonts.ready;return document.getAnimations().every(animation=>animation.playState!=="running");})()',
				);
			const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "settings-screenshots");
			await mkdir(output, { recursive: true });
			await writeFile(join(output, "desktop.png"), await owner.screenshot());
			await writeFile(join(output, "mobile.png"), await viewer.screenshot());
			t.diagnostic(output);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
