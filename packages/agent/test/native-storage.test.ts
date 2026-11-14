import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { ConversationId, DocumentId, DocumentCreate } from "@earendil-works/pi-durable";
import { readMainStorageText } from "./native-storage.ts";

// This oracle must allow auxiliary Session metadata to progress, but must still
// detect changed main records, lookalike kinds, and the same kind in a native scope.
test("main C2 comparison excludes only audited Session auxiliary metadata", async () => {
	const root = await mkdtemp(join(tmpdir(), "pakka-main-storage-oracle-"));
	const storage = await openNodeSqliteStorage(join(root, "storage.sqlite"));
	try {
		const conversationId = await storage.mintId<ConversationId>();
		await storage.commit([{ type: "conversation", value: { id: conversationId } }], BACKGROUND_CONTEXT);
		const records: DocumentCreate[] = [];
		for (const [kind, scope] of [
			["pakka.strategy-head", { kind: "session" }],
			["pi.native-state", { kind: "conversation", conversationId }],
			["pakka.strategy-head", { kind: "conversation", conversationId }],
			["pakka.strategy-head-other", { kind: "session" }],
		] as const) {
			const id = await storage.mintId<DocumentId>();
			const record: DocumentCreate =
				scope.kind === "conversation"
					? { id, kind, scope, history: "latest", fork: "initial" }
					: { id, kind, scope };
			records.push(record);
			await storage.commit(
				[
					{
						type: "document.create",
						record,
						content: { kind: "base", version: 1, value: { text: "before" } },
					},
				],
				BACKGROUND_CONTEXT,
			);
		}
		const change = async (record: DocumentCreate) => {
			await storage.commit(
				[
					{
						type: "document.change",
						id: record.id,
						content: { kind: "base", version: 1, value: { text: "after" } },
					},
				],
				BACKGROUND_CONTEXT,
			);
		};
		const before = await readMainStorageText(join(root, "storage.sqlite"));
		await change(records[0]!);
		assert.equal(
			await readMainStorageText(join(root, "storage.sqlite")),
			before,
			"Auxiliary history-head progress is not a main C2 mutation",
		);
		for (const record of records.slice(1)) {
			const nativeBefore = await readMainStorageText(join(root, "storage.sqlite"));
			await change(record);
			assert.notEqual(
				await readMainStorageText(join(root, "storage.sqlite")),
				nativeBefore,
				"An unowned kind or non-Session native scope must remain comparable",
			);
		}
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
		await rm(root, { recursive: true, force: true });
	}
});
