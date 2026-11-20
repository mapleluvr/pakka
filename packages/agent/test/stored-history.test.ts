import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, LiveDoc, type ConversationId, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import * as agent from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

const allow = () => {};

// Reopening a Runtime, exposing opaque native data, losing byte ranges, or treating saved activity as live breaks this.
test("Stored history: original bounded content and saved activity remain readable without recovering the Session", async () => {
	const m = await runtimeFixture({ observation: "lazy" });
	const ref = m.runtime.view().conversations[0]!;
	const reference = { sessionId: ref.sessionId, conversationId: ref.conversationId };
	const sessionFile = m.runtime.view().sessionFile;
	await m.runtime.close();
	try {
		const storage = await openNodeSqliteStorage(sessionFile);
		const taskId = await storage.mintId<TaskId<null>>();
		await storage.commit(
			[
				{
					type: "task",
					value: {
						id: taskId,
						conversationId: Number(ref.conversationId) as ConversationId,
						kind: "test.abandoned-history",
						version: 1,
						input: null,
						background: false,
						abortRequested: false,
						restarts: 4,
						state: { status: "running", checkpoint: null },
					},
				},
			],
			BACKGROUND_CONTEXT,
		);
		const original = "ORIGINAL-FIRST\n" + '中🙂\\\"\n'.repeat(24000) + "ORIGINAL-LAST\ud800";
		const session = createSession(storage);
		const entry = await session.commit(async (tx) => {
			const id = Number(ref.conversationId) as ConversationId;
			const live = await tx.doc(LiveDoc, id);
			live.run = { taskId, inputs: [] };
			live.tools = [
				{ callId: "saved-call", name: "saved-tool", status: "running", taskId, output: "SAVED-PROGRESS" },
			];
			return tx.appendEntry(id, {
				kind: "pi.tool-result",
				data: { privateNativeField: "NOT-FOR-HISTORY" },
				model: [
					{
						role: "toolResult",
						toolCallId: "original-call",
						toolName: "command",
						isError: false,
						timestamp: 1,
						content: [{ type: "text", text: original }],
					},
				],
			});
		}, BACKGROUND_CONTEXT);
		await session.close(BACKGROUND_CONTEXT);
		const before = await readFile(sessionFile);
		assert.equal(
			typeof agent.readStoredConversation,
			"function",
			"public non-executing Pakka history seam is required",
		);
		const options = { sessionFile, reference, check: allow };
		const result = await agent.readStoredConversation(options, {
			kind: "page",
			options: { maxBytes: 16384 },
		});
		assert.equal(result.kind, "page");
		if (result.kind !== "page") throw Error("Wrong history result");
		assert.deepEqual(result.page.reference, reference);
		assert.equal("ref" in result.page, false, "saved history is not an executable AgentRef snapshot");
		assert.equal("live" in result.page, false);
		assert.equal(result.page.saved.busy, true);
		assert.equal(result.page.saved.tools[0]?.status, "running");
		assert.ok(Buffer.byteLength(JSON.stringify(result.page)) <= 16384);
		assert.equal(JSON.stringify(result).includes("NOT-FOR-HISTORY"), false);
		const row = result.page.entries.find((item) => item.id === String(entry.id));
		const parts = row?.messages[0]?.content;
		assert.ok(Array.isArray(parts));
		const content = parts[0]?.contentReference;
		assert.ok(content);
		let rebuilt = "",
			offset = 0;
		while (offset < content.byteLength) {
			const value = await agent.readStoredConversation(options, {
				kind: "content",
				content,
				range: { offset, length: 65536 },
			});
			assert.equal(value.kind, "content");
			if (value.kind !== "content") throw Error("Wrong content result");
			assert.deepEqual(value.reference, reference);
			assert.ok(value.chunk.nextOffset > offset && value.chunk.nextOffset - offset <= 65536);
			rebuilt += value.chunk.text;
			offset = value.chunk.nextOffset;
		}
		assert.equal(rebuilt, original);
		await assert.rejects(
			agent.readStoredConversation(options, {
				kind: "content",
				content: { ...content, path: "/data/privateNativeField" },
				range: { offset: 0, length: 64 },
			}),
		);
		assert.deepEqual(
			await readFile(sessionFile),
			before,
			"reading must not rewrite saved running/restarts or any database content",
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// A conversation number alone is not a source identity; post-await authority cannot be cached at admission.
test("Stored history: same-number sources, active writer ownership and revoked reads stay isolated", async () => {
	const left = await runtimeFixture({ observation: "lazy" });
	const right = await runtimeFixture({ observation: "lazy" });
	try {
		assert.equal(
			typeof agent.readStoredConversation,
			"function",
			"public non-executing Pakka history seam is required",
		);
		const l = left.runtime.view().conversations[0]!,
			r = right.runtime.view().conversations[0]!;
		assert.equal(l.conversationId, r.conversationId);
		for (const [m, ref, text] of [
			[left, l, "ORIGINAL-LEFT"],
			[right, r, "ORIGINAL-RIGHT"],
		] as const) {
			await m.runtime.writeDisplay(
				ref,
				{ namespace: "history-test", actorId: "operator", requestId: "one", kind: "chat", text },
				allow,
			);
			const value = await agent.readStoredConversation(
				{
					sessionFile: m.runtime.view().sessionFile,
					reference: { sessionId: ref.sessionId, conversationId: ref.conversationId },
					check: allow,
				},
				{ kind: "page" },
			);
			assert.equal(value.kind, "page");
			if (value.kind !== "page") throw Error("Wrong history result");
			assert.ok(value.page.entries.some((entry) => entry.display?.text === text));
			assert.equal(m.runtime.view().phase, "ready");
		}
		await assert.rejects(
			agent.readStoredConversation(
				{
					sessionFile: left.runtime.view().sessionFile,
					reference: { sessionId: r.sessionId, conversationId: r.conversationId },
					check: allow,
				},
				{ kind: "source" },
			),
			{ reason: "identity-mismatch" },
		);
		let permitted = true;
		await assert.rejects(
			agent.readStoredConversation(
				{
					sessionFile: left.runtime.view().sessionFile,
					reference: { sessionId: l.sessionId, conversationId: l.conversationId },
					check: () => {
						if (!permitted) throw Error("revoked");
						queueMicrotask(() => {
							permitted = false;
						});
					},
				},
				{ kind: "page" },
			),
		);
		assert.equal(left.f.requests.length + right.f.requests.length, 0);
	} finally {
		await left.close();
		await right.close();
	}
});
