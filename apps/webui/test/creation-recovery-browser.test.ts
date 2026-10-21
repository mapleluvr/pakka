import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

for (const lost of ["before-send", "after-commit"]) {
	test(
		`Home create lost ${lost}: navigation and reconciliation never replace an uncertain admission`,
		{ timeout: 30000 },
		async () => {
			const m = await runtimeFixture();
			await m.runtime.close();
			let app: Awaited<ReturnType<typeof startPocket>> | undefined;
			let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			try {
				app = await startPocket({
					runtime: { ...m.config, dataDir: join(m.f.root, "creation") },
					owner: "Owner",
					initial: [{ name: "Original", profile: "default" }],
				});
				browser = await ownedBrowser(join(m.f.root, "creation-browser"));
				const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner!.token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click('[data-action="signin"]');
				await page.wait('document.querySelector("[data-home-create]")');
				await page.evaluate(
					`(()=>{const real=window.fetch;let lose=true;window.qaRequests=[];window.fetch=async(input,init)=>{let command;try{command=JSON.parse(init?.body).command;}catch{}if(command)window.qaRequests.push(command);if(lose&&command?.op==='create'){lose=false;if(${JSON.stringify(lost)}==='after-commit'){const response=await real(input,init);await response.text();}throw new TypeError('simulated lost create response');}return real(input,init);};})()`,
				);
				await page.type('[aria-label="Conversation name"]', "Uncertain creation");
				await page.click("[data-home-create]");
				await page.wait('document.querySelector("[role=alert]")');
				assert.equal(
					await page.evaluate('document.querySelector("[data-home-create]").disabled'),
					true,
					"unknown creation must not allow a replacement request",
				);
				await page.click("[data-conversation]");
				await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
				await page.click('[data-action="home"]');
				assert.equal(await page.evaluate('document.querySelector("[data-home-create]").disabled'), true);
				await page.click('[data-action="check-creation"]');
				if (lost === "after-commit") {
					await page.wait(
						'document.querySelector(".pocket-title")?.textContent.includes("Uncertain creation")',
					);
					assert.equal(await page.evaluate('document.querySelectorAll("[data-conversation]").length'), 2);
				} else {
					await page.wait(
						'document.querySelector(".creation-recovery")?.textContent.includes("Nothing was replayed")',
					);
					assert.equal(await page.evaluate('document.querySelector("[data-home-create]").disabled'), true);
					assert.equal(await page.evaluate('document.querySelectorAll("[data-conversation]").length'), 1);
				}
				const requests = (await page.evaluate("window.qaRequests")) as { op: string }[];
				assert.equal(requests.filter((c) => c.op === "create").length, 1);
				assert.equal(requests.filter((c) => c.op === "conversation.lookup").length, 1);
				assert.equal(m.f.requests.length, 0);
			} finally {
				await browser?.close();
				await app?.close();
				await m.f.close();
			}
		},
	);
}
