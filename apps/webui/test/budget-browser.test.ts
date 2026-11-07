import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createRuntime } from "@pakka/agent";
import { startPocket } from "../src/bootstrap.ts";
import { runtimeFixture, runtimeLimits } from "../../../packages/agent/test/runtime-fixture.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, type FrontendPage } from "./frontend-controls.ts";

async function openBudget(page: FrontendPage) {
	await settleFrontend(page);
	await page.click('.sidebar-footer [aria-label="Settings"]');
	await page.wait('document.querySelector("[data-settings-page=appearance]")');
	assert.equal(
		await page.evaluate('Boolean(document.querySelector("[data-settings-page=budget]"))'),
		true,
		"budget management is available without a native model configuration loader",
	);
	await page.click("[data-settings-page=budget]");
}

// Dropping spending, retrying a lost write, or rebasing a stale draft silently
// must fail on the actual policy/audit and the reopened native Session.
for (const want of [
	{ delivery: "observed", limit: 2, version: 1, requests: 1 },
	{ delivery: "lost", limit: 2, version: 1, requests: 1 },
	{ delivery: "conflict", limit: 4, version: 2, requests: 2 },
] as const)
	test(
		`budget UI preserves consumed work and original identity after ${want.delivery} delivery`,
		{ timeout: 45000 },
		async () => {
			const m = await runtimeFixture({}, { ...runtimeLimits, maxPrimaryAttempts: 1 });
			const config = { ...m.config, dataDir: join(m.f.root, "budget-product") };
			let app: Awaited<ReturnType<typeof startPocket>> | undefined;
			let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
			try {
				await m.runtime.close();
				app = await startPocket({ runtime: config, owner: "Owner" });
				await app.runtime
					.root()
					.connect("budget-fixture-user", ["input.submit"])
					.submit({ key: "initial-work", text: "ONE ORIGINAL CALL" });
				await app.runtime.waitForIdle();
				const before = app.runtime.view();
				assert.equal(before.budget.primaryAttempts, 1);
				assert.ok(app.initialOwner);
				browser = await ownedBrowser(join(m.f.root, "budget-browser"));
				const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector(".app-shell")');
				await openBudget(page);
				await page.wait('document.querySelector("[data-budget-version]")?.textContent === "0"');
				assert.deepEqual(
					await page.evaluate(
						'(() => { const select = document.querySelector("[data-budget-session]"); return { value: select.value, label: select.selectedOptions[0]?.textContent }; })()',
					),
					{ value: before.sessionId, label: "Workspace Session" },
					"the policy being edited has a visible parent even when the bootstrap Session has no user Conversations",
				);
				assert.equal(
					await page.evaluate('document.querySelector("[data-budget-primary-spent]").textContent'),
					"1",
				);
				await page.type('[name="maxPrimaryAttempts"]', "2", { replace: true });
				await page.type('[name="budgetReason"]', "Continue original Session", { replace: true });
				if (want.delivery === "conflict")
					await app.runtime.changeBudget(
						{
							actorId: "other-admin",
							requestId: "other-top-up",
							expectedVersion: 0,
							limits: { ...runtimeLimits, maxPrimaryAttempts: 3 },
							reason: "Another authorized update",
						},
						() => {},
					);
				await page.evaluate(`(() => {
			const original = globalThis.fetch;
			globalThis.__budgetWrites = 0;
			globalThis.fetch = async (...args) => {
				const body = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : undefined;
				if (body?.command?.op === "budget.change") globalThis.__budgetWrites++;
				const response = await original(...args);
				if (${JSON.stringify(want.delivery)} === "lost" && body?.command?.op === "budget.change" && globalThis.__budgetWrites === 1) throw new Error("Controlled response loss after actual policy dispatch");
				return response;
			};
		})()`);
				await page.click("[data-budget-apply]");
				if (want.delivery === "lost") {
					await page.wait('document.querySelector("[data-budget-unconfirmed]")');
					const original = await page.evaluate(
						'document.querySelector("[data-budget-original-request]").textContent',
					);
					await page.click(".back-to-app");
					await openBudget(page);
					await page.wait('document.querySelector("[data-budget-unconfirmed]")');
					assert.equal(
						await page.evaluate('document.querySelector("[data-budget-original-request]").textContent'),
						original,
					);
					assert.equal(await page.evaluate('document.querySelector("[data-budget-apply]").disabled'), true);
					await page.click("[data-budget-inspect]");
				}
				if (want.delivery === "conflict") {
					await page.wait('document.querySelector("[data-budget-denied]")');
					assert.equal(
						await page.evaluate('Boolean(document.querySelector("[data-budget-unconfirmed]"))'),
						false,
					);
					await page.click("[data-budget-refresh]");
					await page.wait('document.querySelector("[data-budget-version]")?.textContent === "1"');
					await page.type('[name="maxPrimaryAttempts"]', "4", { replace: true });
					await page.type('[name="budgetReason"]', "Reviewed current policy", { replace: true });
					await page.click("[data-budget-apply]");
				}
				await page.wait('document.querySelector("[data-budget-saved]")');
				assert.equal(await page.evaluate("globalThis.__budgetWrites"), want.requests);
				assert.equal(app.runtime.view().limits.maxPrimaryAttempts, want.limit);
				assert.equal(app.runtime.view().budget.primaryAttempts, 1);
				assert.equal(app.runtime.view().sessionId, before.sessionId);
				const history = await app.runtime.budgetHistory({}, () => {});
				assert.equal(history.items.length, want.version);
				assert.equal(history.items[0]?.budget.primaryAttempts, 1);
				assert.equal(history.items[0]?.after.maxPrimaryAttempts, want.limit);
				assert.equal(m.f.requests.length, 1);
				await browser.close();
				browser = undefined;
				await app.close();
				app = undefined;
				reopened = await createRuntime({ ...config, reopenSessionFile: before.sessionFile });
				assert.equal(reopened.view().sessionId, before.sessionId);
				assert.equal(reopened.view().limits.maxPrimaryAttempts, want.limit);
				assert.equal(reopened.view().budget.primaryAttempts, 1);
				assert.equal(m.f.requests.length, 1);
			} finally {
				await browser?.close();
				await app?.close();
				await reopened?.close();
				await m.close();
			}
		},
	);
