import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

const allow = () => {};

test("Conversation preview: large tool text and original image stay readable without putting either whole body in a page", async () => {
	const m = await runtimeFixture();
	const ref = m.runtime.view().conversations[0]!;
	const file = m.runtime.root().view().sessionFile;
	let runtime = m.runtime;
	try {
		await runtime.close();
		const storage = await openNodeSqliteStorage(file);
		const session = createSession(storage);
		const original = "TOOL-FIRST\n" + '中🙂\\"\n'.repeat(1200000) + "TOOL-LAST\ud800";
		const image = Buffer.alloc(3 * 1024 * 1024, 119).toString("base64");
		const entry = await session.commit(
			async (tx) =>
				tx.appendEntry(Number(ref.conversationId) as ConversationId, {
					kind: "pi.tool-result",
					model: [
						{
							role: "toolResult",
							toolCallId: "large-call",
							toolName: "command",
							isError: true,
							timestamp: 1,
							content: [
								{ type: "text", text: original },
								{ type: "image", data: image, mimeType: "image/png" },
							],
						},
					],
					data: { privateNativeField: "NOT-FOR-PREVIEW" },
				}),
			BACKGROUND_CONTEXT,
		);
		await session.close(BACKGROUND_CONTEXT);
		runtime = await createRuntime({ ...m.config, observation: "lazy", reopenSessionFile: file });
		assert.equal(
			typeof runtime.previewConversation,
			"function",
			"the runtime needs an independent bounded browser projection",
		);
		const page = await runtime.previewConversation(ref, allow, { limit: 64 });
		assert.ok(Buffer.byteLength(JSON.stringify(page)) < 256 * 1024);
		assert.equal(JSON.stringify(page).includes("NOT-FOR-PREVIEW"), false);
		const visible = page.entries.find((row) => row.id === String(entry.id))!;
		assert.equal(visible.messages[0]?.isError, true);
		const parts = visible.messages[0]!.content;
		assert.ok(Array.isArray(parts));
		const text = parts.find((part) => part.type === "text")!;
		const imagePart = parts.find((part) => part.type === "image")!;
		assert.ok(String(text.text).startsWith("TOOL-FIRST"));
		assert.ok(String(text.text).includes("TOOL-LAST"));
		assert.equal(imagePart.data, "");
		const reference = text.contentReference;
		assert.ok(reference && typeof reference === "object" && !Array.isArray(reference));
		let offset = 0,
			rebuilt = "",
			count = 0;
		while (offset < reference.byteLength) {
			const chunk = await runtime.readContent(ref, reference, { offset, length: 65536 }, allow);
			assert.equal(chunk.reference.id, reference.id);
			assert.ok(chunk.nextOffset > offset);
			assert.ok(chunk.nextOffset - offset <= 65536);
			rebuilt += chunk.text;
			offset = chunk.nextOffset;
			count++;
		}
		assert.equal(
			createHash("sha256").update(rebuilt).digest("hex"),
			createHash("sha256").update(original).digest("hex"),
		);
		assert.ok(count > 100);
		await assert.rejects(
			runtime.readContent(
				ref,
				{ ...reference, path: "/data/privateNativeField" },
				{ offset: 0, length: 65536 },
				allow,
			),
		);
		await assert.rejects(
			runtime.readContent(
				ref,
				{ ...reference, revision: "not-original" },
				{ offset: 0, length: 65536 },
				allow,
			),
		);
		await assert.rejects(
			runtime.readContent(ref, reference, { offset: 0, length: 65536 }, () => {
				throw Error("revoked");
			}),
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await runtime.close();
		await m.close();
	}
});

test("Conversation preview: a byte page advances through history rather than turning a large entry into a permanent stop", async () => {
	const m = await runtimeFixture();
	const ref = m.runtime.view().conversations[0]!;
	try {
		assert.equal(typeof m.runtime.previewConversation, "function", "the bounded page must exist");
		for (let index = 0; index < 130; index++)
			await m.runtime.writeDisplay(
				ref,
				{
					namespace: "preview-test",
					actorId: "operator",
					requestId: "display-" + index,
					kind: "chat",
					text: "X".repeat(16000),
				},
				allow,
			);
		const ids = new Set<string>();
		let beforeEntryId: string | undefined;
		do {
			const page = await m.runtime.previewConversation(ref, allow, {
				limit: 64,
				...(beforeEntryId ? { beforeEntryId } : {}),
			});
			assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 256 * 1024);
			for (const row of page.entries) {
				assert.equal(ids.has(row.id), false);
				ids.add(row.id);
			}
			beforeEntryId = page.olderBeforeId;
		} while (beforeEntryId !== undefined);
		assert.ok(ids.size >= 130);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
