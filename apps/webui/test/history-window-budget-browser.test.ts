import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, UserEntry, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"history byte window: eviction is explicit and returning to the native latest window does not infer, delete or send history",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: m.config,
				owner: "Owner",
				initial: [{ name: "Byte window", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			const token = app.initialOwner.token,
				ref = app.runtime.view().conversations.find((row) => row.key !== "root")!,
				file = app.runtime.view().sessionFile;
			await app.close();
			app = undefined;
			const session = createSession(await openNodeSqliteStorage(file));
			let latestId = "";
			try {
				assert.match(ref.conversationId, /^\d+$/);
				const id = Number(ref.conversationId);
				assert.ok(Number.isSafeInteger(id) && id > 0);
				await session.commit(async (tx) => {
					for (let index = 0; index < 1600; index++) {
						const entry = await tx.appendEntry(UserEntry, id as ConversationId, {
							model: [
								{
									role: "user",
									content: "WINDOW-CANARY-" + index + "\n" + "archive-text-".repeat(2600),
									timestamp: index,
								},
							],
						});
						latestId = String(entry.id);
					}
				}, BACKGROUND_CONTEXT);
			} finally {
				await session.close(BACKGROUND_CONTEXT);
			}
			app = await startPocket({
				runtime: { ...m.config, reopenSessionFile: file },
				owner: "Owner",
				initial: [{ name: "Byte window", profile: "default" }],
			});
			browser = await ownedBrowser(join(m.f.root, "history-byte-budget-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + token);
			await page.wait('document.querySelector("[data-action=signin]") !== null');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]") !== null');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=show-earlier]") !== null');
			let pages = 0;
			while (await page.evaluate('Boolean(document.querySelector("[data-action=show-earlier]"))')) {
				assert.ok(++pages <= 80, "a finite native ledger must advance rather than repeat its cursor");
				const cursor = await page.evaluate(
					'document.querySelector("[data-action=show-earlier]").dataset.historyBefore',
				);
				await page.click("[data-action=show-earlier]");
				await page.wait(
					'!document.querySelector("[data-action=show-earlier]") || document.querySelector("[data-action=show-earlier]").dataset.historyBefore !== ' +
						JSON.stringify(cursor),
				);
			}
			assert.equal(
				await page.evaluate('Boolean(document.querySelector("[data-history-unloaded]"))'),
				true,
				"byte eviction must be visible, not silently presented as the full visited archive",
			);
			assert.ok(
				await page.evaluate('document.querySelectorAll("[data-virtual-key]").length < 80'),
				"visited rows do not become cumulative DOM",
			);
			const bytes = await page.evaluate(
				'Number(document.querySelector("[data-history-cache-bytes]").dataset.historyCacheBytes)',
			);
			assert.ok(
				typeof bytes === "number" && bytes > 0 && bytes <= 4 * 1024 * 1024,
				"preview memory remains inside the configured byte window",
			);
			await page.click("[data-action=history-latest]");
			const latestSelector = '[data-entry="' + latestId + '"]';
			await page.wait(
				'document.querySelector("[data-virtual-history]")?.dataset.following === "true" && document.querySelector(' +
					JSON.stringify(latestSelector) +
					") !== null",
			);
			assert.equal(await page.evaluate('Boolean(document.querySelector("[data-history-unloaded]"))'), false);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
