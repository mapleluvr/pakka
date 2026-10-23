import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { conversationAction, openConversationMenu } from "./frontend-controls.ts";

for (const lost of ["before-send", "after-commit"])
	test(
		`WebUI metadata browser lost ${lost}: closed/reopened sheet only reads original result, never repeats or replaces the mutation`,
		{ timeout: 30000 },
		async () => {
			const m = await runtimeFixture();
			await m.runtime.close();
			let app: Awaited<ReturnType<typeof startPocket>> | undefined,
				browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			try {
				app = await startPocket({
					runtime: { ...m.config, dataDir: join(m.f.root, "lost-metadata") },
					owner: "Owner",
					initial: [{ name: "Original", profile: "default" }],
				});
				assert.ok(app.initialOwner);
				const catalog = app.runtime.catalog({
						namespace: "pocket.workspace",
						maxDeliveries: 512,
						maxPending: 32,
					}),
					originalVersion = (await catalog.snapshot()).version;
				browser = await ownedBrowser(join(m.f.root, "lost-browser"));
				const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				await page.click("[data-conversation]");
				await openConversationMenu(page);
				// Transport-fault injection only. The actual product server and persistent writes remain unchanged.
				await page.evaluate(`(()=>{const real=window.fetch;let lose=true;window.qaRequests=[];window.fetch=async(input,init)=>{
				let command;try{command=JSON.parse(init?.body).command;}catch{}
				if(command)window.qaRequests.push(command.op);
				if(lose&&command?.op==='conversation.set'){
					lose=false;
					if(${JSON.stringify(lost)}==='after-commit'){const response=await real(input,init);await response.text();}
					throw new TypeError('simulated lost transport');
				}
				return real(input,init);
			};})()`);
				await conversationAction(page, "conversation");
				await page.wait('document.querySelector("input[name=conversationName]")');
				await page.type("input[name=conversationName]", "Recovered title", { replace: true });
				await page.click("[data-action=rename]");
				await page.wait('document.querySelector("[data-action=reconcile-original]")?.disabled===false');
				assert.equal(await page.evaluate('document.querySelector("[data-action=rename]").disabled'), true);
				await page.click("[aria-label='Close conversation details']");
				await page.wait('!document.querySelector("[role=dialog]")');
				await conversationAction(page, "conversation");
				await page.wait('document.querySelector("[data-action=reconcile-original]")?.disabled===false');
				await page.click("[data-action=reconcile-original]");
				if (lost === "after-commit") {
					await page.wait(
						'!document.querySelector("[role=dialog]") && document.querySelector(".pocket-title").textContent.includes("Recovered title")',
					);
					assert.equal((await catalog.snapshot()).version, originalVersion + 1);
				} else {
					await page.wait(
						'document.querySelector("[role=dialog]")?.textContent.includes("Nothing was replayed")',
					);
					assert.equal(await page.evaluate('document.querySelector("[data-action=rename]").disabled'), true);
					assert.equal((await catalog.snapshot()).version, originalVersion);
				}
				const requests = (await page.evaluate("window.qaRequests")) as string[];
				assert.equal(requests.filter((op) => op === "conversation.set").length, 1);
				assert.equal(requests.filter((op) => op === "conversation.lookup").length, 1);
				assert.equal(m.f.requests.length, 0);
			} finally {
				await browser?.close();
				await app?.close();
				await m.f.close();
			}
		},
	);
