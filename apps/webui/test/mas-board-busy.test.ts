import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { createMas } from "@pakka/mas";
import { masExtensionRoot, masWorkbenchService } from "@pakka/mas-devpack/backend";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred, text } from "../../../packages/agent/test/fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// Human Board commands must enter native steer/follow-up/abort, never a serial prompt substitute.
test(
	"MAS Board: busy native steer/follow-up and confirmed abort keep the persistent member",
	{ timeout: 45000 },
	async (t) => {
		const release = deferred(),
			cancelRelease = deferred();
		let first = true,
			aborting = false;
		const m = await runtimeFixture({}, undefined, async (payload) => {
			if (first) {
				first = false;
				await release.promise;
			} else if (text(payload).includes("BOARD-ABORT") && !aborting) {
				aborting = true;
				await cancelRelease.promise;
			}
			return { text: "BOARD-WORK-DONE" };
		});
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "busy-board-data") },
				owner: "Owner",
				initial: [{ name: "Ordinary", profile: "default" }],
				extensions: [{ root: masExtensionRoot }],
				extensionServices: async (context) => {
					const mas = await createMas({
						runtime: context.runtime,
						namespace: "busy.board",
						maxDeliveries: 16,
						maxPending: 4,
					});
					await mas.bootstrap([{ key: "busy-member", owner: context.ownerId }]);
					await mas.activate();
					return { mas: masWorkbenchService({ ...context, mas }) };
				},
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "busy-board-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-interface=mas-devpack-board]")');
			await page.click("[data-interface=mas-devpack-board]");
			await page.wait('document.querySelector("[data-member=busy-member]")');
			await page.click("[data-member=busy-member]");
			await page.wait('document.querySelector("textarea[name=masMessage]")');
			await page.type("textarea[name=masMessage]", "BOARD-BLOCKED");
			await page.click("[data-mas-send]");
			await page.wait(
				'document.querySelector("textarea[name=masMessage]").value === "" && /placed/.test(document.querySelector("[data-mas-receipt]")?.textContent)',
			);
			await t.waitFor(() => assert.equal(m.f.requests.length, 1), { timeout: 5000, interval: 10 });
			assert.equal(m.f.requests.length, 1);
			assert.equal(
				JSON.stringify(m.f.requests[0]!.tools ?? []).includes("mas_spawn"),
				false,
				"WebUI activation alone installs no Agent tools",
			);
			for (const [mode, message] of [
				["steer", "BOARD-NATIVE-STEER"],
				["followUp", "BOARD-NATIVE-FOLLOWUP"],
			]) {
				const previous = await page.evaluate('document.querySelector("[data-mas-receipt]").textContent');
				await page.evaluate(
					`(()=>{const e=document.querySelector(".mas-member select");e.value=${JSON.stringify(mode)};e.dispatchEvent(new Event("change",{bubbles:true}));})()`,
				);
				await page.type("textarea[name=masMessage]", message!);
				await page.click("[data-mas-send]");
				await page.wait(
					`document.querySelector("textarea[name=masMessage]").value === "" && /queued/.test(document.querySelector("[data-mas-receipt]")?.textContent) && document.querySelector("[data-mas-receipt]").textContent !== ${JSON.stringify(previous)}`,
				);
				assert.equal(m.f.requests.length, 1);
			}
			release.resolve();
			await page.wait('/done/.test(document.querySelector("[data-mas-receipt]")?.textContent)');
			assert.ok(m.f.requests.length >= 2);
			assert.match(JSON.stringify(m.f.requests.slice(1)), /BOARD-NATIVE-STEER/);
			assert.match(JSON.stringify(m.f.requests.slice(1)), /BOARD-NATIVE-FOLLOWUP/);
			const previous = m.f.requests.length;
			await page.evaluate(
				'(()=>{const e=document.querySelector(".mas-member select");e.value="prompt";e.dispatchEvent(new Event("change",{bubbles:true}));})()',
			);
			await page.type("textarea[name=masMessage]", "BOARD-ABORT");
			await page.click("[data-mas-send]");
			await page.wait(
				'document.querySelector("textarea[name=masMessage]").value === "" && /placed/.test(document.querySelector("[data-mas-receipt]")?.textContent)',
			);
			await t.waitFor(() => assert.equal(aborting, true), { timeout: 5000, interval: 10 });
			assert.equal(m.f.requests.length, previous + 1);
			await page.click("[data-mas-abort]");
			await page.wait('/aborted/.test(document.querySelector("[data-mas-receipt]")?.textContent)');
			assert.equal(
				await page.evaluate('document.querySelector("[data-member-phase]").textContent'),
				"active",
			);
			const receiptId = await page.evaluate(
				'document.querySelector("[data-mas-receipt]").getAttribute("data-mas-receipt")',
			);
			assert.equal(typeof receiptId, "string");
			const native = await app.runtime
				.catalog({ namespace: "busy.board", maxDeliveries: 16, maxPending: 4 })
				.receipt(String(receiptId), () => {});
			assert.equal(native.status, "unanswered");
			assert.equal(native.reason, "aborted");
			const runtime = app.runtime;
			const snapshot = await runtime.readConversation(native.target, () => {
				assert.equal(runtime.view().phase, "ready");
			});
			assert.equal(snapshot.live.busy, false);
			cancelRelease.resolve();
			assert.deepEqual(m.f.errors, []);
		} finally {
			release.resolve();
			cancelRelease.resolve();
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
