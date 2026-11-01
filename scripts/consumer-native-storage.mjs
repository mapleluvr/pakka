import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The runner enables Node's public parent-URL ESM resolver. Chord context is
// import-only; resolve its public export from the installed agent cohort.
const runtimeEntry = import.meta.resolve("@pakka/agent");
const { openNodeSqliteStorage } = await import(
	import.meta.resolve("@earendil-works/pi-durable/storage/sqlite/node", runtimeEntry)
);
const { BACKGROUND_CONTEXT } = await import(
	import.meta.resolve("@earendil-works/chord/context", runtimeEntry)
);

async function scan(query) {
	const values = [];
	let cursor;
	do {
		const page = await query(cursor);
		values.push(...page.items);
		cursor = page.next;
	} while (cursor);
	return values;
}

async function readSnapshot(file, read) {
	const dir = await mkdtemp(join(tmpdir(), "pakka-consumer-storage-"));
	let source, storage;
	try {
		source = new DatabaseSync(file, { readOnly: true });
		const snapshot = join(dir, "snapshot.sqlite");
		await backup(source, snapshot);
		source.close();
		source = undefined;
		storage = await openNodeSqliteStorage(snapshot);
		return await read(storage);
	} finally {
		source?.close();
		try {
			await storage?.close(BACKGROUND_CONTEXT);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
}

/** Assert on committed entries, independently of the host cache and WAL checkpoint. */
export async function readConversationEntries(file, conversationId) {
	const id = Number(conversationId);
	if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid installed Conversation identity");
	return readSnapshot(file, async (storage) =>
		JSON.stringify(
			await scan((cursor) =>
				storage.scanEntries({ conversationId: id, order: "ascending" }, 256, cursor, BACKGROUND_CONTEXT),
			),
		),
	);
}

/** Logical records from an actual SQLite backup; this is not a transaction log. */
export async function readStorageText(file) {
	return readSnapshot(file, async (storage) => {
		const conversations = await scan((cursor) =>
			storage.scanConversations({}, 128, cursor, BACKGROUND_CONTEXT),
		);
		const entries = new Map();
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
		const scopes = [
			{ kind: "session" },
			...conversations.map((c) => ({ kind: "conversation", conversationId: c.id })),
			...tasks.map((t) => ({ kind: "task", taskId: t.id })),
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
	});
}
