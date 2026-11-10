import { openMemo } from "@pakka/memo";
import { resolve } from "node:path";

// Host supplies a private existing directory and a trusted identity.
const file = process.argv[2];
if (!file) throw Error("Usage: node headless.mjs <absolute-memo.sqlite>");
const memo = openMemo({ file: resolve(file) });
try {
	memo.createLibrary({ id: "example", title: "Example knowledge", ownerId: "local-user" });
	const client = memo.connect({ id: "local-user", check() {} });
	const receipt = await client.write({
		libraryId: "example",
		requestId: "headless-example-v1",
		baseRevision: 0,
		path: "notes/first.md",
		title: "Reusable knowledge",
		markdown: "A stable page survives normal reopen.\n",
		summary: "Initial example",
		sources: [],
	});
	const content = await client.read({
		kind: "wiki",
		libraryId: "example",
		pageId: receipt.pageId,
		revision: receipt.revision,
	});
	console.log(JSON.stringify({ receipt, content }, null, 2));
} finally {
	memo.close();
}
