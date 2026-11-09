import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	AssistantEntry,
	ToolResultEntry,
	createSession,
	type ConversationId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { findInConversation } from "./frontend-controls.ts";

async function stableHistoryGeometry(
	page: Awaited<ReturnType<Awaited<ReturnType<typeof ownedBrowser>>["page"]>>,
) {
	let previous = "",
		stable = 0;
	for (let frame = 0; frame < 40; frame++) {
		const current = JSON.stringify(
			await page.evaluate(
				'(()=>{const root=document.querySelector(".conversation-scroll"),list=document.querySelector("[data-virtual-history]");return [root.scrollTop,root.scrollHeight,list.dataset.windowTotal,...[...list.querySelectorAll("[data-virtual-key]")].map(node=>[node.dataset.virtualKey,node.getBoundingClientRect().top,node.getBoundingClientRect().height])]})()',
			),
		);
		const scrolling = await page.evaluate(
			'document.querySelector("[data-virtual-history]")?.dataset.windowScrolling === "true"',
		);
		stable = !scrolling && current === previous ? stable + 1 : 0;
		if (stable >= 2) return;
		previous = current;
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	}
	throw Error("History row geometry did not settle");
}

test(
	"virtual history browser: bounded DOM preserves focused body and remembered expansion across off-screen recycling",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const initial = [{ name: "Virtual history", profile: "default" }];
		try {
			await m.runtime.close();
			const setup = await startPocket({ runtime: m.config, owner: "Owner", initial });
			const ref = setup.runtime.view().conversations.find((item) => item.key !== "root")!;
			const file = setup.runtime.view().sessionFile,
				token = setup.initialOwner!.token;
			await setup.close();
			const session = createSession(await openNodeSqliteStorage(file));
			try {
				await session.commit(async (tx) => {
					const id = Number(ref.conversationId) as ConversationId;
					for (let index = 0; index < 120; index++) {
						await tx.appendEntry(AssistantEntry, id, {
							model: [
								{
									role: "assistant",
									content: [
										{ type: "toolCall", id: "call-" + index, name: "archive_tool", arguments: { index } },
									],
									api: "openai-completions",
									provider: "seed",
									model: "seed",
									usage: {
										input: 0,
										output: 0,
										cacheRead: 0,
										cacheWrite: 0,
										totalTokens: 0,
										cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
									},
									stopReason: "toolUse",
									timestamp: index * 2,
								},
							],
						});
						await tx.appendEntry(ToolResultEntry, id, {
							model: [
								{
									role: "toolResult",
									toolCallId: "call-" + index,
									toolName: "archive_tool",
									content: [{ type: "text", text: "Original result " + index }],
									isError: false,
									timestamp: index * 2 + 1,
								},
							],
							data: { diagnostics: [] },
						});
					}
				}, BACKGROUND_CONTEXT);
			} finally {
				await session.close(BACKGROUND_CONTEXT);
			}
			app = await startPocket({ runtime: { ...m.config, reopenSessionFile: file }, owner: "Owner", initial });
			browser = await ownedBrowser(join(m.f.root, "virtual-history-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + token);
			await page.wait('document.querySelector("[data-action=signin]") !== null');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]") !== null');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-call-id]") !== null');
			await page.evaluate(
				'document.querySelector(".conversation-scroll").scrollTop = document.querySelector(".conversation-scroll").scrollHeight',
			);
			await page.wait('document.querySelector("[data-call-id=call-119]") !== null');
			for (let index = 0; index < 2; index++) {
				const cursor = await page.evaluate(
					'document.querySelector("[data-action=show-earlier]").dataset.historyBefore',
				);
				let anchor: unknown;
				await page.evaluate(
					'document.querySelector("[data-action=show-earlier]").scrollIntoView({block:"center",behavior:"instant"})',
				);
				await stableHistoryGeometry(page);
				await page.click("[data-action=show-earlier]", {
					beforePress: async () => {
						await stableHistoryGeometry(page);
						await page.wait(
							'(()=>{const root=document.querySelector(".conversation-scroll").getBoundingClientRect();return [...document.querySelectorAll("[data-virtual-key]")].some(node=>{const row=node.getBoundingClientRect();return row.top>=root.top&&row.top<root.bottom})})()',
						);
						anchor = await page.evaluate(
							'(()=>{const root=document.querySelector(".conversation-scroll").getBoundingClientRect(),row=[...document.querySelectorAll("[data-virtual-key]")].find(node=>{const box=node.getBoundingClientRect();return box.top>=root.top&&box.top<root.bottom});return {key:row.dataset.virtualKey,top:row.getBoundingClientRect().top}})()',
						);
					},
				});
				await page.wait(
					'document.querySelector("[data-action=show-earlier]").dataset.historyBefore !== ' +
						JSON.stringify(cursor),
				);
				assert.ok(
					anchor &&
						typeof anchor === "object" &&
						"key" in anchor &&
						typeof anchor.key === "string" &&
						"top" in anchor &&
						typeof anchor.top === "number",
				);
				await stableHistoryGeometry(page);
				const position = await page.evaluate(
					'(()=>{const row=[...document.querySelectorAll("[data-virtual-key]")].find(node=>node.dataset.virtualKey===' +
						JSON.stringify(anchor.key) +
						");return row?row.getBoundingClientRect().top:null})()",
				);
				assert.ok(
					typeof position === "number" && Math.abs(position - anchor.top) <= 2,
					"prepending an earlier page preserves the actual visible row: " +
						JSON.stringify({ anchor, position }),
				);
			}
			await page.evaluate(
				'document.querySelector(".conversation-scroll").scrollTop = document.querySelector(".conversation-scroll").scrollHeight',
			);
			await page.wait('document.querySelector("[data-call-id=call-119]") !== null');
			await page.click("[data-call-id=call-119] > summary");
			await page.wait('document.querySelector("[data-call-id=call-119] [data-original-query]") !== null');
			await page.evaluate(
				'window.__focusedOriginal = document.querySelector("[data-call-id=call-119] [data-original-query]"); window.__focusedOriginal.focus()',
			);
			await page.evaluate('document.querySelector(".conversation-scroll").scrollTop = 0');
			await page.wait(
				'document.querySelector("[data-call-id=call-40]") !== null || document.querySelectorAll("[data-call-id]").length > 4',
			);
			assert.equal(
				await page.evaluate(
					"window.__focusedOriginal.isConnected && document.activeElement === window.__focusedOriginal",
				),
				true,
				"scrolling may pin one focused row, not unmount its input",
			);
			assert.ok(
				await page.evaluate('document.querySelectorAll("[data-virtual-key]").length < 80'),
				"visited archive must not become cumulative DOM",
			);
			await page.evaluate('document.querySelector("textarea[name=message]").focus()');
			await page.wait('document.querySelector("[data-call-id=call-119]") === null');
			await page.evaluate(
				'document.querySelector(".conversation-scroll").scrollTop = document.querySelector(".conversation-scroll").scrollHeight',
			);
			await page.wait('document.querySelector("[data-call-id=call-119]") !== null');
			assert.equal(
				await page.evaluate('document.querySelector("[data-call-id=call-119]").open'),
				true,
				"returning to a recycled card restores expansion metadata, not hidden body nodes",
			);
			await findInConversation(page, "Original result 118");
			await page.wait('document.querySelector("[data-call-id=call-118]") !== null');
			assert.equal(
				await page.evaluate('document.querySelectorAll("[data-call-id]").length'),
				1,
				"filtering a loaded result finds its single logical tool card, not an invisible duplicate result row",
			);
			await findInConversation(page, "");
			assert.equal(m.f.requests.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
