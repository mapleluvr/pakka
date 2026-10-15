import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// Assertions cross actual DOM interaction, served JS/Cookie/SSE and a native model tool result, independently observed at provider.
test(
	"Pocket browser: actual adopted workbench, invitation and two isolated users respect live server visibility",
	{ timeout: 45000 },
	async () => {
		let tools = 0;
		const m = await runtimeFixture(
			{
				tools: [
					{
						name: "local_echo",
						description: "Local acceptance tool",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							tools++;
							return "TOOL-CONFIRMED";
						},
					},
				],
			},
			undefined,
			(_, n) => (n === 1 ? { tool: "local_echo" } : { text: "LOCAL-ANSWER" }),
		);
		await m.runtime.close();
		const dir = await mkdtemp(join(process.env.PAKKA_TEST_ARTIFACTS ?? tmpdir(), "pocket-browser-"));
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: m.f.dataDir + "/web" },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(dir, "profile"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await owner.wait('document.querySelector("[data-action=signin]")');
			assert.equal(await owner.evaluate("location.hash"), "");
			await owner.click("[data-action=signin]");
			await owner.wait('document.querySelector("[data-conversation]")');
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("textarea[name=message]")');
			await owner.type("textarea[name=message]", "FROM-ACTUAL-WEB");
			await owner.wait('document.querySelector("[data-action=send]")?.disabled === false');
			await owner.click("[data-action=send]");
			await owner.wait(
				'document.querySelector("main").innerText.includes("LOCAL-ANSWER") && document.querySelector("main").innerText.includes("TOOL-CONFIRMED")',
			);
			assert.equal(tools, 1);
			assert.equal(m.f.requests.length, 2);
			assert.equal(await owner.evaluate('document.cookie.includes("pakka_pocket=")'), false);
			assert.equal(await owner.evaluate('JSON.stringify({...localStorage}).includes("pakka_pocket")'), false);
			const token = /pakka_csrf=([^;]+)/.exec(String(await owner.evaluate("document.cookie")))![1]!;
			assert.ok(token);
			// Use only ordinary UI controls to create an invite with the selected resource scope.
			await owner.click("[data-action=people]");
			await owner.wait('document.querySelector("[data-action=invite]")');
			await owner.click("[data-action=invite]");
			await owner.wait('document.querySelector("input[name=inviteLink]")?.value.includes("#invite=")');
			const link = String(await owner.evaluate('document.querySelector("input[name=inviteLink]").value'));
			const viewer = await browser.page(link, { width: 390, height: 844 });
			await viewer.wait('document.querySelector("[data-action=signin]")');
			await viewer.type("input[name=person]", "Viewer");
			await viewer.click("[data-action=signin]");
			await viewer.wait('document.querySelector("[data-conversation]")');
			await viewer.click('[aria-label="Toggle conversations"]');
			await viewer.click("[data-conversation]");
			await viewer.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(
				await viewer.evaluate('Boolean(document.querySelector("[data-action=send]")?.disabled)'),
				true,
			);
			const stranger = await browser.page(app.http.origin + "/");
			await stranger.wait('document.querySelector("[data-action=signin]")');
			assert.equal(await stranger.evaluate('document.body.innerText.includes("FROM-ACTUAL-WEB")'), false);
			assert.equal(await viewer.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
			await owner.click('[aria-label="Close people"]');
			await mkdir(join(dir, "screenshots"), { recursive: true });
			await writeFile(join(dir, "screenshots", "desktop.png"), await owner.screenshot());
			await writeFile(join(dir, "screenshots", "mobile.png"), await viewer.screenshot());
			await owner.click("[data-action=people]");
			await owner.wait('document.querySelector(".pocket-person-row button")');
			await owner.click(".pocket-person-row button");
			await owner.wait('document.querySelector("[role=dialog]").innerText.includes("Revoked")');
			await viewer.wait('document.querySelector("[data-action=signin]")');
			assert.equal(await viewer.evaluate('document.body.innerText.includes("LOCAL-ANSWER")'), false);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
