import { strict as assert } from "node:assert";
import { join } from "node:path";
import { openMemo } from "@pakka/memo";

const directory = process.argv[2];
if (!directory) throw Error("Private consumer directory required");
const file = join(directory, "memo.sqlite");
const actor = { id: "consumer", check() {} };
const input = {
	libraryId: "work",
	requestId: "original",
	baseRevision: 0,
	path: "notes/first.md",
	title: "跨安装知识",
	markdown: "中🧙文\\noriginal bytes",
	summary: "Installed consumer",
	sources: [],
};
let memo = openMemo({ file });
let first;
try {
	memo.createLibrary({ id: "work", title: "Knowledge", ownerId: actor.id });
	const client = memo.connect(actor);
	first = await client.write(input);
	await client.write({
		...input,
		pageId: first.pageId,
		baseRevision: 1,
		requestId: "rename",
		path: "topics/first.md",
		markdown: "revised",
	});
	await client.restore({
		libraryId: "work",
		pageId: first.pageId,
		baseRevision: 2,
		revision: 1,
		requestId: "restore",
		summary: "Restore",
	});
	assert.equal(
		(await client.read({ kind: "wiki", libraryId: "work", pageId: first.pageId, revision: 3 })).text,
		input.markdown,
	);
	for (let i = 0; i < 260; i++)
		await client.write({ ...input, requestId: "p" + i, path: "pages/" + i + ".md" });
	let cursor,
		seen = 0;
	do {
		const page = await client.list({ libraryId: "work", cursor, limit: 17 });
		seen += page.items.length;
		cursor = page.cursor ?? undefined;
	} while (cursor);
	assert.equal(seen, 261);
} finally {
	memo.close();
}
memo = openMemo({ file });
try {
	const client = memo.connect(actor);
	assert.deepEqual(await client.write(input), first);
	assert.deepEqual(await client.lookup("original"), first);
	assert.equal((await client.history({ libraryId: "work", pageId: first.pageId })).items.length, 3);
	await client.grant({ libraryId: "work", actorId: "reader", role: "reader", requestId: "grant" });
	const reader = memo.connect({ id: "reader", check() {} });
	await assert.rejects(reader.write({ ...input, requestId: "refused" }), { code: "denied" });
	const result = await reader.search({ query: "跨安装" });
	assert.ok(result.items.length > 0);
	const exported = await client.exportMarkdown({ libraryId: "work", pageId: first.pageId });
	assert.ok(exported.includes(input.markdown));
	console.log(
		JSON.stringify({ status: "passed", pages: 261, reopenedOriginal: true, history: 3, models: 0 }),
	);
} finally {
	memo.close();
}
