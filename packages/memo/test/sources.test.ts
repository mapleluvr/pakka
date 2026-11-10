import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemo, MemoError, type SourceProvider, type SourceRef } from "../src/index.ts";

async function fixture(t: import("node:test").TestContext, provider: SourceProvider) {
	const dir = await mkdtemp(join(tmpdir(), "memo-sources-"));
	const memo = openMemo({ file: join(dir, "memo.sqlite"), providers: { archive: provider } });
	t.after(async () => {
		memo.close();
		await rm(dir, { recursive: true, force: true });
	});
	memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	return {
		memo,
		owner: memo.connect({ id: "owner", check() {} }),
		guest: memo.connect({ id: "guest", check() {} }),
	};
}
const registration = {
	libraryId: "work",
	sourceId: "history",
	requestId: "register",
	baseVersion: 0,
	provider: "archive",
	address: "session:a/book:1",
	version: "v1",
	title: "历史资料",
	summary: "权限与隔离的原始观察",
};
const source: SourceRef = { kind: "source", libraryId: "work", sourceId: "history", version: "v1" };
test("source catalog shares directory and search with Wiki while provider read authority filters metadata", async (t) => {
	let guestCanRead = false;
	const f = await fixture(t, {
		check(i) {
			if (i.actorId === "guest" && !guestCanRead) throw new MemoError("denied", "private source");
		},
		async read(i) {
			return { ref: i.ref, text: "原始观察", nextOffset: null };
		},
	});
	await f.owner.grant({ libraryId: "work", requestId: "grant", actorId: "guest", role: "reader" });
	await f.owner.registerSource(registration);
	await f.owner.write({
		libraryId: "work",
		requestId: "wiki",
		baseRevision: 0,
		path: "authority.md",
		title: "权限",
		markdown: "权限结论",
		summary: "知识",
		sources: [source],
	});
	assert.deepEqual(
		(await f.guest.search({ query: "权限" })).items.map((r) => r.ref.kind),
		["wiki"],
	);
	assert.deepEqual(
		(await f.guest.list({ libraryId: "work" })).items.map((r) => r.ref.kind),
		["wiki"],
	);
	await assert.rejects(f.guest.read(source), { code: "denied" });
	guestCanRead = true;
	const found = await f.guest.search({ query: "权限", limit: 1 });
	assert.equal(found.items.length, 1);
	assert.ok(found.cursor);
	const next = await f.guest.search({ query: "权限", limit: 1, cursor: found.cursor! });
	assert.equal(next.items.length, 1);
	assert.deepEqual(new Set([found.items[0]!.ref.kind, next.items[0]!.ref.kind]), new Set(["wiki", "source"]));
	assert.equal((await f.guest.read(source)).text, "原始观察");
	assert.deepEqual(await f.owner.registerSource(registration), await f.owner.lookup("register"));
});
test("source sharing requires provider authority and never leaves a catalog entry after refusal", async (t) => {
	const f = await fixture(t, {
		check(i) {
			if (i.action === "share") throw new MemoError("denied", "cannot share");
		},
		async read(i) {
			return { ref: i.ref, text: "private", nextOffset: null };
		},
	});
	await assert.rejects(f.owner.registerSource(registration), { code: "denied" });
	assert.equal((await f.owner.list({ libraryId: "work" })).items.length, 0);
	assert.equal(await f.owner.lookup("register"), null);
});
test("async source reads recheck library grant and exact catalog version before publishing bytes", async (t) => {
	let release: () => void = () => {},
		entered: () => void = () => {};
	let gate = new Promise<void>((r) => {
		release = r;
	});
	let started = new Promise<void>((r) => {
		entered = r;
	});
	const f = await fixture(t, {
		check() {},
		async read(i) {
			entered();
			await gate;
			return { ref: i.ref, text: "PRIVATE BYTES", nextOffset: null };
		},
	});
	await f.owner.registerSource(registration);
	await f.owner.grant({ libraryId: "work", requestId: "grant", actorId: "guest", role: "reader" });
	const revoked = f.guest.read(source);
	await started;
	await f.owner.grant({ libraryId: "work", requestId: "revoke", actorId: "guest", role: null });
	release();
	await assert.rejects(revoked, { code: "denied" });
	gate = new Promise<void>((r) => {
		release = r;
	});
	started = new Promise<void>((r) => {
		entered = r;
	});
	const replaced = f.owner.read(source);
	await started;
	await f.owner.registerSource({ ...registration, requestId: "update", baseVersion: 1, version: "v2" });
	release();
	await assert.rejects(replaced, { code: "conflict" });
});
test("source provider replies cannot substitute a reference or overrun the requested window", async (t) => {
	let mode = "identity";
	const f = await fixture(t, {
		check() {},
		async read(i) {
			return mode === "identity"
				? { ref: { ...i.ref, sourceId: "other" }, text: "bad", nextOffset: null }
				: { ref: i.ref, text: "x".repeat(i.limit + 1), nextOffset: null };
		},
	});
	await f.owner.registerSource(registration);
	await assert.rejects(f.owner.read(source, { limit: 4 }), { code: "unavailable" });
	mode = "length";
	await assert.rejects(f.owner.read(source, { limit: 4 }), { code: "unavailable" });
});

test("unified search reaches provider-only text and a returned chapter reference expands the exact source version", async (t) => {
	const child = { ...source, locator: "chapter/2" };
	const f = await fixture(t, {
		check() {},
		async read(i) {
			return {
				ref: i.ref,
				text: i.ref.locator === "chapter/2" ? "稀有针词的原文" : "章节目录",
				nextOffset: null,
				sources: i.ref.locator ? [] : [child],
			};
		},
		async search(i: { ref: SourceRef; query: string; limit: number; cursor?: string }) {
			assert.equal(i.query, "稀有针词");
			return {
				items: [{ ref: child, title: "第二章", path: "chapters/2", excerpt: "稀有针词的命中" }],
				cursor: null,
			};
		},
	});
	await f.owner.registerSource(registration);
	let cursor: string | undefined;
	const found = [];
	do {
		const result = await f.owner.search({ query: "稀有针词", cursor, limit: 2 });
		found.push(...result.items);
		cursor = result.cursor ?? undefined;
	} while (cursor);
	assert.equal(found.length, 1);
	assert.deepEqual(found[0]!.ref, child);
	assert.equal((await f.owner.read(found[0]!.ref)).text, "稀有针词的原文");
	assert.deepEqual((await f.owner.read(source)).sources, [child]);
	await f.owner.registerSource({
		...registration,
		requestId: "v2",
		baseVersion: 1,
		version: "v2",
		address: "session:a/book:2",
	});
	assert.equal((await f.owner.read(child)).text, "稀有针词的原文");
});

test("source search rejects results after revocation and keeps private provider cursors opaque", async (t) => {
	let release: () => void = () => {},
		entered: () => void = () => {},
		blocked = false;
	const wait = new Promise<void>((r) => {
			release = r;
		}),
		started = new Promise<void>((r) => {
			entered = r;
		});
	const f = await fixture(t, {
		check() {},
		async read(i) {
			return { ref: i.ref, text: "x", nextOffset: null };
		},
		async search(i) {
			if (blocked) {
				entered();
				await wait;
			}
			return {
				items: [
					{
						ref: i.ref,
						title: "Match",
						path: "match",
						excerpt: "safe",
						privateDebug: "PRIVATE_PROVIDER_FIELD",
					},
				],
				cursor: i.cursor ? null : "PRIVATE_PROVIDER_CURSOR",
			};
		},
	});
	await f.owner.registerSource(registration);
	await f.owner.grant({ libraryId: "work", actorId: "guest", role: "reader", requestId: "grant" });
	const initial = await f.guest.search({ query: "body-only" });
	const found = await f.guest.search({ query: "body-only", cursor: initial.cursor! });
	assert.ok(!JSON.stringify(found).includes("PRIVATE_PROVIDER_FIELD"));
	assert.ok(found.cursor);
	assert.ok(
		!Buffer.from(found.cursor.split(".")[0]!, "base64url")
			.toString("utf8")
			.includes("PRIVATE_PROVIDER_CURSOR"),
	);
	blocked = true;
	const pending = f.guest.search({ query: "body-only", cursor: found.cursor });
	await started;
	await f.owner.grant({ libraryId: "work", actorId: "guest", role: null, requestId: "revoke" });
	release();
	await assert.rejects(pending, { code: "denied" });
});

test("source references in Wiki replies obey current source permissions without exposing hidden identifiers", async (t) => {
	const f = await fixture(t, {
		check(i) {
			if (i.actorId === "guest") throw new MemoError("denied", "hidden");
		},
		async read(i) {
			return { ref: i.ref, text: "x", nextOffset: null };
		},
	});
	await f.owner.registerSource(registration);
	const result = await f.owner.write({
		libraryId: "work",
		requestId: "wiki",
		baseRevision: 0,
		path: "public.md",
		title: "Public",
		markdown: "Approved public conclusion",
		summary: "shared",
		sources: [source],
	});
	await f.owner.grant({ libraryId: "work", requestId: "grant", actorId: "guest", role: "reader" });
	assert.deepEqual(
		(await f.guest.read({ kind: "wiki", libraryId: "work", pageId: result.pageId!, revision: 1 })).sources,
		[],
	);
	assert.deepEqual(
		(await f.guest.history({ libraryId: "work", pageId: result.pageId! })).items[0]!.sources,
		[],
	);
});
