import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	AssistantEntry,
	ToolResultEntry,
	LiveDoc,
	createSession,
	type ConversationId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend } from "./frontend-controls.ts";

async function settleReaderControl(
	page: Awaited<ReturnType<Awaited<ReturnType<typeof ownedBrowser>>["page"]>>,
	selector: string,
) {
	await page.evaluate(
		`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center",inline:"nearest",behavior:"instant"})`,
	);
	let previous = "",
		stable = 0;
	for (let frame = 0; frame < 60; frame++) {
		const value = await page.evaluate(
			`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||element.disabled)return null;const rect=element.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return element.contains(hit)&&rect.width&&rect.height?[rect.x,rect.y,rect.width,rect.height,document.querySelector(".conversation-scroll").scrollTop]:null;})()`,
		);
		const token = JSON.stringify(value);
		stable = value !== null && token === previous ? stable + 1 : 0;
		if (stable >= 3) return;
		previous = token;
		await page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
	}
	throw Error("Original reader control geometry did not settle");
}

test(
	"lazy browser: folded tool keeps no body/media DOM, expanded original is ranged and line-virtualized, collapse releases nodes",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			const setup = await startPocket({
				runtime: m.config,
				owner: "Owner",
				initial: [{ name: "Lazy original", profile: "default" }],
			});
			const ref = setup.runtime.view().conversations.find((ref) => ref.key !== "root")!;
			const file = setup.runtime.view().sessionFile;
			const token = setup.initialOwner!.token;
			await setup.close();
			const session = createSession(await openNodeSqliteStorage(file));
			try {
				await session.commit(async (tx) => {
					const id = Number(ref.conversationId) as ConversationId;
					await tx.appendEntry(AssistantEntry, id, {
						model: [
							{
								role: "assistant",
								content: [
									{
										type: "toolCall",
										id: "call-lazy",
										name: "large_tool",
										arguments: { path: "synthetic.txt", text: "ARGUMENT-BODY\n".repeat(2000) },
									},
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
								timestamp: 1,
							},
						],
					});
					await tx.appendEntry(ToolResultEntry, id, {
						model: [
							{
								role: "toolResult",
								toolCallId: "call-lazy",
								toolName: "large_tool",
								content: [
									{
										type: "text",
										text: Array.from({ length: 20000 }, (_, index) => "ORIGINAL-LINE-" + index).join("\n"),
									},
									{
										type: "image",
										mimeType: "image/png",
										data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAfYAAAAASUVORK5CYII=",
									},
								],
								isError: true,
								timestamp: 2,
							},
						],
						data: { diagnostics: [] },
					});
				}, BACKGROUND_CONTEXT);
			} finally {
				await session.close(BACKGROUND_CONTEXT);
			}
			app = await startPocket({
				runtime: { ...m.config, reopenSessionFile: file },
				owner: "Owner",
				initial: [{ name: "Lazy original", profile: "default" }],
			});
			browser = await ownedBrowser(join(m.f.root, "lazy-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + token);
			await page.wait('document.querySelector("[data-action=signin]") !== null');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]") !== null');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-call-id=call-lazy]") !== null');
			const card = '[data-call-id="call-lazy"]';
			assert.equal(
				await page.evaluate(
					`document.querySelector('${card}').querySelectorAll('pre,img,[data-content-line]').length`,
				),
				0,
				"folding must omit body nodes, not just hide them",
			);
			await page.evaluate(
				`document.querySelector(${JSON.stringify(card)}).addEventListener("toggle",async()=>{await Promise.resolve();await Promise.resolve();const readers=[...document.querySelectorAll("[data-content-reader]")];globalThis.__initialReaderCommit={count:readers.length,blocked:readers.map(node=>node.querySelector("[data-content-more]")?.disabled)};},{once:true})`,
			);
			await page.click(card + " > summary");
			await page.wait("globalThis.__initialReaderCommit !== undefined");
			assert.deepEqual(
				await page.evaluate("globalThis.__initialReaderCommit"),
				{ count: 2, blocked: [true, true] },
				"A fresh reader starts its first range before advertising another enabled range command",
			);
			await page.evaluate("delete globalThis.__initialReaderCommit");
			await page.wait('document.querySelector("[data-content-reader]") !== null');
			await page.wait('document.querySelector("[data-content-line]") !== null');
			assert.ok(await page.evaluate('document.querySelectorAll("[data-content-line]").length <= 400'));
			assert.ok(
				await page.evaluate(
					'document.querySelector("[data-content-reader]").textContent.includes("ORIGINAL-LINE") || document.querySelector("[data-content-reader]").textContent.includes("ARGUMENT-BODY")',
				),
			);
			const output = card + " [data-content-reader]:has([data-tool-output])";
			await page.wait(
				`document.querySelector(${JSON.stringify(output + " [data-original-query]")}) !== null`,
			);
			await page.type(output + " [data-original-query]", "ORIGINAL-LINE-19000");
			await settleReaderControl(page, output + " [data-original-find]");
			await page.click(output + " [data-original-find]", { scroll: false });
			await page.wait(
				`document.querySelector(${JSON.stringify(output + " [data-original-match]")})?.textContent.includes("Found")`,
			);
			assert.ok(
				await page.evaluate(
					'[...document.querySelectorAll("[data-content-line]")].some(node => node.textContent.includes("ORIGINAL-LINE-19000"))',
				),
			);
			assert.ok(await page.evaluate('document.querySelectorAll("[data-content-line]").length <= 400'));
			await page.type(output + " [data-original-query]", "ORIGINAL-LINE-1", { replace: true });
			await settleReaderControl(page, output + " [data-original-find]");
			await page.click(output + " [data-original-find]", { scroll: false });
			await page.wait(
				`document.querySelector(${JSON.stringify(output + " [data-original-match]")})?.textContent.includes("range 0–")`,
			);
			await page.type(output + " [data-original-query]", "ORIGINAL-LINE-0", { replace: true });
			await settleReaderControl(page, output + " [data-original-find]");
			await page.click(output + " [data-original-find]", { scroll: false });
			await page.wait(
				`document.querySelector(${JSON.stringify(output + " [data-original-match]")})?.textContent.includes("Found")`,
			);
			assert.ok(
				await page.evaluate(
					'[...document.querySelectorAll("[data-content-line]")].some(node => node.textContent.includes("ORIGINAL-LINE-0"))',
				),
				"changing the literal query starts at decoded character zero of archive range zero",
			);
			await page.type(output + " [data-original-query]", "literal-not-in-this-original", { replace: true });
			await page.key("Enter");
			await page.wait(
				`document.querySelector(${JSON.stringify(output + " [data-original-match]")})?.textContent.includes("Not found")`,
			);
			await page.type(output + " [data-original-query]", "ORIGINAL-LINE-2", { replace: true });
			await page.key("Enter");
			await page.wait(
				`document.querySelector(${JSON.stringify(output + " [data-original-match]")})?.textContent.includes("Found")`,
			);
			assert.equal(
				await page.evaluate(
					`document.querySelector(${JSON.stringify(output)}).textContent.includes("ORIGINAL-LINE-2")`,
				),
				true,
				"Enter performs the literal search without sending a model input",
			);
			await page.resize({ width: 390, height: 844 });
			await settleFrontend(page);
			const touch = await page.evaluate(
				`(()=>{const body=document.querySelector(${JSON.stringify(output)}),field=body.querySelector("[data-original-query]");return {font:parseFloat(getComputedStyle(field).fontSize),fieldHeight:field.getBoundingClientRect().height,buttons:[...body.querySelectorAll(".pill-btn")].map(node=>node.getBoundingClientRect().height),width:document.documentElement.scrollWidth,viewport:innerWidth}})()`,
			);
			assert.ok(touch && typeof touch === "object");
			assert.ok(
				"font" in touch &&
					typeof touch.font === "number" &&
					"fieldHeight" in touch &&
					typeof touch.fieldHeight === "number" &&
					touch.font >= 16 &&
					touch.fieldHeight >= 44,
				"mobile original search is readable and touch-sized",
			);
			assert.ok(
				"buttons" in touch &&
					Array.isArray(touch.buttons) &&
					touch.buttons.length > 0 &&
					touch.buttons.every((height: unknown) => typeof height === "number" && height >= 44),
				"body controls use at least 44 px mobile targets",
			);
			assert.ok(
				"width" in touch &&
					typeof touch.width === "number" &&
					"viewport" in touch &&
					typeof touch.viewport === "number" &&
					touch.width <= touch.viewport + 1,
				"reading a large original does not widen the mobile document",
			);
			assert.equal(await page.evaluate('document.querySelector("[data-media-reader]") === null'), true);
			await page.click(card + " [data-image-disclosure] > summary");
			await page.wait('document.querySelector("[data-media-reader] img")?.naturalWidth === 1');
			await page.click(card + " > summary");
			await page.wait(`document.querySelector('${card}').querySelector('[data-content-reader]') === null`);
			assert.equal(
				await page.evaluate(
					`document.querySelector('${card}').querySelectorAll('pre,img,[data-content-line]').length`,
				),
				0,
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);

test(
	"lazy browser: a large in-flight argument stays a preview and source capture omissions remain explicit",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture({ observation: "lazy" });
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			const setup = await startPocket({
				runtime: m.config,
				owner: "Owner",
				initial: [{ name: "Live preview", profile: "default" }],
			});
			const ref = setup.runtime.view().conversations.find((item) => item.key !== "root")!;
			const file = setup.runtime.view().sessionFile;
			const token = setup.initialOwner!.token;
			await setup.close();
			const session = createSession(await openNodeSqliteStorage(file));
			try {
				await session.commit(async (tx) => {
					const live = await tx.doc(LiveDoc, Number(ref.conversationId) as ConversationId);
					live.generation = {
						attempt: 1,
						message: {
							role: "assistant",
							api: "openai-completions",
							provider: "seed",
							model: "seed",
							timestamp: 1,
							stopReason: "toolUse",
							usage: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 0,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							},
							content: [
								{
									type: "toolCall",
									id: "call-live-preview",
									name: "large_tool",
									arguments: {
										content: "ARGS-BROWSER-FIRST\n" + "x".repeat(768 * 1024) + "ARGS-BROWSER-LAST",
									},
								},
							],
						},
					};
					live.tools = [
						{
							callId: "call-live-preview",
							name: "large_tool",
							status: "running",
							output: "RETAINED-LIVE-OUTPUT",
							droppedBytes: 1234,
							droppedLines: 7,
						},
					];
				}, BACKGROUND_CONTEXT);
			} finally {
				await session.close(BACKGROUND_CONTEXT);
			}
			app = await startPocket({
				runtime: { ...m.config, reopenSessionFile: file },
				owner: "Owner",
				initial: [{ name: "Live preview", profile: "default" }],
			});
			browser = await ownedBrowser(join(m.f.root, "live-preview-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + token);
			await page.wait('document.querySelector("[data-action=signin]") !== null');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]") !== null');
			await page.click("[data-conversation]");
			const card = '[data-call-id="call-live-preview"]';
			await page.wait(`document.querySelector(${JSON.stringify(card)}) !== null`);
			assert.equal(
				await page.evaluate(
					`document.querySelector(${JSON.stringify(card)}).querySelectorAll("pre,img,[data-content-line]").length`,
				),
				0,
			);
			await page.click(card + " > summary");
			await page.wait(
				`document.querySelector(${JSON.stringify(card + " [data-tool-body]")})?.textContent.includes("ARGS-BROWSER-FIRST")`,
			);
			const text = await page.evaluate(
				`document.querySelector(${JSON.stringify(card + " [data-tool-body]")}).textContent`,
			);
			assert.equal(typeof text, "string");
			assert.ok(String(text).includes("ARGS-BROWSER-LAST"));
			assert.ok(
				String(text).includes("Live arguments preview; original references appear after publication"),
			);
			assert.ok(String(text).includes("1234 bytes / 7 lines"));
			assert.ok(Buffer.byteLength(String(text)) < 16 * 1024);
			const argumentReader = card + " [data-content-reader]";
			await page.type(argumentReader + " [data-original-query]", "ARGS-BROWSER-FIRST");
			await page.click(argumentReader + " [data-original-find]");
			await page.wait(
				`document.querySelector(${JSON.stringify(argumentReader + " [data-original-match]")})?.textContent.startsWith("Found")`,
			);
			assert.equal(
				await page.evaluate(
					`document.querySelector(${JSON.stringify(argumentReader + " [data-original-match]")}).textContent`,
				),
				"Found in this preview.",
			);
			// The native source contains this run; the bounded preview deliberately does not.
			await page.type(argumentReader + " [data-original-query]", "x".repeat(300));
			await page.click(argumentReader + " [data-original-find]");
			await page.wait(
				`document.querySelector(${JSON.stringify(argumentReader + " [data-original-match]")})?.textContent.startsWith("Not found")`,
			);
			assert.equal(
				await page.evaluate(
					`document.querySelector(${JSON.stringify(argumentReader + " [data-original-match]")}).textContent`,
				),
				"Not found in this preview; the complete original was not searched.",
				"a clipped preview cannot establish absence from the native source",
			);
			assert.equal(
				await page.evaluate(
					`document.querySelector(${JSON.stringify(argumentReader + " [data-content-copy]")}).textContent.trim()`,
				),
				"Copy preview",
			);
			assert.equal(
				await page.evaluate(
					`document.querySelector(${JSON.stringify(argumentReader + " [data-original-query]")}).getAttribute("aria-label")`,
				),
				"Find literal text in preview",
			);
			assert.equal(
				await page.evaluate(
					`document.querySelectorAll(${JSON.stringify(argumentReader + " [data-content-download]")}).length`,
				),
				0,
				"unpublished live content does not acquire an original-content capability",
			);
			await page.click(card + " > summary");
			await page.wait(`document.querySelector(${JSON.stringify(card + " [data-tool-body]")}) === null`);
			assert.equal(m.f.requests.length, 0, "passive committed live state never schedules a model or tool");
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
