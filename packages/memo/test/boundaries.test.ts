import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openMemo, type MemoService } from "../src/index.ts";
const actor = { id: "owner", check() {} };
const write = {
	libraryId: "work",
	requestId: "first",
	baseRevision: 0,
	path: "a.md",
	title: "A",
	markdown: "A",
	summary: "created",
	sources: [],
};
async function fixture(t: import("node:test").TestContext) {
	const dir = await mkdtemp(join(tmpdir(), "memo-boundaries-")),
		file = join(dir, "memo.sqlite"),
		services: MemoService[] = [];
	const open = () => {
		const s = openMemo({ file });
		services.push(s);
		return s;
	};
	const service = open();
	service.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	t.after(async () => {
		for (const s of services) s.close();
		await rm(dir, { recursive: true, force: true });
	});
	return { file, service, open, client: service.connect(actor) };
}

test("receipt storage failure rolls back page, revision and change; independent handles reconcile requests and reject stale writers", async (t) => {
	const f = await fixture(t),
		db = new DatabaseSync(f.file);
	try {
		db.exec(
			"CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'controlled disk failure'); END;",
		);
		await assert.rejects(f.client.write(write));
		assert.equal((await f.client.list({ libraryId: "work" })).items.length, 0);
		assert.equal((await f.client.changes({ libraryId: "work" })).items.length, 0);
		assert.equal(await f.client.lookup("first"), null);
		db.exec("DROP TRIGGER reject_receipt");
		const other = f.open().connect(actor);
		const [a, b] = await Promise.all([f.client.write(write), other.write(write)]);
		assert.deepEqual(a, b);
		const edits = await Promise.allSettled([
			f.client.write({ ...write, pageId: a.pageId, requestId: "a", baseRevision: 1 }),
			other.write({ ...write, pageId: a.pageId, requestId: "b", baseRevision: 1 }),
		]);
		assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
		assert.equal(edits.filter((r) => r.status === "rejected" && r.reason.code === "conflict").length, 1);
		assert.equal((await other.history({ libraryId: "work", pageId: a.pageId! })).items.length, 2);
	} finally {
		db.close();
	}
});

test("query-bound cursors survive reopen but reject tampering and actor substitution", async (t) => {
	const f = await fixture(t);
	await f.client.write(write);
	await f.client.write({ ...write, requestId: "second", path: "b.md" });
	const first = await f.client.list({ libraryId: "work", limit: 1 });
	assert.ok(first.cursor);
	await f.client.write({ ...write, requestId: "late", path: "late.md" });
	const next = await f.open().connect(actor).list({ libraryId: "work", limit: 1, cursor: first.cursor! });
	assert.equal(next.items.length, 1);
	assert.equal(next.cursor, null);
	await assert.rejects(f.client.list({ libraryId: "work", prefix: "other", cursor: first.cursor! }), {
		code: "invalid",
	});
	await assert.rejects(f.client.list({ libraryId: "work", cursor: first.cursor! + "x" }), {
		code: "invalid",
	});
	await f.client.grant({ libraryId: "work", actorId: "guest", role: "reader", requestId: "grant" });
	await assert.rejects(
		f.service.connect({ id: "guest", check() {} }).list({ libraryId: "work", cursor: first.cursor! }),
		{ code: "invalid" },
	);
});

test("escaped history pages stay within total JSON byte budget and return all retained revisions", async (t) => {
	const f = await fixture(t);
	let result = await f.client.write({ ...write, summary: "\u0001".repeat(2000) });
	for (let i = 2; i <= 36; i++)
		result = await f.client.write({
			...write,
			pageId: result.pageId,
			baseRevision: i - 1,
			requestId: "r" + i,
			summary: "\u0001".repeat(2000),
		});
	let cursor: string | undefined;
	const seen: number[] = [];
	do {
		const page = await f.client.history({ libraryId: "work", pageId: result.pageId!, limit: 50, cursor });
		assert.ok(
			Buffer.byteLength(JSON.stringify(page)) <= 192 * 1024,
			"history response must use encoded bytes",
		);
		seen.push(...page.items.map((r) => r.revision));
		cursor = page.cursor ?? undefined;
	} while (cursor);
	assert.deepEqual(
		seen,
		Array.from({ length: 36 }, (_, i) => 36 - i),
	);
});

test("oversized encoded reference metadata is refused before a page or receipt is committed", async (t) => {
	const f = await fixture(t);
	const refs = Array.from({ length: 32 }, (_, i) => ({
		kind: "source" as const,
		libraryId: "work",
		sourceId: "s" + i,
		version: "v1",
		locator: "\u0001".repeat(1024),
	}));
	await assert.rejects(f.client.write({ ...write, sources: refs }), { code: "invalid" });
	assert.equal(await f.client.lookup("first"), null);
	assert.equal((await f.client.list({ libraryId: "work" })).items.length, 0);
});

test("export refuses to silently discard hidden source references from a future round-trip", async (t) => {
	const f = await fixture(t);
	const result = await f.client.write({
		...write,
		sources: [{ kind: "source", libraryId: "private", sourceId: "secret", version: "v1" }],
	});
	await assert.rejects(f.client.exportMarkdown({ libraryId: "work", pageId: result.pageId! }), {
		code: "denied",
	});
});
