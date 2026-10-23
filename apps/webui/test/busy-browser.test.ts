import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { inputMode } from "./frontend-controls.ts";

test(
	"WebUI busy browser: after native admission the user can steer and follow up while original inference is blocked",
	{ timeout: 30000 },
	async () => {
		const release = deferred();
		let first = true;
		const m = await runtimeFixture({}, undefined, async () => {
			if (first) {
				first = false;
				await release.promise;
			}
			return { text: "BUSY-ANSWER" };
		});
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: m.f.dataDir + "/busy" },
				owner: "Operator",
				initial: [{ name: "Busy", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-busy-")), "profile"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("textarea")');
			await page.type("textarea", "FIRST-BLOCKED");
			await page.wait('document.querySelector("[data-action=send]")?.disabled === false');
			await page.click("[data-action=send]");
			await page.wait(
				'document.querySelector(".pocket-status")?.textContent === "Working" && document.querySelector("textarea").value === ""',
			);
			for (const [mode, message] of [
				["steer", "NATIVE-STEER"],
				["followUp", "NATIVE-FOLLOWUP"],
			]) {
				await inputMode(page, mode as "steer" | "followUp");
				await page.type("textarea", message!);
				await page.wait('document.querySelector("[data-action=send]")?.disabled === false');
				await page.click("[data-action=send]");
				await page.wait(
					'document.querySelector("textarea").value === "" && /queued/.test(document.querySelector(".pocket-receipt")?.textContent)',
				);
				assert.equal(
					m.f.requests.length,
					1,
					"the input was admitted before the blocked native generation completed",
				);
			}
			release.resolve();
			await page.wait(
				'document.querySelector(".pocket-receipt")?.textContent.startsWith("done") && document.querySelector(".pocket-status")?.textContent === "Ready"',
			);
			assert.ok(m.f.requests.length >= 2);
			assert.match(JSON.stringify(m.f.requests.slice(1)), /NATIVE-STEER/);
			assert.match(JSON.stringify(m.f.requests.slice(1)), /NATIVE-FOLLOWUP/);
			assert.equal(m.f.errors.length, 0);
		} finally {
			release.resolve();
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
