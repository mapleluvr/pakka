import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession, type EntryId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const context = BACKGROUND_CONTEXT;

test("Durable archive: metadata and exact bounded bytes preserve original records without full decode", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "pakka-entry-archive-")));
	const storage = await openNodeSqliteStorage(join(directory, "main.sqlite"));
	const session = createSession(storage);
	try {
		const large = '中🙂\\"\n'.repeat(240000) + "\ud800";
		const entry = await session.commit(async (tx) => {
			const root = await tx.createConversation({ ownership: { kind: "ownerless" } });
			return tx.appendEntry(root.id, { kind: "test.large", data: { value: large } });
		}, context);
		const archive = storage.entryArchive;
		assert.ok(archive, "Installed Durable must expose its public bounded entry archive");
		const header = await archive.header(entry.conversationId, entry.id, context);
		assert.ok(header);
		assert.equal(header.id, entry.id);
		assert.equal(header.conversationId, entry.conversationId);
		assert.ok(header.byteLength > 2 * 1024 * 1024);
		assert.equal(Object.hasOwn(header, "record"), false);
		assert.equal(Object.hasOwn(header, "model"), false);
		const chunks: Buffer[] = [];
		let offset = 0;
		while (offset < header.byteLength) {
			const chunk = await archive.read(
				entry.conversationId,
				entry.id,
				{ offset, length: 65536, commitSeq: header.commitSeq },
				context,
			);
			assert.ok(chunk);
			assert.ok(chunk.bytes.length > 0 && chunk.bytes.length <= 65536);
			assert.equal(chunk.offset, offset);
			assert.equal(chunk.nextOffset, offset + chunk.bytes.length);
			chunks.push(Buffer.from(chunk.bytes));
			offset = chunk.nextOffset;
		}
		const original = await storage.entry(entry.conversationId, entry.id, context);
		assert.ok(original);
		assert.equal(Buffer.concat(chunks).toString("utf8"), JSON.stringify(original.entry));
		assert.equal(JSON.parse(Buffer.concat(chunks).toString("utf8")).data.value, large);
		await assert.rejects(
			archive.read(
				entry.conversationId,
				entry.id,
				{ offset: -1, length: 10, commitSeq: header.commitSeq },
				context,
			),
		);
		await assert.rejects(
			archive.read(
				entry.conversationId,
				entry.id,
				{ offset: 0, length: 65537, commitSeq: header.commitSeq },
				context,
			),
		);
		await assert.rejects(
			archive.read(
				entry.conversationId,
				entry.id,
				{ offset: header.byteLength + 1, length: 10, commitSeq: header.commitSeq },
				context,
			),
		);
		await assert.rejects(
			archive.read(
				entry.conversationId,
				entry.id,
				{ offset: 0, length: 10, commitSeq: (Number(header.commitSeq) + 1) as typeof header.commitSeq },
				context,
			),
		);
	} finally {
		await session.close(context);
	}
});

test("Durable archive: fork cutoffs, unrelated IDs and both scan orders match the original ancestry", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "pakka-entry-fork-")));
	const storage = await openNodeSqliteStorage(join(directory, "main.sqlite"));
	const session = createSession(storage);
	try {
		const setup = await session.commit(async (tx) => {
			const parent = await tx.createConversation({ ownership: { kind: "ownerless" } });
			const at = await tx.appendEntry(parent.id, { kind: "test.visible", data: { text: "VISIBLE" } });
			const late = await tx.appendEntry(parent.id, { kind: "test.hidden", data: { text: "LATE-PRIVATE" } });
			const peer = await tx.createConversation({ ownership: { kind: "ownerless" } });
			const hidden = await tx.appendEntry(peer.id, { kind: "test.peer", data: { text: "PEER-PRIVATE" } });
			return { parent, at, late, hidden };
		}, context);
		const child = await session.commit(
			(tx) => tx.forkConversation(setup.parent.id, setup.at.id, { ownership: { kind: "ownerless" } }),
			context,
		);
		await session.commit((tx) => tx.appendEntry(child.id, { kind: "test.child" }), context);
		const archive = storage.entryArchive;
		assert.ok(archive, "Installed Durable must expose its public bounded entry archive");
		assert.ok(await archive.header(child.id, setup.at.id, context));
		assert.equal(await archive.header(child.id, setup.late.id, context), undefined);
		assert.equal(await archive.header(child.id, setup.hidden.id, context), undefined);
		assert.equal(await archive.header(child.id, Number.MAX_SAFE_INTEGER as EntryId, context), undefined);
		for (const order of ["ascending", "descending"] as const) {
			const full = await storage.scanEntries({ conversationId: child.id, order }, 1, undefined, context);
			const small = await archive.scan({ conversationId: child.id, order }, 1, undefined, context);
			assert.deepEqual(
				small.items.map((row) => row.id),
				full.items.map((row) => row.id),
			);
			assert.deepEqual(small.next, full.next);
			const fullNext = await storage.scanEntries({ conversationId: child.id, order }, 1, full.next, context);
			const smallNext = await archive.scan({ conversationId: child.id, order }, 1, small.next, context);
			assert.deepEqual(
				smallNext.items.map((row) => row.id),
				fullNext.items.map((row) => row.id),
			);
		}
		const header = await archive.header(setup.parent.id, setup.late.id, context);
		assert.ok(header);
		assert.equal(
			await archive.read(
				child.id,
				setup.late.id,
				{ offset: 0, length: 16, commitSeq: header.commitSeq },
				context,
			),
			undefined,
		);
	} finally {
		await session.close(context);
	}
	await assert.rejects(
		storage.entryArchive!.scan({ conversationId: 1 as never }, 1, undefined, context),
		/closed/,
	);
});
