import { test } from "node:test";
import assert from "node:assert/strict";
import { startPocket } from "../src/bootstrap.ts";
import { openProductModels } from "../src/product-models.ts";
import { runtimeLimits } from "../../../packages/agent/test/runtime-fixture.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, type FrontendPage } from "./frontend-controls.ts";
import { join } from "node:path";

async function selectOption(page: FrontendPage, selector: string, value: string) {
	const index = Number(
		await page.evaluate(
			`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(option => option.value === ${JSON.stringify(value)})`,
		),
	);
	assert.ok(index >= 0, "the actual native select must offer the value");
	await page.click(selector);
	await page.key("Home");
	for (let n = 0; n < index; n++) await page.key("ArrowDown");
	await page.key("Enter");
}

// A profile-bound 65-row prefix cannot select this real model on the second native page.
test(
	"native model picker searches and pages the real registry, displays capabilities and sends the chosen reasoning level",
	{ timeout: 45000 },
	async () => {
		const { f, agentDir } = await isolated();
		let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await configuration(agentDir, f.endpoint);
			source = await openProductModels({ agentDir, cwd: f.cwd });
			app = await startPocket({
				owner: "Owner",
				modelConfiguration: source,
				runtime: {
					cwd: f.cwd,
					dataDir: f.dataDir,
					models: source.models,
					model: "alpha/reasoner",
					limits: runtimeLimits,
				},
				initial: [{ name: "Native Work", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(f.root, "model-picker-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=model]")?.disabled === false');
			await settleFrontend(page);
			await page.click("[data-action=model]");
			await page.wait('document.querySelector("[data-model-search]")');
			// Search spans Pi built-ins too; the bare word "beta" also matches their names.
			await page.type("[data-model-search]", "beta/model-", { replace: true });
			await page.wait('document.querySelector("[data-model-total]")?.textContent === "70"');
			await page.click("[data-model-next]");
			await page.wait(`document.querySelector('[data-pick-model="beta/model-069"]')`);
			await page.click('[data-pick-model="beta/model-069"]');
			await page.wait('document.querySelector("[data-model-capabilities]")?.textContent.includes("262144")');
			assert.match(
				String(await page.evaluate('document.querySelector("[data-model-capabilities]").textContent')),
				/8192/,
			);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-model-capabilities]").textContent')),
				/image/i,
			);
			await selectOption(page, '[aria-label="Reasoning effort"]', "high");
			await page.resize({ width: 360, height: 600 });
			await settleFrontend(page);
			assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
			await page.click("[data-model-apply]");
			await page.wait(
				'!document.querySelector("[data-model-search]") && document.querySelector("[data-action=model]")?.textContent.includes("model-069")',
			);
			assert.equal(f.requests.length, 0, "selection and registry reads do not generate model work");
			await page.type("textarea[name=message]", "NATIVE-MODEL-BROWSER");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".pocket-receipt")?.dataset.receiptStatus === "done"');
			assert.equal(f.requests.length, 1);
			assert.equal(f.requests[0].model, "model-069");
			assert.equal(f.requests[0].reasoning_effort, "high");
			assert.equal(f.authorization[0], "Bearer local-beta-secret");
			assert.deepEqual(f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await source?.close();
			await f.close();
		}
	},
);

// A picker-only draft or a creation payload which drops thinking must not pass.
test(
	"native model creation preserves staged reasoning through the actual request",
	{ timeout: 45000 },
	async () => {
		const { f, agentDir } = await isolated();
		let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await configuration(agentDir, f.endpoint);
			source = await openProductModels({ agentDir, cwd: f.cwd });
			app = await startPocket({
				owner: "Owner",
				modelConfiguration: source,
				runtime: {
					cwd: f.cwd,
					dataDir: f.dataDir,
					models: source.models,
					model: "alpha/reasoner",
					limits: runtimeLimits,
				},
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(f.root, "native-creation-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector(".app-shell")');
			await settleFrontend(page);
			await page.click('.primary-nav [data-action="new-conversation"]');
			await page.wait('document.querySelector("[data-creation-form]")');
			await page.type('[data-creation-form] [name="name"]', "Reasoned creation");
			await page.click('[data-action="creation-model"]');
			await page.wait('document.querySelector("[data-model-search]")');
			await page.type("[data-model-search]", "beta/model-069", { replace: true });
			await page.wait(`document.querySelector('[data-pick-model="beta/model-069"]')`);
			await page.click('[data-pick-model="beta/model-069"]');
			await selectOption(page, '[aria-label="Reasoning effort"]', "high");
			await page.click("[data-model-apply]");
			await page.wait('!document.querySelector("[data-model-search]")');
			await page.click('[data-action="creation-model"]');
			await page.wait('document.querySelector("[data-model-search]")');
			await page.type("[data-model-search]", "beta/model-069", { replace: true });
			await page.wait('document.querySelector("[data-model-capabilities]")');
			assert.equal(
				await page.evaluate(`document.querySelector('[aria-label="Reasoning effort"]').value`),
				"high",
			);
			await page.key("Escape");
			await page.click("[data-create-confirm]");
			await page.wait(
				'!document.querySelector("[data-creation-form]") && document.querySelector("[data-action=send]")?.disabled === false',
			);
			assert.equal(f.requests.length, 0);
			await page.type("textarea[name=message]", "CREATION-KEEPS-THINKING");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".pocket-receipt")?.dataset.receiptStatus === "done"');
			assert.equal(f.requests.length, 1);
			assert.equal(f.requests[0].model, "model-069");
			assert.equal(f.requests[0].reasoning_effort, "high");
			assert.equal(f.authorization[0], "Bearer local-beta-secret");
			assert.deepEqual(f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await source?.close();
			await f.close();
		}
	},
);
