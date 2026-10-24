import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	AssistantEntry,
	ToolResultEntry,
	UserEntry,
	createSession,
	type ConversationId,
} from "@earendil-works/pi-durable";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import type { ConversationRef, Receipt } from "../../../packages/agent/src/types.ts";
import type { PocketConversationSource } from "../../server/src/pocket-workspace.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { inputMode } from "./frontend-controls.ts";

type Product = Awaited<ReturnType<typeof startPocket>>;
type Browser = Awaited<ReturnType<typeof ownedBrowser>>;
type Page = Awaited<ReturnType<Browser["page"]>>;
type Fixture = Awaited<ReturnType<typeof runtimeFixture>>;
const allow = () => {};

async function openConversation(app: Product, browser: Browser) {
	assert.ok(app.initialOwner);
	const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
	await page.wait('document.querySelector("[data-action=signin]") !== null');
	await page.click("[data-action=signin]");
	await page.wait('document.querySelector("[data-conversation]") !== null');
	await page.click("[data-conversation]");
	await page.wait('document.querySelector("textarea") !== null');
	await page.wait('document.querySelector("[data-action=send]")?.disabled === false');
	return page;
}

async function send(page: Page, text: string) {
	await page.type("textarea[name=message]", text);
	await page.click("[data-action=send]");
}

async function stopAll(app: Product | undefined, browser: Browser | undefined, fixture: Fixture) {
	await browser?.close();
	await app?.close();
	await fixture.f.close();
}

// Seeding is test setup, not a model-produced-history claim. It uses only public Durable APIs,
// in the isolated fixture directory, after its writer closes. The assertions exercise the ordinary
// reopen -> authorized HTTP/SSE -> browser projection, never a synthetic browser DTO or UI mock.
async function seedHistory(m: Fixture, liveTool?: { execute(): Promise<string> }, endpoint?: string) {
	await m.runtime.close();
	const initial = [{ name: "Seeded history", profile: "default" }] as const;
	const profile = {
		...m.config,
		...(endpoint ? { endpoint } : {}),
		tools: [
			{
				name: "live_tool",
				description: "A different call reusing the inherited provider id",
				parameters: { type: "object", properties: {} },
				execute: liveTool?.execute ?? (async () => "LIVE-RESULT"),
			},
		],
	};
	const before = await startPocket({
		runtime: { ...profile, dataDir: join(m.f.root, "seed-product") },
		owner: "Operator",
		initial,
	});
	const ref = before.runtime.view().conversations.find((ref) => ref.key !== "root")!;
	const token = before.initialOwner!.token;
	const sessionFile = before.runtime.view().sessionFile;
	const directory = join(sessionFile, "..");
	await before.close();
	const storage = await openNodeJsonlStorage(directory, BACKGROUND_CONTEXT, { fsync: true });
	const session = createSession(storage);
	let resultEntryId = "";
	try {
		await session.commit(async (tx) => {
			const id = Number(ref.conversationId) as ConversationId;
			await tx.appendEntry(UserEntry, id, {
				model: [
					{
						role: "user",
						content: [
							{ type: "text", text: "HISTORY-SEED" },
							{ type: "image", data: "U0VFRUVELUFWSUY=", mimeType: "image/avif" },
							{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
						],
						timestamp: 1,
					},
				],
			});
			await tx.appendEntry(AssistantEntry, id, {
				model: [
					{
						role: "assistant",
						content: [{ type: "toolCall", id: "call-orphan", name: "seed_tool", arguments: { value: 1 } }],
						api: "openai-completions",
						provider: "seed-provider",
						model: "seed-model",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "toolUse",
						timestamp: 2,
					},
				],
			});
			const resultEntry = await tx.appendEntry(ToolResultEntry, id, {
				model: [
					{
						role: "toolResult",
						toolCallId: "call-orphan",
						toolName: "seed_tool",
						content: [
							{ type: "text", text: "ORPHAN-RESULT" },
							{ type: "image", data: "U0VFRUVELVRPT0wtQVZJRg==", mimeType: "image/avif" },
						],
						isError: false,
						timestamp: 3,
					},
				],
				data: { diagnostics: [] },
			});
			resultEntryId = String(resultEntry.id);
			// The normal tail page is small enough to include the result but exclude its declaration.
			for (let index = 0; index < 255; index++)
				await tx.appendEntry(id, { kind: `test.history.${index}`, data: { index } });
		}, BACKGROUND_CONTEXT);
	} finally {
		await session.close(BACKGROUND_CONTEXT);
	}
	// The second fixture uses the public Durable fork operation. The source/child setup below
	// is explicit test history; live work still runs through the ordinary provider/tool path.
	const attached = await startPocket({
		runtime: { ...profile, dataDir: join(m.f.root, "seed-product"), reopenSessionFile: sessionFile },
		owner: "Operator",
		initial,
	});
	let forkRef;
	try {
		const actor = await attached.people.authenticate(token);
		forkRef = await attached.workspace.bind(actor).fork(ref, {
			requestId: "fork-source",
			entryId: resultEntryId,
			name: "Fork",
			profile: "default",
		});
	} finally {
		await attached.close();
	}
	return {
		configured: {
			...profile,
			dataDir: join(m.f.root, "seed-product"),
			reopenSessionFile: sessionFile,
		},
		token,
		initial,
		ref,
		forkRef,
	};
}

test(
	"WebUI transcript: one real tool keeps its identity, expanded card and result across the live/committed handoff",
	{ timeout: 30000 },
	async () => {
		const gate = deferred();
		const m = await runtimeFixture(
			{
				tools: [
					{
						name: "blocked_tool",
						description: "Hold a real native tool open",
						parameters: { type: "object", properties: {}, required: [] },
						execute: async () => {
							await gate.promise;
							return "TOOL-OUTPUT";
						},
					},
				],
			},
			undefined,
			(_payload, n) => (n === 1 ? { tool: "blocked_tool", args: { file: "A" } } : { text: "WORK-FINISHED" }),
		);
		await m.runtime.close();
		let app: Product | undefined, browser: Browser | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "transcript-tools") },
				owner: "Operator",
				initial: [{ name: "Tools", profile: "default" }],
			});
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-tools-")), "profile"));
			const page = await openConversation(app, browser);
			await send(page, "RUN-BLOCKED-TOOL");
			await page.wait('document.querySelector("[data-call-id]")?.dataset.toolStatus === "running"');
			const selectedId = (await page.evaluate(
				'document.querySelector("[data-conversation][aria-current=true]").dataset.conversation',
			)) as string;
			const target = app.runtime.view().conversations.find((ref) => ref.conversationId === selectedId)!;
			const snapshot = await app.runtime.readConversation(target, allow);
			const live = snapshot.live.tools.find((tool) => tool.status === "running")!;
			assert.ok(live, "the native tool is actually running");
			const declared = snapshot.entries.flatMap((entry) =>
				entry.messages.flatMap((message) =>
					typeof message.content === "string"
						? []
						: message.content.filter((part) => part.type === "toolCall" && part.id === live.callId),
				),
			);
			assert.equal(declared.length, 1, "the same call is committed while it is live");
			assert.ok(
				await page.evaluate(
					`(()=>{const card=document.querySelector('[data-call-id='+JSON.stringify(${JSON.stringify(live.callId)})+']');if(!card)return false;card.open=true;card.__handoffMarker=true;return true})()`,
				),
			);
			const during = (await page.evaluate(
				`JSON.stringify({cards:document.querySelectorAll(".tool-card").length,ids:[...document.querySelectorAll("[data-call-id]")].map(card=>card.dataset.callId),streaming:Boolean(document.querySelector("[data-streaming]")),liveMessages:document.querySelectorAll("[data-live]").length})`,
			)) as string;
			assert.deepEqual(JSON.parse(during), {
				cards: 1,
				ids: [live.callId],
				streaming: false,
				liveMessages: 0,
			});
			gate.resolve();
			await page.wait('document.querySelector("[data-tool-output]")?.textContent === "TOOL-OUTPUT"');
			await page.wait('document.querySelector(".pocket-receipt")?.textContent.startsWith("done")');
			const after = await page.evaluate(
				`(()=>{const cards=[...document.querySelectorAll("[data-call-id]")];return {ids:cards.map(card=>card.dataset.callId),same:cards[0]?.__handoffMarker===true,open:cards[0]?.open,outputs:cards.map(card=>card.querySelector("[data-tool-output]")?.textContent),statuses:cards.map(card=>card.dataset.toolStatus??null),results:document.querySelectorAll('[data-role="toolResult"]').length}})()`,
			);
			assert.deepEqual(after, {
				ids: [live.callId],
				same: true,
				open: true,
				outputs: ["TOOL-OUTPUT"],
				statuses: [null],
				results: 0,
			});
			assert.equal(m.f.errors.length, 0);
		} finally {
			gate.resolve();
			await stopAll(app, browser, m);
		}
	},
);

test(
	"WebUI transcript: valid image parts and a truncated tool declaration remain visible through real reopen and paging",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture();
		let app: Product | undefined, browser: Browser | undefined;
		try {
			const seeded = await seedHistory(m);
			app = await startPocket({ runtime: seeded.configured, owner: "Operator", initial: seeded.initial });
			assert.equal(app.initialOwner, null);
			const actor = await app.people.authenticate(seeded.token);
			const client = app.workspace.bind(actor);
			const ref = app.runtime.view().conversations.find((ref) => ref.key !== "root")!;
			const page = await client.read(ref);
			assert.equal(page.entriesTruncated, true);
			assert.equal(
				page.entries.some((entry) =>
					entry.messages.some(
						(message) =>
							typeof message.content !== "string" &&
							message.content.some((part) => part.type === "toolCall" && part.id === "call-orphan"),
					),
				),
				false,
				"the declaration is outside the default history window",
			);
			assert.equal(
				JSON.stringify(page).includes("ORPHAN-RESULT"),
				true,
				"the tool result must be inside the same tail window: " +
					JSON.stringify({
						entryCount: page.entries.length,
						olderBeforeId: page.olderBeforeId,
						first: page.entries[0],
					}),
			);
			const login = await app.people.rotate(actor);
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-history-")), "profile"));
			const pageInBrowser = await browser.page(app.http.origin + "/#signin=" + login.token);
			await pageInBrowser.wait('document.querySelector("[data-action=signin]") !== null');
			await pageInBrowser.click("[data-action=signin]");
			await pageInBrowser.wait('document.querySelector("[data-conversation]") !== null');
			await pageInBrowser.click("[data-conversation]");
			await pageInBrowser.wait('document.querySelector(".pocket-title") !== null');
			await pageInBrowser.wait('document.querySelector(".message-list") !== null');
			await pageInBrowser.wait(
				'document.querySelector(".message-list") && !document.querySelector(".message-list").textContent.includes("Connecting")',
			);
			const visible = (await pageInBrowser.evaluate(
				`(()=>{const placeholders=[...document.querySelectorAll(".part-unrenderable")];const orphan=document.querySelector('[data-call-id="call-orphan"]');return {placeholders:placeholders.map(node=>({text:node.textContent,type:node.dataset.partType,mime:node.dataset.partMime,visible:!!(node.offsetWidth||node.offsetHeight)})),orphan:orphan?{text:orphan.textContent,note:orphan.querySelector("[data-tool-orphan]")?.textContent,result:orphan.querySelector("[data-tool-output]")?.textContent}:null}})()`,
			)) as {
				placeholders: { text: string; type: string; mime: string; visible: boolean }[];
				orphan: { text: string; note?: string; result?: string } | null;
			};
			assert.ok(
				visible.placeholders.some(
					(part: { text: string; visible: boolean }) => part.text.includes("image/avif") && part.visible,
				),
				"the valid AVIF is a visible placeholder: " + JSON.stringify(visible),
			);
			assert.equal(visible.orphan?.note, "call not in this view");
			assert.equal(visible.orphan?.result, "ORPHAN-RESULT");
			assert.equal(m.f.requests.length, 0, "reading seeded history performs no inference");
		} finally {
			await stopAll(app, browser, m);
		}
	},
);

test(
	"WebUI transcript: real chunked generation exposes a live Streaming message, then clears it",
	{ timeout: 30000 },
	async () => {
		const firstChunk = deferred(),
			finish = deferred();
		const provider = createServer((request, response) => {
			void (async () => {
				response.writeHead(200, { "content-type": "text/event-stream" });
				const consume = (async () => {
					for await (const _chunk of request) {
						// Consume the request in parallel with the streamed response.
					}
				})();
				const write = (delta: object, finishReason: string | null = null) => {
					response.write(
						"data: " +
							JSON.stringify({
								id: "local-stream",
								object: "chat.completion.chunk",
								created: 1,
								model: "local-model",
								choices: [{ index: 0, delta, finish_reason: finishReason }],
							}) +
							"\n\n",
					);
				};
				write({ role: "assistant" });
				write({ content: "LIVE-" });
				firstChunk.resolve();
				await finish.promise;
				write({ content: "COMMITTED" });
				write({}, "stop");
				await consume;
				response.end("data: [DONE]\n\n");
			})().catch((error) => response.destroy(error));
		});
		await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
		const address = provider.address();
		assert.ok(address && typeof address !== "string");
		const m = await runtimeFixture();
		// Replace only the provider endpoint with the controlled chunking server; retain the same product path.
		const config = { ...m.config, endpoint: `http://127.0.0.1:${address.port}/v1` };
		await m.runtime.close();
		let app: Product | undefined, browser: Browser | undefined;
		try {
			app = await startPocket({
				runtime: { ...config, dataDir: join(m.f.root, "transcript-stream") },
				owner: "Operator",
				initial: [{ name: "Streaming", profile: "default" }],
			});
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-stream-")), "profile"));
			const page = await openConversation(app, browser);
			await send(page, "STREAM-THIS");
			await page.wait('document.querySelector(`.message-live[data-live="true"]`) !== null');
			const live = (await page.evaluate(
				`(()=>{const message=document.querySelector(".message-live[data-live='true']"),marker=document.querySelector("[data-streaming]");return {text:message?.textContent,marker:marker?.textContent,compact:marker?getComputedStyle(marker).alignSelf:null,inside:!!marker?.parentElement?.classList.contains("message-list")}})()`,
			)) as { text?: string; marker?: string; compact?: string; inside: boolean };
			assert.match(live.text ?? "", /LIVE-/);
			assert.equal(live.marker, "Streaming");
			assert.equal(live.compact, "flex-start");
			assert.equal(live.inside, true);
			const selectedId = (await page.evaluate(
				'document.querySelector("[data-conversation][aria-current=true]").dataset.conversation',
			)) as string;
			const ref = app.runtime.view().conversations.find((ref) => ref.conversationId === selectedId)!;
			const read = await app.runtime.readConversation(ref, allow);
			assert.equal(read.live.message?.stopReason, undefined, "pending is not a terminal reason");
			const raw = (await page.evaluate(
				`fetch('/pocket/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Pakka-CSRF':(/pakka_csrf=([^;]+)/.exec(document.cookie)||[])[1]},body:JSON.stringify({version:2,requestId:'live-read',command:{op:'read',target:${JSON.stringify(ref)}}})}).then(response=>response.json())`,
			)) as unknown;
			const decoded = decodePocketResponse(raw, "live-read");
			assert.ok("result" in decoded && decoded.result.kind === "conversation");
			assert.equal(decoded.result.snapshot.live.message?.stopReason, undefined);
			firstChunk.resolve();
			finish.resolve();
			await page.wait('document.querySelector(".pocket-receipt")?.textContent.startsWith("done")');
			await page.wait(
				'document.querySelector("[data-live]") === null && document.querySelector("[data-streaming]") === null',
			);
			assert.equal(
				await page.evaluate('document.querySelector(".message-list").textContent.includes("LIVE-COMMITTED")'),
				true,
			);
		} finally {
			firstChunk.resolve();
			finish.resolve();
			await stopAll(app, browser, m);
			provider.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				provider.close((error) => (error ? reject(error) : resolve())),
			);
		}
	},
);

test(
	"WebUI transcript: inherited tool results do not swallow a different live call with the same provider id",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture();
		const gate = deferred();
		const provider = createServer((request, response) => {
			void (async () => {
				let body = "";
				for await (const chunk of request) body += chunk;
				const payload = JSON.parse(body);
				const complete = payload.messages.at(-1)?.role === "tool";
				const delta = complete
					? { content: "FORK-DONE" }
					: {
							tool_calls: [
								{
									index: 0,
									id: "call-orphan",
									type: "function",
									function: { name: "live_tool", arguments: "{}" },
								},
							],
						};
				response.writeHead(200, { "content-type": "text/event-stream" });
				for (const chunk of [
					{ delta: { role: "assistant" }, finish_reason: null },
					{ delta, finish_reason: null },
					{ delta: {}, finish_reason: complete ? "stop" : "tool_calls" },
				])
					response.write(
						"data: " +
							JSON.stringify({
								id: "fork-call",
								object: "chat.completion.chunk",
								created: 1,
								model: "local-model",
								choices: [{ index: 0, ...chunk }],
							}) +
							"\n\n",
					);
				response.end("data: [DONE]\n\n");
			})().catch((error) => response.destroy(error));
		});
		await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
		const address = provider.address();
		assert.ok(address && typeof address !== "string");
		let app: Product | undefined, browser: Browser | undefined;
		try {
			const seeded = await seedHistory(
				m,
				{
					execute: async () => {
						await gate.promise;
						return "LIVE-RESULT";
					},
				},
				`http://127.0.0.1:${address.port}/v1`,
			);
			app = await startPocket({
				runtime: seeded.configured,
				owner: "Operator",
				initial: seeded.initial,
			});
			assert.ok(seeded.forkRef);
			const before = await app.runtime.readConversation(seeded.forkRef, allow);
			assert.ok(before.entries.some((entry) => entry.sourceConversationId));
			assert.ok(JSON.stringify(before).includes("ORPHAN-RESULT"));
			const actor = await app.people.authenticate(seeded.token);
			const login = await app.people.rotate(actor);
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-fork-")), "profile"));
			const page = await browser.page(app.http.origin + "/#signin=" + login.token);
			await page.wait('document.querySelector("[data-action=signin]") !== null');
			await page.click("[data-action=signin]");
			await page.wait(
				`document.querySelector('[data-conversation="${seeded.forkRef.conversationId}"]') !== null`,
			);
			await page.click(`[data-conversation="${seeded.forkRef.conversationId}"]`);
			await page.wait('document.querySelector("[data-action=send]")?.disabled === false');
			await send(page, "LIVE-SAME-ID");
			await page.wait(
				'document.querySelectorAll("[data-call-id=call-orphan]").length > 0 && [...document.querySelectorAll("[data-call-id=call-orphan]")].some(card=>card.dataset.toolStatus==="running")',
			);
			const during = (await page.evaluate(
				`[...document.querySelectorAll('[data-call-id="call-orphan"]')].map(card=>({source:card.dataset.sourceConversation,status:card.dataset.toolStatus,output:card.querySelector('[data-tool-output]')?.textContent}))`,
			)) as { source?: string; status?: string; output?: string }[];
			assert.equal(during.length, 2, "inherited and live calls remain separate: " + JSON.stringify(during));
			assert.deepEqual(
				new Set(during.map((card) => card.source)),
				new Set([seeded.ref.conversationId, seeded.forkRef.conversationId]),
			);
			assert.ok(during.some((card) => card.status === "running"));
			assert.ok(during.some((card) => card.output === "ORPHAN-RESULT"));
			assert.equal(
				during.some((card) => card.status === "running" && card.output === "ORPHAN-RESULT"),
				false,
			);
			gate.resolve();
			await page.wait('document.querySelector(".pocket-receipt")?.textContent.startsWith("done")');
			assert.equal(
				await page.evaluate(
					'[...document.querySelectorAll("[data-call-id=call-orphan]")].some(card=>card.querySelector("[data-tool-output]")?.textContent==="LIVE-RESULT"||card.querySelector("[data-tool-preview]")?.textContent==="LIVE-RESULT")',
				),
				true,
			);
		} finally {
			gate.resolve();
			await stopAll(app, browser, m);
			provider.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				provider.close((error) => (error ? reject(error) : resolve())),
			);
		}
	},
);

test(
	"WebUI receipt: a known policy refusal is blocked, not mislabeled as a permission denial",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Product | undefined, browser: Browser | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "transcript-receipt") },
				owner: "Operator",
				initial: [{ name: "Receipts", profile: "default" }],
			});
			const ref = app.runtime.view().conversations.find((ref) => ref.key !== "root")!;
			const host = await app.runtime.conversation(ref);
			const owner = host.connect("policy-owner", ["real_context.write"]);
			owner.activateStrategy({ id: "p0-policy", hooks: ["real_context.write"] });
			owner.bindStrategy("p0-policy").installProjector((frame) => ({
				status: "blocked",
				basis: frame.basis,
				reason: "policy refused",
			}));
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-receipt-")), "profile"));
			const page = await openConversation(app, browser);
			await send(page, "REFUSE-THIS");
			await page.wait('document.querySelector(`.pocket-receipt[data-receipt-status="unanswered"]`) !== null');
			const blocked = (await page.evaluate(
				`(()=>{const receipt=document.querySelector(".pocket-receipt");return {text:receipt.textContent,reason:receipt.querySelector("[data-receipt-reason]")?.textContent,guidance:receipt.querySelector(".receipt-guidance")?.textContent}})()`,
			)) as { text: string; reason?: string; guidance?: string };
			assert.match(blocked.text, /^unanswered · /);
			assert.equal(blocked.reason, "blocked");
			assert.equal(blocked.guidance, "Not delivered: policy refused this input. Edit it and send again.");
		} finally {
			await stopAll(app, browser, m);
		}
	},
);

test(
	"WebUI receipt: a real host unknown is needs review through a registered Conversation source",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture({
			prepareInput: async ({ text }) => {
				if (text === "UNKNOWN-RESULT") throw new Error("TEST PRE-ADMISSION OUTCOME UNKNOWN");
				return { action: "text", text };
			},
		});
		await m.runtime.close();
		let app: Product | undefined, browser: Browser | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "unknown-source") },
				owner: "Operator",
				extensionServices: ({ runtime }) => ({
					unknown: {
						permission: "read",
						conversations: hostSource(runtime.root(), runtime.view().conversations[0]!),
						bind: () => Object.freeze({}),
					},
				}),
			});
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-unknown-")), "profile"));
			const page = await openConversation(app, browser);
			await send(page, "UNKNOWN-RESULT");
			await page.wait('document.querySelector(`.pocket-receipt[data-receipt-status="unknown"]`) !== null');
			const receipt = (await page.evaluate(
				`(()=>{const node=document.querySelector('.pocket-receipt[data-receipt-status="unknown"]');return {text:node.textContent,badge:node.querySelector('[data-receipt-reason]')?.textContent,guidance:node.querySelector('.receipt-guidance')?.textContent,retry:[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Retry original request'))}})()`,
			)) as { text: string; badge?: string; guidance?: string; retry: boolean };
			assert.match(receipt.text, /^unknown · /);
			assert.equal(receipt.badge, "needs review");
			assert.equal(receipt.guidance, "Result unknown: check before resending. Do not resend blindly.");
			assert.equal(receipt.retry, false, "an unknown host outcome is not offered an automatic replay");
			assert.equal(m.f.requests.length, 0, "the real preparation failure sent no provider request");
		} finally {
			await stopAll(app, browser, m);
		}
	},
);

test(
	"WebUI receipt: withdrawing queued input is not described as a policy refusal",
	{ timeout: 30000 },
	async () => {
		const release = deferred();
		let first = true;
		const m = await runtimeFixture({}, undefined, async () => {
			if (first) {
				first = false;
				await release.promise;
			}
			return { text: "FINISHED" };
		});
		await m.runtime.close();
		let app: Product | undefined, browser: Browser | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "withdraw-receipt") },
				owner: "Operator",
				initial: [{ name: "Withdraw", profile: "default" }],
			});
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-withdraw-")), "profile"));
			const page = await openConversation(app, browser);
			await send(page, "HOLD-THE-TURN");
			await page.wait('document.querySelector(".pocket-status")?.textContent === "Working"');
			await inputMode(page, "steer");
			await send(page, "WITHDRAW-THIS");
			await page.wait('document.querySelector(".pocket-receipt[data-receipt-status=queued]") !== null');
			await page.click(".pocket-receipt .pill-btn");
			await page.wait('document.querySelector(`.pocket-receipt[data-receipt-status="unanswered"]`) !== null');
			const receipt = (await page.evaluate(
				`(()=>{const node=document.querySelector('.pocket-receipt');return {badge:node.querySelector('[data-receipt-reason]')?.textContent,guidance:node.querySelector('.receipt-guidance')?.textContent,reason:node.textContent}})()`,
			)) as { badge?: string; guidance?: string; reason: string };
			assert.equal(receipt.badge, "blocked");
			assert.equal(receipt.guidance, "Withdrawn before delivery. Send again only when ready.");
			assert.doesNotMatch(receipt.reason, /policy refused/);
			assert.equal(m.f.requests.length, 1, "withdrawing a queued input dispatches no new generation");
		} finally {
			release.resolve();
			await stopAll(app, browser, m);
		}
	},
);

// A real public Conversation source, not a synthetic HTTP response. The native Host creates
// the unknown receipt; this source only adapts its actual receipt to the product DTO.
function hostSource(
	host: ReturnType<Fixture["runtime"]["root"]>,
	ref: ConversationRef,
): PocketConversationSource {
	const receipts = new Map<string, Receipt>();
	let client: ReturnType<ReturnType<Fixture["runtime"]["root"]>["connect"]> | undefined;
	const dto = (receipt: Receipt) => ({
		id: receipt.id,
		requestId: receipt.key,
		actorId: receipt.principal,
		target: ref,
		status:
			receipt.state === "committed" || receipt.state === "handled"
				? ("done" as const)
				: receipt.state === "released"
					? ("unanswered" as const)
					: receipt.state === "unknown"
						? ("unknown" as const)
						: ("placed" as const),
		...(receipt.reason ? { reason: receipt.reason } : {}),
	});
	return {
		bind(actor) {
			client ??= host.connect(actor.person.id, ["input.submit"]);
			const connected = client;
			const original = connected.receipt;
			return {
				navigation: async () => {
					actor.check("read", ref.conversationId);
					return [{ ref, name: "Host source", version: 0, archived: false }];
				},
				canManage: () => false,
				ownsReceipt: async (id) => receipts.has(id),
				configure: async () => {
					throw new Error("This source is read-only for the test");
				},
				configureAgent: async () => {
					throw new Error("This source is read-only for the test");
				},
				submit: async (_target, input) => {
					actor.check("send", ref.conversationId);
					const unsubscribe = host.subscribe((event) => {
						if (event.type === "receipt" && event.receipt.key === input.requestId)
							receipts.set(event.receipt.id, event.receipt);
					});
					try {
						const submitted = await connected.submit({
							key: input.requestId,
							text: input.text,
							mode: input.mode,
						});
						receipts.set(submitted.id, submitted);
					} catch (error) {
						const receipt = [...receipts.values()].find((row) => row.key === input.requestId);
						if (receipt?.state === "unknown") return dto(receipt);
						throw error;
					} finally {
						unsubscribe();
					}
					const receipt = [...receipts.values()].find((row) => row.key === input.requestId);
					if (receipt?.state === "unknown") return dto(receipt);
					throw new Error("The controlled source did not produce an unknown receipt");
				},
				receipt: async (id) => {
					const receipt = receipts.get(id) ?? original(id);
					if (!receipt) throw new Error("Unknown source receipt");
					return dto(receipt);
				},
				wait: async (id) => {
					const receipt = receipts.get(id) ?? original(id);
					if (!receipt) throw new Error("Unknown source receipt");
					return dto(receipt);
				},
				withdraw: async (id) => {
					const receipt = receipts.get(id) ?? original(id);
					if (!receipt) throw new Error("Unknown source receipt");
					return dto(receipt);
				},
				abort: async () => {
					throw new Error("This source does not offer abort in the test");
				},
			};
		},
	};
}
