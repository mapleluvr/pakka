import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openMemo, type SourceProvider } from "../src/index.ts";
const registration = {
	libraryId: "work",
	sourceId: "s",
	requestId: "s",
	baseVersion: 0,
	provider: "archive",
	address: "owned:source",
	version: "v1",
	title: "Source",
	summary: "Catalog",
};
async function fixture(t: import("node:test").TestContext, provider: SourceProvider) {
	const dir = await mkdtemp(join(tmpdir(), "memo-review-regression-")),
		file = join(dir, "memo.sqlite"),
		memo = openMemo({ file, providers: { archive: provider } });
	memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	t.after(async () => {
		memo.close();
		await rm(dir, { recursive: true, force: true });
	});
	return { file, dir, memo, client: memo.connect({ id: "owner", check() {} }) };
}
const read: SourceProvider["read"] = async (i) => ({ ref: i.ref, text: "x", nextOffset: null });

test("escape-heavy catalog and provider search pages remain bounded and complete with worst-case legal cursors", async (t) => {
	const continuation = '"'.repeat(2048);
	let fetched = 0;
	const f = await fixture(t, {
		check() {},
		read,
		async search(i) {
			assert.equal(i.cursor === undefined || i.cursor === continuation, true);
			const n = Math.min(i.limit, 8 - fetched),
				items = Array.from({ length: n }, (_, k) => ({
					ref: { ...i.ref, locator: "node-" + (fetched + k) },
					title: "\u0001".repeat(512),
					path: "\u0001".repeat(1024),
					excerpt: "\u0001".repeat(2048),
				}));
			fetched += n;
			return { items, cursor: fetched < 8 ? continuation : null };
		},
	});
	for (let i = 0; i < 50; i++)
		await f.client.registerSource({
			...registration,
			sourceId: "s" + i,
			requestId: "s" + i,
			title: "\u0001".repeat(512),
			summary: "needle" + "\u0001".repeat(2040),
		});
	let cursor: string | undefined,
		seen = 0;
	do {
		const page = await f.client.search({ query: "needle", limit: 50, cursor });
		assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 192 * 1024);
		for (const item of page.items) if (!("locator" in item.ref)) seen++;
		cursor = page.cursor ?? undefined;
	} while (cursor);
	assert.equal(seen, 50);
	// Isolate a single searchable source so the provider's cursor round-trip is observed.
	await f.client.registerSource({
		...registration,
		sourceId: "only",
		requestId: "only",
		title: "Only",
		summary: "Only",
	});
	fetched = 0;
	// Provider does not need to return a hit for every registered source.
	let maxBytes = 0;
	cursor = undefined;
	do {
		const page = await f.client.search({ query: "body-only", limit: 50, cursor });
		maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(page)));
		cursor = page.cursor ?? undefined;
		if (cursor) assert.ok(cursor.length <= 4096);
	} while (cursor);
	assert.ok(maxBytes <= 192 * 1024);
	assert.equal(fetched, 8);
});

test("non-searchable sources are skipped in bounded batches instead of one empty model round-trip each", async (t) => {
	const f = await fixture(t, { check() {}, read });
	for (let i = 0; i < 50; i++)
		await f.client.registerSource({ ...registration, sourceId: "s" + i, requestId: "s" + i });
	let cursor: string | undefined,
		calls = 0;
	do {
		const page = await f.client.search({ query: "absent", cursor });
		assert.equal(page.items.length, 0);
		cursor = page.cursor ?? undefined;
		calls++;
		assert.ok(calls <= 3, "50 metadata-only sources must not require 52 model calls");
	} while (cursor);
});

test("storage failures use stable public errors and a lock does not block the event loop for seconds", async (t) => {
	const f = await fixture(t, { check() {}, read }),
		garbage = join(f.dir, "garbage.sqlite");
	await writeFile(garbage, Buffer.alloc(4096, 65));
	assert.throws(() => openMemo({ file: garbage }), { code: "unavailable" });
	assert.throws(() => openMemo({ file: join(f.dir, "absent", "memo.sqlite") }), { code: "unavailable" });
	const db = new DatabaseSync(f.file);
	try {
		db.exec("BEGIN IMMEDIATE");
		const start = performance.now();
		await assert.rejects(f.client.registerSource(registration), { code: "busy" });
		assert.ok(performance.now() - start < 500);
		db.exec("ROLLBACK");
		await f.client.registerSource(registration);
		db.exec("ALTER TABLE revisions RENAME COLUMN markdown TO bad_column");
		await assert.rejects(f.client.list({ libraryId: "work" }), { code: "unavailable" });
		await assert.rejects(
			f.client.write({
				libraryId: "work",
				requestId: "write",
				baseRevision: 0,
				path: "a.md",
				title: "a",
				markdown: "a",
				summary: "a",
				sources: [],
			}),
			{ code: "unavailable" },
		);
	} finally {
		db.close();
	}
});
