import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { createRuntime } from "@pakka/agent";
import { createHistoryBookService } from "@pakka/dynamite";
import { openMemo } from "@pakka/memo";
import { createDynamiteSourceProvider } from "@pakka/memo/dynamite";
import { fixture } from "./history-source-fixture.mjs";

test("Memo owns source adaptation and final Book/actual-material publication without tainting independent Wiki", async () => {
	const f = await fixture("memo-own-book-publication");
	let runtime, memo;
	try {
		runtime = await createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "main-local",
			apiKey: "local-only",
			limits: { maxConversations: 2, maxPrimaryAttempts: 4, maxAuxiliaryAttempts: 4 },
		});
		const source = runtime.view().conversations[0];
		let bookAllowed = true,
			materialAllowed = true,
			revoke,
			produced = false,
			queued = false,
			entityReads = 0;
		const book = createHistoryBookService({
			records: runtime.records({ namespace: "books" }),
			source: { sessionId: source.sessionId, conversationId: source.conversationId, namespace: "original" },
			check(_actor, action) {
				if (action === "read" && !bookAllowed) throw Error("Book own read revoked");
			},
			checkEvidence() {
				if (!materialAllowed) throw Error("Original material read revoked");
			},
			async readEvidencePage(_actor, ref, offset, limit) {
				const text = "ORIGINAL-MATERIAL";
				return {
					ref,
					offset,
					text: text.slice(offset, offset + limit),
					nextOffset: offset + limit < text.length ? offset + limit : null,
					sources: [],
				};
			},
		});
		await book.connect({ id: "owner", check() {} }).edit({
			requestId: "create",
			baseRevision: 0,
			title: "History",
			changes: [
				{
					kind: "put",
					value: {
						id: "chapter",
						kind: "chapter",
						title: "Chapter",
						text: "BOOK-OWN-PROTECTED",
						sources: [],
						links: [],
					},
				},
				{
					kind: "put",
					value: {
						id: "evidence",
						kind: "chapter",
						title: "Evidence",
						text: "Material provenance",
						sources: [{ artifactId: "material", version: 1 }],
						links: [],
					},
				},
			],
		});
		const adapter = createDynamiteSourceProvider({
			book: {
				...book,
				connect(actor) {
					const client = book.connect(actor);
					return {
						...client,
						read(query) {
							entityReads++;
							return client.read(query);
						},
					};
				},
			},
			check(input) {
				if (input.actorId !== "owner") throw Error("Sharing denied");
			},
		});
		const provider = {
			...adapter,
			check(input) {
				adapter.check(input);
				if (revoke && produced && !queued) {
					queued = true;
					queueMicrotask(revoke);
				}
			},
			read(input) {
				const operation = adapter.read(input);
				operation.then(
					() => {
						produced = true;
					},
					() => {},
				);
				return operation;
			},
			search(input) {
				const operation = adapter.search(input);
				operation.then(
					() => {
						produced = true;
					},
					() => {},
				);
				return operation;
			},
		};
		memo = openMemo({ file: join(f.root, "memo.sqlite"), providers: { book: provider } });
		memo.createLibrary({ id: "library", title: "Library", ownerId: "owner" });
		const client = memo.connect({ id: "owner", check() {} }),
			ref = { kind: "source", libraryId: "library", sourceId: "history", version: "1" },
			chapter = { ...ref, locator: "entry:Y2hhcHRlcg" },
			material = { ...ref, locator: "artifact:ZXZpZGVuY2U:0" };
		await client.registerSource({
			libraryId: "library",
			sourceId: "history",
			requestId: "register",
			baseVersion: 0,
			provider: "book",
			address: book.bookId,
			version: "1",
			title: "History",
			summary: "Book directory",
		});
		const wiki = await client.write({
			libraryId: "library",
			requestId: "wiki",
			baseRevision: 0,
			path: "conclusion.md",
			title: "Conclusion",
			markdown: "INDEPENDENT-KNOWLEDGE",
			summary: "Research",
			sources: [chapter],
		});
		await client.read(ref);
		const first = await client.search({ libraryId: "library", query: "BOOK-OWN" });
		assert.ok(first.cursor);
		await client.search({ libraryId: "library", query: "BOOK-OWN", cursor: first.cursor });
		assert.equal(entityReads, 0, "Directory/search adaptation must not reread every entity body");
		const original = await client.read(chapter),
			verify = client.publicationCheck(original);
		assert.ok(original.text.includes("BOOK-OWN-PROTECTED"));
		bookAllowed = false;
		assert.throws(verify, { code: "denied" });
		bookAllowed = true;
		const actions = [
			[
				() => client.read(chapter),
				() => {
					bookAllowed = false;
				},
			],
			[
				() => client.search({ libraryId: "library", query: "BOOK-OWN", cursor: first.cursor }),
				() => {
					bookAllowed = false;
				},
			],
			[
				() => client.read(material),
				() => {
					materialAllowed = false;
				},
			],
		];
		for (const [run, withdrawal] of actions) {
			bookAllowed = true;
			materialAllowed = true;
			revoke = undefined;
			const control = JSON.stringify(await run());
			assert.match(control, /BOOK-OWN|ORIGINAL-MATERIAL/);
			produced = false;
			queued = false;
			revoke = withdrawal;
			await assert.rejects(run(), { code: "denied" });
			assert.equal(queued, true, "Revocation happened at the Memo source helper, not inside Book");
		}
		revoke = undefined;
		bookAllowed = false;
		const independent = await client.read({
			kind: "wiki",
			libraryId: "library",
			pageId: wiki.pageId,
			revision: 1,
		});
		assert.equal(independent.text, "INDEPENDENT-KNOWLEDGE");
		assert.deepEqual(independent.sources, []);
		client.publicationCheck(independent)();
		assert.equal(f.requests.length, 0);
	} finally {
		memo?.close();
		await runtime?.close();
		await f.close();
	}
});
