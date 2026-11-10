import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(t: import("node:test").TestContext) {
	const mod = await import(new URL("../src/index.ts", import.meta.url).href);
	assert.equal(typeof mod.openMemo, "function", "Memo knowledge service is missing");
	const directory = await mkdtemp(join(tmpdir(), "pakka-memo-"));
	const file = join(directory, "memo.sqlite");
	let service = mod.openMemo({ file });
	t.after(async () => {
		service.close();
		await rm(directory, { recursive: true, force: true });
	});
	const owner = { id: "owner", check() {} };
	service.createLibrary({ id: "work", title: "Work", ownerId: owner.id });
	return {
		file,
		service,
		owner,
		open: () => {
			service.close();
			service = mod.openMemo({ file });
			return service;
		},
	};
}
const create = {
	libraryId: "work",
	requestId: "original",
	baseRevision: 0,
	path: "notes/isolation.md",
	title: "工作区隔离",
	markdown: "第一行\n独立目录 🧙\n第三行",
	summary: "首次记录",
	sources: [],
};

test("Wiki keeps page identity across rename, creates a restoration revision, and reconciles the original write after reopen", async (t) => {
	const f = await fixture(t);
	let client = f.service.connect(f.owner);
	const first = await client.write(create);
	const changed = await client.write({
		...create,
		pageId: first.pageId,
		requestId: "rename",
		baseRevision: 1,
		path: "topics/isolation.md",
		markdown: "修订后的内容",
	});
	assert.equal(changed.pageId, first.pageId);
	assert.equal(changed.revision, 2);
	await assert.rejects(
		client.write({ ...create, pageId: first.pageId, requestId: "stale", baseRevision: 1 }),
		{ code: "conflict" },
	);
	const restored = await client.restore({
		libraryId: "work",
		pageId: first.pageId,
		requestId: "restore",
		baseRevision: 2,
		revision: 1,
		summary: "恢复内容",
	});
	assert.equal(restored.revision, 3);
	const view = await client.read(
		{ kind: "wiki", libraryId: "work", pageId: first.pageId, revision: 3 },
		{ limit: 4096 },
	);
	assert.equal(view.text, create.markdown);
	assert.equal(view.path, "topics/isolation.md");
	const history = await client.history({ libraryId: "work", pageId: first.pageId, limit: 2 });
	assert.deepEqual(
		history.items.map((r: { revision: number }) => r.revision),
		[3, 2],
	);
	assert.ok(history.cursor);
	client = f.open().connect(f.owner);
	assert.deepEqual(await client.write(create), first);
	assert.deepEqual(await client.lookup("original"), first);
	assert.equal((await client.list({ libraryId: "work" })).items.length, 1);
	assert.deepEqual(
		(
			await client.history({ libraryId: "work", pageId: first.pageId, cursor: history.cursor, limit: 2 })
		).items.map((r: { revision: number }) => r.revision),
		[1],
	);
	await assert.rejects(client.write({ ...create, markdown: "different bytes" }), { code: "conflict" });
});

test("library roles filter directory/search/history, deny identity spoofing and take effect on existing clients", async (t) => {
	const f = await fixture(t),
		manager = f.service.connect(f.owner);
	f.service.createLibrary({ id: "private", title: "SECRET LIBRARY", ownerId: "owner" });
	const secret = await manager.write({
		...create,
		libraryId: "private",
		requestId: "secret",
		title: "SECRET TITLE",
		markdown: "secret canary",
	});
	await manager.grant({ libraryId: "work", requestId: "reader", actorId: "guest", role: "reader" });
	const guest = f.service.connect({ id: "guest", check() {} });
	await manager.write(create);
	assert.deepEqual(
		(await guest.libraries()).items.map((r: { id: string }) => r.id),
		["work"],
	);
	assert.equal((await guest.search({ query: "secret" })).items.length, 0);
	await assert.rejects(
		guest.read({ kind: "wiki", libraryId: "private", pageId: secret.pageId, revision: 1 }),
		{ code: "denied" },
	);
	await assert.rejects(guest.write({ ...create, requestId: "reader-write", actorId: "owner" }), {
		code: "invalid",
	});
	await assert.rejects(guest.write({ ...create, requestId: "reader-write" }), { code: "denied" });
	await manager.grant({ libraryId: "work", requestId: "editor", actorId: "guest", role: "editor" });
	assert.equal(
		(await guest.write({ ...create, requestId: "editor-write", path: "notes/guest.md" })).revision,
		1,
	);
	await manager.grant({ libraryId: "work", requestId: "revoke", actorId: "guest", role: null });
	assert.equal((await guest.search({ query: "隔离" })).items.length, 0);
	await assert.rejects(guest.list({ libraryId: "work" }), { code: "denied" });
});

test("write receipt survives publication revocation without reporting a definite refusal", async (t) => {
	const f = await fixture(t);
	let checks = 0,
		revoked = false;
	const client = f.service.connect({
		id: "owner",
		check() {
			if (revoked) throw Error("revoked");
			checks++;
		},
	});
	// Another reader sees only committed state; revoke as soon as the write is visible.
	const { DatabaseSync } = await import("node:sqlite");
	const reader = new DatabaseSync(f.file, { readOnly: true });
	try {
		const scoped = client.withAuthority(() => {
			const row = reader
				.prepare("SELECT count(*) AS n FROM receipts WHERE actor_id='owner' AND request_id='original'")
				.get();
			if (Number(row?.n) > 0) {
				revoked = true;
				throw Error("revoked after commit");
			}
		});
		await assert.rejects(scoped.write(create), { code: "unknown" });
		assert.ok(checks > 0);
		assert.equal((await f.service.connect(f.owner).lookup("original")).revision, 1);
		assert.equal((await f.service.connect(f.owner).list({ libraryId: "work" })).items.length, 1);
	} finally {
		reader.close();
	}
});

test("bounded history retains more than 128 revisions and Unicode bodies reconstruct through read pages", async (t) => {
	const f = await fixture(t),
		client = f.service.connect(f.owner);
	const markdown = "中🧙文\n".repeat(9000);
	let receipt = await client.write({ ...create, markdown });
	for (let revision = 2; revision <= 140; revision++)
		receipt = await client.write({
			...create,
			pageId: receipt.pageId,
			baseRevision: revision - 1,
			requestId: "rev-" + revision,
			markdown: "revision " + revision,
		});
	let cursor: string | undefined,
		seen: number[] = [];
	do {
		const page = await client.history({ libraryId: "work", pageId: receipt.pageId, limit: 17, cursor });
		assert.ok(page.items.length <= 17);
		seen.push(...page.items.map((r: { revision: number }) => r.revision));
		cursor = page.cursor ?? undefined;
	} while (cursor);
	assert.deepEqual(
		seen,
		Array.from({ length: 140 }, (_, i) => 140 - i),
	);
	let text = "",
		offset = 0;
	do {
		const page = await client.read(
			{ kind: "wiki", libraryId: "work", pageId: receipt.pageId, revision: 1 },
			{ offset, limit: 1000 },
		);
		assert.ok(Buffer.byteLength(page.text) <= 4000);
		text += page.text;
		if (page.nextOffset === null) break;
		assert.ok(page.nextOffset > offset);
		offset = page.nextOffset;
	} while (true);
	assert.equal(text, markdown);
	await assert.rejects(client.history({ libraryId: "work", pageId: receipt.pageId, cursor: "bad cursor" }), {
		code: "invalid",
	});
	assert.equal((await client.lookup("original")).revision, 1);
});

test("Markdown export/import preserves identity and detects stale edited exports; deletion requires management authority", async (t) => {
	const f = await fixture(t),
		client = f.service.connect(f.owner),
		first = await client.write(create);
	const document = await client.exportMarkdown({ libraryId: "work", pageId: first.pageId });
	assert.ok(document.includes(create.markdown));
	const imported = await client.importMarkdown({
		requestId: "import",
		document: document.replace(create.markdown, "edited export"),
	});
	assert.equal(imported.pageId, first.pageId);
	assert.equal(imported.revision, 2);
	await assert.rejects(client.importMarkdown({ requestId: "stale-import", document }), { code: "conflict" });
	await client.grant({ libraryId: "work", requestId: "grant-editor", actorId: "editor", role: "editor" });
	const editor = f.service.connect({ id: "editor", check() {} });
	await assert.rejects(
		editor.remove({ libraryId: "work", pageId: first.pageId, baseRevision: 2, requestId: "remove" }),
		{ code: "denied" },
	);
	await client.remove({ libraryId: "work", pageId: first.pageId, baseRevision: 2, requestId: "remove" });
	assert.equal((await client.search({ query: "edited" })).items.length, 0);
	await assert.rejects(editor.read({ kind: "wiki", libraryId: "work", pageId: first.pageId, revision: 1 }), {
		code: "denied",
	});
});
