import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemo, MemoError, type SourceProvider, type SourceRef } from "../src/index.ts";

const ref: SourceRef = { kind: "source", libraryId: "work", sourceId: "book", version: "1" };
const registration = {
	libraryId: "work",
	sourceId: "book",
	requestId: "register",
	baseVersion: 0,
	provider: "book",
	address: "book:fixed",
	version: "1",
	title: "Book",
	summary: "Registered source",
};
async function fixture(t: import("node:test").TestContext, provider: SourceProvider) {
	const dir = await mkdtemp(join(tmpdir(), "memo-publication-"));
	const memo = openMemo({ file: join(dir, "memo.sqlite"), providers: { book: provider } });
	t.after(async () => {
		memo.close();
		await rm(dir, { recursive: true, force: true });
	});
	memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	const client = memo.connect({ id: "owner", check() {} });
	await client.registerSource(registration);
	return { memo, client };
}
// Removing the public client final check must expose this real source own-permission gap.
for (const action of ["read", "search"] as const) {
	test(`Memo ${action} rechecks source own authority after the source helper returns`, async (t) => {
		let allowed = true,
			armed = false,
			produced = false,
			queued = false;
		const provider: SourceProvider = {
			check() {
				if (!allowed) throw new MemoError("denied", "Source own read revoked");
				if (armed && produced && !queued) {
					queued = true;
					queueMicrotask(() => {
						allowed = false;
					});
				}
			},
			async read(input) {
				produced = true;
				return { ref: input.ref, text: "SOURCE-OWN-BODY", nextOffset: null, sources: [] };
			},
			async search() {
				produced = true;
				return {
					items: [{ ref, title: "Source", path: "chapter", excerpt: "SOURCE-OWN-BODY" }],
					cursor: null,
				};
			},
		};
		const { client } = await fixture(t, provider);
		const first = await client.search({ libraryId: "work", query: "needle" });
		assert.ok(first.cursor);
		const invoke = () =>
			action === "read"
				? client.read(ref)
				: client.search({ libraryId: "work", query: "needle", cursor: first.cursor! });
		assert.match(JSON.stringify(await invoke()), /SOURCE-OWN-BODY/);
		produced = false;
		armed = true;
		await assert.rejects(invoke(), { code: "denied" });
		assert.equal(allowed, false);
	});
}

test("Memo retains the original source result verifier without granting copied or other-client results", async (t) => {
	let allowed = true,
		mode = "valid";
	const replies = new WeakSet<object>();
	const provider: SourceProvider = {
		check() {},
		async read(input) {
			const result = Object.freeze({ ref: input.ref, text: "FIXED SOURCE", nextOffset: null, sources: [] });
			replies.add(result);
			return result;
		},
		publicationCheck(result: unknown) {
			assert.ok(typeof result === "object" && result !== null && replies.has(result));
			if (mode === "async") return (async () => {}) as unknown as () => void;
			return () => {
				if (!allowed) throw new MemoError("denied", "Resolved object revoked");
			};
		},
	};
	const { client, memo } = await fixture(t, provider);
	const value = await client.read(ref);
	assert.equal(value.text, "FIXED SOURCE");
	assert.equal(typeof client.publicationCheck, "function");
	client.publicationCheck(value)();
	assert.throws(() => client.publicationCheck(structuredClone(value)), { code: "invalid" });
	assert.throws(() => memo.connect({ id: "owner", check() {} }).publicationCheck(value), { code: "invalid" });
	allowed = false;
	assert.throws(() => client.publicationCheck(value)(), { code: "denied" });
	allowed = true;
	mode = "async";
	await assert.rejects(client.read(ref), { code: "unavailable" });
	mode = "valid";
	assert.equal((await client.read(ref)).text, "FIXED SOURCE");
});
