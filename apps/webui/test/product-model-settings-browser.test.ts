import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startPocket } from "../src/bootstrap.ts";
import { openProductModels } from "../src/product-models.ts";
import { runtimeLimits } from "../../../packages/agent/test/runtime-fixture.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend } from "./frontend-controls.ts";

// Removing the native settings entry, storing credentials in the workspace, or
// automatically replaying a lost answer must fail against the real Pi auth file.
for (const delivery of ["observed", "lost"] as const) {
	test(
		`native provider settings retain the original authentication when answer delivery is ${delivery}`,
		{ timeout: 45000 },
		async () => {
			const { f, agentDir } = await isolated();
			let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
			let app: Awaited<ReturnType<typeof startPocket>> | undefined;
			let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			try {
				await configuration(agentDir, f.endpoint);
				await writeFile(join(agentDir, "auth.json"), "{}\n");
				source = await openProductModels({ agentDir, cwd: f.cwd });
				app = await startPocket({
					owner: "Owner",
					modelConfiguration: source,
					runtime: {
						cwd: f.cwd,
						dataDir: f.dataDir,
						models: source.models,
						model: "",
						limits: runtimeLimits,
					},
					initial: [{ name: "No model yet", profile: "default" }],
				});
				assert.ok(app.initialOwner);
				const sessionId = app.runtime.view().sessionId;
				browser = await ownedBrowser(join(f.root, "provider-settings-browser"));
				const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				await settleFrontend(page);
				await page.click('.sidebar-footer [aria-label="Settings"]');
				await page.wait('document.querySelector("[data-settings-page=models]")');
				await page.click("[data-settings-page=models]");
				await page.wait('document.querySelector("[data-models-path]")');
				assert.equal(
					await page.evaluate('document.querySelector("[data-models-path]").textContent'),
					join(agentDir, "models.json"),
				);
				if (delivery === "lost") {
					await page.resize({ width: 360, height: 600 });
					await settleFrontend(page);
					assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
					assert.equal(
						await page.evaluate(
							'document.querySelector("[data-models-path]").getBoundingClientRect().right <= innerWidth',
						),
						true,
						"native file paths must remain visible in the narrow settings page",
					);
				}
				await page.type("[data-provider-search]", "beta");
				await page.wait(`document.querySelector('[data-provider-login="beta:api_key"]')`);
				await page.evaluate(`(() => {
				const original = globalThis.fetch;
				globalThis.__authStarts = 0; globalThis.__authAnswers = 0;
				globalThis.fetch = async (...args) => {
					const op = typeof args[1]?.body === "string" ? JSON.parse(args[1].body).command?.op : undefined;
					if (op === "auth.start") globalThis.__authStarts++;
					if (op === "auth.answer") globalThis.__authAnswers++;
					const response = await original(...args);
					if (${JSON.stringify(delivery)} === "lost" && op === "auth.answer" && globalThis.__authAnswers === 1) throw new Error("Controlled response loss after real dispatch");
					return response;
				};
			})()`);
				await page.click('[data-provider-login="beta:api_key"]');
				await page.wait('document.querySelector("[data-native-auth-answer]")');
				assert.equal(
					await page.evaluate('document.querySelector("[data-native-auth-answer]").type'),
					"password",
				);
				await page.type("[data-native-auth-answer]", "browser-native-key-private");
				await page.click("[data-native-auth-submit]");
				if (delivery === "lost") {
					await page.wait('document.querySelector("[data-native-auth-unconfirmed]")');
					await page.click("[data-native-auth-inspect]");
				}
				await page.wait('document.querySelector("[data-native-auth-phase=complete]")');
				assert.equal(
					JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")).beta.key,
					"browser-native-key-private",
				);
				assert.equal(await page.evaluate("globalThis.__authStarts"), 1);
				assert.equal(await page.evaluate("globalThis.__authAnswers"), 1);
				assert.doesNotMatch(
					String(
						await page.evaluate(
							"JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, dom: document.body.innerHTML })",
						),
					),
					/browser-native-key-private/,
				);
				assert.equal(app.runtime.view().sessionId, sessionId);
				assert.equal(
					f.requests.length,
					0,
					"provider configuration with no selected model does not generate work",
				);
				assert.deepEqual(f.errors, []);
			} finally {
				await browser?.close();
				await app?.close();
				await source?.close();
				await f.close();
			}
		},
	);
}
