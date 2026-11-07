import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Cursor, Page, DocumentId, DocumentRecord, StoredDocument } from "@earendil-works/pi-durable";

/** Reads an actual consistent SQLite backup using public Storage queries.
 * Oracle JSONL is read unchanged; SQLite records are a readable snapshot, not
 * a reconstructed transaction log. The live writer is never opened by a second Harness.
 */
export async function readStorageText(file: string): Promise<string> {
	const bytes = await readFile(file);
	if (bytes.subarray(0, 16).toString() !== "SQLite format 3\0") return bytes.toString("utf8");
	const dir = await mkdtemp(join(tmpdir(), "pakka-storage-read-")),
		snapshot = join(dir, "snapshot.sqlite");
	const source = new DatabaseSync(file, { readOnly: true });
	try {
		await backup(source, snapshot);
	} finally {
		source.close();
	}
	const storage = await openNodeSqliteStorage(snapshot);
	async function scan<T>(query: (cursor: Cursor | undefined) => Promise<Page<T, Cursor>>): Promise<T[]> {
		const values: T[] = [];
		let cursor: Cursor | undefined;
		do {
			const page = await query(cursor);
			values.push(...page.items);
			cursor = page.next;
		} while (cursor);
		return values;
	}
	try {
		const conversations = await scan((cursor) =>
			storage.scanConversations({}, 128, cursor, BACKGROUND_CONTEXT),
		);
		const entries = new Map<number, unknown>();
		for (const conversation of conversations)
			for (const entry of await scan((cursor) =>
				storage.scanEntries(
					{ conversationId: conversation.id, order: "ascending" },
					256,
					cursor,
					BACKGROUND_CONTEXT,
				),
			))
				entries.set(Number(entry.id), entry);
		const tasks = await scan((cursor) => storage.scanTasks({}, 128, cursor, BACKGROUND_CONTEXT));
		const submissions = await scan((cursor) => storage.scanSubmissions({}, 128, cursor, BACKGROUND_CONTEXT));
		const scopes: DocumentRecord["scope"][] = [
			{ kind: "session" },
			...conversations.map((conversation) => ({
				kind: "conversation" as const,
				conversationId: conversation.id,
			})),
			...tasks.map((task) => ({ kind: "task" as const, taskId: task.id })),
		];
		const records = (
			await Promise.all(
				scopes.map((scope) =>
					scan((cursor) => storage.scanDocuments({ scope, at: "current" }, 128, cursor, BACKGROUND_CONTEXT)),
				),
			)
		).flat();
		const documents = await Promise.all(
			records.map((record) => storage.document(record.id, "current", BACKGROUND_CONTEXT)),
		);
		return JSON.stringify({
			conversations,
			entries: [...entries].sort(([a], [b]) => a - b).map(([, entry]) => entry),
			tasks,
			submissions,
			documents,
		});
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
		await rm(dir, { recursive: true, force: true });
	}
}

/** Snapshot of main-session state. Only the five audited auxiliary document
 * families are separated; every other native/domain record remains comparable. */
export async function readMainStorageText(file: string): Promise<string> {
	const snapshot = JSON.parse(await readStorageText(file));
	const auxiliary = new Set([
		"pakka.strategy-journals",
		"pakka.strategy-receipt",
		"pakka.strategy-batch",
		"pakka.source-work",
		"pakka.source-work-index",
	]);
	snapshot.documents = snapshot.documents.filter((row: StoredDocument) => !auxiliary.has(row.record.kind));
	return JSON.stringify(snapshot);
}

/** A real competing SQLite write transaction; the host must fail its write,
 * rather than a renamed pathname leaving an already-open database writable.
 */
export function blockSqliteWrites(file: string): () => void {
	const blocker = new DatabaseSync(file);
	blocker.exec("BEGIN IMMEDIATE");
	let released = false;
	return () => {
		if (!released) {
			blocker.exec("ROLLBACK");
			blocker.close();
			released = true;
		}
	};
}

/** An explicitly owned test marker, committed through public Storage, not a second Harness.
 * Two markers bracket an operation: their sequence difference minus one counts its durable commits.
 * The marker has no provider messages or application authority and is retained only in test storage. */
export async function markNativeCommit(file: string): Promise<number> {
	const storage = await openNodeSqliteStorage(file);
	try {
		const id = await storage.mintId<DocumentId>();
		return await storage.commit(
			[
				{
					type: "document.create",
					record: { id, kind: "test.commit-marker", key: String(id), scope: { kind: "session" } },
					content: { kind: "base", version: 1, value: {} },
				},
			],
			BACKGROUND_CONTEXT,
		);
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
}

/** Consistent read of one logical document; no raw SQLite page assertions. */
export async function readNativeDocument(file: string, kind: string, key?: string): Promise<StoredDocument> {
	const snapshot = JSON.parse(await readStorageText(file)) as { documents: StoredDocument[] };
	const document = snapshot.documents.find(
		(row) => row.record.scope.kind === "session" && row.record.kind === kind && row.record.key === key,
	);
	if (!document) throw new Error("Native document is missing: " + kind);
	return document;
}
/** Controlled adversarial document mutation through public Storage, never a
 * second Harness. Callers explicitly own any live fault injection and await it
 * before probing; normal maintenance uses an already closed owner. */
export async function rewriteNativeDocument(
	file: string,
	kind: string,
	key: string | undefined,
	change: (value: StoredDocument["value"]) => StoredDocument["value"],
): Promise<void> {
	const storage = await openNodeSqliteStorage(file);
	try {
		const record = await storage.findDocument(
			{ scope: { kind: "session" }, kind, ...(key === undefined ? {} : { key }) },
			"current",
			BACKGROUND_CONTEXT,
		);
		if (!record) throw new Error("Native document is missing: " + kind);
		const document = await storage.document(record.id, "current", BACKGROUND_CONTEXT);
		if (!document) throw new Error("Native document incarnation is missing");
		const value = change(structuredClone(document.value));
		await storage.commit(
			[
				{
					type: "document.change",
					id: record.id,
					content: { kind: "base", version: document.version, value },
				},
			],
			BACKGROUND_CONTEXT,
		);
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
}
