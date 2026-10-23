import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketMemory } from "../../server/src/pocket-memory.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceMemoryExtensionRoot, workspaceMemoryService } from "../src/workflows.ts";
import { ownedBrowser } from "./browser.ts";

for (const lost of ["browser-response", "backend-response"] as const) {
	test(
		"WebUI memory recovery: a lost " +
			lost +
			" is resolved from the original committed mutation without another write",
		{ timeout: 30000 },
		async () => {
			const m = await runtimeFixture();
			await m.runtime.close();
			let app: Awaited<ReturnType<typeof startPocket>> | undefined,
				browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined,
				adds = 0;
			try {
				const prepared = createPocketMemory({
					namespace: "recover.memory",
					profiles: ["default"],
					projects: [{ id: "all", name: "Project", resources: "*" }],
				});
				app = await startPocket({
					runtime: {
						...m.config,
						dataDir: join(m.f.root, "memory-recovery"),
						contextSources: [prepared.source],
					},
					owner: "Owner",
					initial: [{ name: "Project", profile: "default" }],
					extensions: [{ root: workspaceMemoryExtensionRoot, facets: ["backend", "client", "webui"] }],
					extensionServices: async (context) => {
						const registration = await workspaceMemoryService(context, prepared);
						return {
							memory: Object.freeze({
								...registration,
								bind(...args: Parameters<typeof registration.bind>) {
									const client = registration.bind(...args);
									return Object.freeze({
										...client,
										async add(input: Parameters<typeof client.add>[0]) {
											const result = await client.add(input);
											adds++;
											if (lost === "backend-response") throw Error("TEST LOST MEMORY HANDLER RESULT");
											return result;
										},
									});
								},
							}),
						};
					},
				});
				assert.ok(app.initialOwner);
				browser = await ownedBrowser(join(m.f.root, "recovery-browser"));
				const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-interface=workspace-memory-memory]")');
				await page.click("[data-interface=workspace-memory-memory]");
				await page.wait('document.querySelector("[data-memory-text]")');
				if (lost === "browser-response")
					await page.evaluate(
						`(()=>{const original=globalThis.fetch;globalThis.__restoreMemoryFetch=()=>{globalThis.fetch=original;};globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&args[1].body.includes('"action":"add"')){const response=await original(...args);await response.arrayBuffer();throw Error('TEST LOST COMMITTED MEMORY RESPONSE');}return original(...args);};})()`,
					);
				await page.type("[data-memory-text]", "RECOVERED-ONCE-MEMORY-" + lost);
				await page.wait('document.querySelector("[data-memory-add]")?.disabled===false');
				await page.click("[data-memory-add]");
				await page.wait('document.querySelector("[data-memory-reconcile]")?.disabled===false');
				assert.equal(adds, 1);
				assert.equal(await page.evaluate('document.querySelector("[data-memory-add]").disabled'), true);
				if (lost === "browser-response") await page.evaluate("globalThis.__restoreMemoryFetch()");
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("textarea[name=message]")');
				await page.click("[data-interface=workspace-memory-memory]");
				await page.wait('document.querySelector("[data-memory-reconcile]")?.disabled===false');
				await page.click("[data-memory-reconcile]");
				await page.wait('!document.querySelector("[data-memory-reconcile]")');
				assert.equal(adds, 1);
				assert.equal(await page.evaluate('document.querySelectorAll("[data-memory-lesson]").length'), 1);
				assert.equal(m.f.requests.length, 0);
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
				await page.type("textarea[name=message]", "ACTUAL-WORK-AFTER-RECOVERY");
				await page.click("[data-action=send]");
				await page.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
				assert.equal(m.f.requests.length, 1);
				assert.ok(JSON.stringify(m.f.requests[0]).includes("RECOVERED-ONCE-MEMORY-" + lost));
				assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			} finally {
				await browser?.close();
				await app?.close();
				await m.close();
			}
		},
	);
}
