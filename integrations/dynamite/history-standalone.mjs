import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { historyFixture } from "./history-fixture.mjs";

assert.throws(() => createRequire(import.meta.url).resolve("@pakka/memo"), { code: "MODULE_NOT_FOUND" });
const f = await historyFixture(process.argv[2]);
try {
	const entry = await f.produce(),
		client = f.book.connect({ id: "reader", check() {} });
	assert.equal(entry.text, "Tests remain unconfirmed");
	const content = await client.source({ ref: entry.sources[0] });
	assert.match(content.text, /Observed execution/);
	await client.edit({
		requestId: "ordinary-edit",
		baseRevision: 1,
		title: "Independent edited Book",
		changes: [{ kind: "put", value: { ...entry, text: "A later verified editorial change" } }],
	});
	assert.equal((await client.read({ revision: 1, id: entry.id })).text, "Tests remain unconfirmed");
	await client.annotate({
		requestId: "later-note",
		revision: 1,
		targetId: entry.id,
		text: "Independent later note",
		sources: [],
	});
	const requests = f.requests.length;
	await f.reopen();
	const reopened = f.book.connect({ id: "reader", check() {} });
	assert.equal(
		(await reopened.read({ revision: 2, id: entry.id })).text,
		"A later verified editorial change",
	);
	assert.equal((await reopened.annotations({ revision: 1 })).items[0].text, "Independent later note");
	assert.equal(f.requests.length, requests);
	console.log(
		JSON.stringify({
			status: "passed",
			standalone: true,
			requests,
			bookId: f.book.bookId,
			oldRevision: 1,
			currentRevision: 2,
		}),
	);
} finally {
	await f.close();
}
