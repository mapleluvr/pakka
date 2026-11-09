import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startPocket } from "../src/bootstrap.ts";
import { createLocalProduct } from "../src/product-runtime.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend } from "./frontend-controls.ts";

// Hiding write in prose, exposing only the SDK preset, or ignoring the selected form value each fails a separate oracle.
test(
	"local WebUI creates the selected read-only preset independently of its model",
	{ timeout: 45000 },
	async () => {
		const p = await isolated((_body, n) =>
			n === 1
				? { tool: "read", args: { path: "protected.txt" } }
				: n === 2
					? { tool: "write", args: { path: "protected.txt", content: "WRONG" } }
					: { text: "PRESET-COMPLETE" },
		);
		let options: Awaited<ReturnType<typeof createLocalProduct>> | undefined;
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await configuration(p.agentDir, p.f.endpoint);
			await writeFile(join(p.f.cwd, "protected.txt"), "READ-ONLY-ORACLE");
			options = await createLocalProduct({ cwd: p.f.cwd, dataDir: p.f.dataDir, agentDir: p.agentDir });
			app = await startPocket(options);
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(p.f.root, "preset-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector(".app-shell")');
			await settleFrontend(page);
			await page.click('.primary-nav [data-action="new-conversation"]');
			await page.wait('document.querySelector("[data-creation-form] [name=profile]")');
			assert.deepEqual(
				await page.evaluate(
					'Array.from(document.querySelector("[name=profile]").options, option => option.value)',
				),
				["default", "read-only"],
			);
			await page.type('[data-creation-form] [name="name"]', "Read-only work");
			await page.click("[name=profile]");
			await page.key("Home");
			await page.key("ArrowDown");
			await page.key("Enter");
			await page.resize({ width: 360, height: 600 });
			await settleFrontend(page);
			assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
			await page.click("[data-create-confirm]");
			await page.wait(
				'!document.querySelector("[data-creation-form]") && document.querySelector("textarea[name=message]")',
			);
			const runtime = app.sessions
				.runtimes()
				.find((row) => row.view().conversations.some((ref) => ref.profile === "read-only"));
			assert.ok(runtime, "the default empty workbench creates a real child Session");
			const ref = runtime.view().conversations.find((row) => row.profile === "read-only");
			assert.ok(ref, "the native Conversation, not just the selector, must retain the chosen preset");
			assert.equal((await runtime.configuration(ref)).model, "alpha/reasoner");
			assert.equal(p.f.requests.length, 0);
			await page.type("textarea[name=message]", "Read and attempt to overwrite the protected file");
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".pocket-receipt")?.dataset.receiptStatus === "done"');
			assert.equal(p.f.requests.length, 3);
			assert.match(JSON.stringify(p.f.requests[0]!.tools), /"name":"read"/);
			assert.doesNotMatch(JSON.stringify(p.f.requests[0]!.tools), /"name":"(?:write|edit|powershell|bash)"/);
			assert.match(
				JSON.stringify(p.f.requests[1]!.messages.filter((message) => message.role === "tool")),
				/READ-ONLY-ORACLE/,
			);
			assert.equal(await readFile(join(p.f.cwd, "protected.txt"), "utf8"), "READ-ONLY-ORACLE");
			assert.deepEqual(p.f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await options?.modelConfiguration?.close();
			await p.f.close();
		}
	},
);
