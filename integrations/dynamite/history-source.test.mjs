import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "@pakka/agent";
import * as dynamite from "@pakka/dynamite";
import { fixture } from "./history-source-fixture.mjs";

import { createDynamiteSourceProvider } from "@pakka/memo/dynamite";

test("a History Book source provider publishes fixed-version navigation and Unicode ranges with independent share authority", async () => {
	const f = await fixture("history-source-provider");
	let runtime;
	try {
		runtime = await createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "main-local",
			apiKey: "local-only",
			limits: {
				maxConversations: 2,
				maxPrimaryAttempts: 4,
				maxAuxiliaryAttempts: 4,
			},
		});
		const source = runtime.view().conversations[0];
		let allowed = true,
			share = false;
		const book = dynamite.createHistoryBookService({
				records: runtime.records({ namespace: "books" }),
				source: {
					sessionId: source.sessionId,
					conversationId: source.conversationId,
					namespace: "source",
				},
				check() {
					if (!allowed) throw Error("revoked");
				},
			}),
			client = book.connect({ id: "reader", check() {} });
		for (let i = 0; i < 6; i++)
			await client.edit({
				requestId: "edit-" + i,
				baseRevision: i,
				title: "Shared history",
				changes: [
					{
						kind: "put",
						value: {
							id: "entity-" + i,
							kind: "chapter",
							title: "Chapter " + i,
							text: "Shared observation 🔬 " + i,
							sources: [],
							links: [],
						},
					},
				],
			});
		assert.equal(typeof createDynamiteSourceProvider, "function", "Book source provider missing");
		const provider = createDynamiteSourceProvider({
			book,
			check(input) {
				if (!allowed || input.actorId !== "reader" || (input.action === "share" && !share))
					throw Error("denied");
			},
		});
		const ref = {
				kind: "source",
				libraryId: "library",
				sourceId: "history",
				version: "6",
			},
			input = {
				actorId: "reader",
				action: "read",
				libraryId: "library",
				address: book.bookId,
				ref,
			};
		assert.throws(() => provider.check({ ...input, action: "share" }), { code: "denied" });
		share = true;
		provider.check({ ...input, action: "share" });
		const first = await provider.search({
			...input,
			query: "observation",
			limit: 2,
		});
		assert.equal(first.items.length, 2);
		assert.ok(first.cursor);
		await client.edit({
			requestId: "later",
			baseRevision: 6,
			title: "New history",
			changes: [
				{
					kind: "put",
					value: {
						id: "entity-0",
						kind: "chapter",
						title: "Edited",
						text: "Changed after fixed version",
						sources: [],
						links: [],
					},
				},
			],
		});
		let search = first,
			found = [...first.items];
		while (search.cursor) {
			search = await provider.search({
				...input,
				query: "observation",
				limit: 2,
				cursor: search.cursor,
			});
			found.push(...search.items);
		}
		assert.equal(found.length, 6);
		assert.ok(found.every((item) => item.ref.version === "6"));
		const target = found.find((item) => item.title === "Chapter 0").ref;
		let page = await provider.read({
				...input,
				ref: target,
				offset: 0,
				limit: 5,
			}),
			body = page.text;
		while (page.nextOffset !== null) {
			page = await provider.read({
				...input,
				ref: target,
				offset: page.nextOffset,
				limit: 5,
			});
			body += page.text;
		}
		assert.ok(body.includes("Shared observation 🔬 0"));
		assert.ok(!body.includes("Changed after"));
		assert.throws(() => provider.check({ ...input, address: "another-book" }), /identity|address/i);
		assert.throws(() => provider.check({ ...input, ref: { ...ref, version: null } }), /version/i);
		const links = Array.from({ length: 40 }, (_, i) => "node-" + i);
		let revision = 7;
		for (let i = 0; i < links.length; i += 16)
			await client.edit({
				requestId: "nodes-" + i,
				baseRevision: revision++,
				title: "Graph",
				changes: links.slice(i, i + 16).map((id) => ({
					kind: "put",
					value: {
						id,
						kind: "node",
						title: id,
						text: "node",
						sources: [],
						links: [],
					},
				})),
			});
		await client.edit({
			requestId: "root-links",
			baseRevision: revision++,
			title: "Graph",
			changes: [
				{
					kind: "put",
					value: {
						id: "root",
						kind: "chapter",
						title: "Many links",
						text: "Root",
						sources: [],
						links,
					},
				},
			],
		});
		const graphInput = { ...input, ref: { ...ref, version: String(revision) } },
			root = (await provider.search({ ...graphInput, query: "Many links", limit: 1 })).items[0].ref;
		const refs = [],
			queue = [root];
		while (queue.length) {
			const result = await provider.read({
				...graphInput,
				ref: queue.shift(),
				offset: 0,
				limit: 16384,
			});
			assert.ok(result.sources.length <= 32, "Memo references are bounded");
			for (const next of result.sources) {
				if (next.locator.startsWith("references:")) queue.push(next);
				else refs.push(next);
			}
		}
		assert.equal(new Set(refs.map((ref) => ref.locator)).size, 40, "Every link remains discoverable");
		allowed = false;
		await assert.rejects(provider.read({ ...input, ref: target, offset: 0, limit: 100 }), { code: "denied" });
		assert.equal(f.requests.length, 0);
	} finally {
		await runtime?.close();
		await f.close();
	}
});
