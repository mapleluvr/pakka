import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { openMemo, type MemoOptions } from "../src/index.ts";
const owner = { id: "owner", check() {} };
const write = {
	libraryId: "work",
	requestId: "first",
	baseRevision: 0,
	path: "a.md",
	title: "A",
	markdown: "PRIVATE BODY",
	summary: "created",
	sources: [],
};
async function fixture(t: import("node:test").TestContext, providers?: MemoOptions["providers"]) {
	const dir = await mkdtemp(join(tmpdir(), "memo-review-boundary-")),
		file = join(dir, "memo.sqlite"),
		service = openMemo({ file, providers });
	service.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	t.after(async () => {
		service.close();
		await rm(dir, { recursive: true, force: true });
	});
	return { service, client: service.connect(owner) };
}
test("Wiki body is denied when the actor lease expires during citation filtering", async (t) => {
	const f = await fixture(t),
		seed = await f.client.write(write);
	const ref = { kind: "wiki" as const, libraryId: "work", pageId: seed.pageId!, revision: 1 };
	const page = await f.client.write({ ...write, requestId: "cited", path: "cited.md", sources: [ref] });
	let checks = 0;
	const reader = f.service.connect({
		id: "owner",
		check() {
			if (++checks >= 3) throw Error("Lease revoked during citation filter");
		},
	});
	await assert.rejects(reader.read({ ...ref, pageId: page.pageId! }), { code: "denied" });
});
test("provider mutation cannot change the original source reference used for validation", async (t) => {
	const f = await fixture(t, {
		host: {
			check() {},
			async read(input) {
				Reflect.set(input.ref, "version", "v2");
				return { ref: input.ref, text: "content", nextOffset: null };
			},
		},
	});
	await f.client.registerSource({
		libraryId: "work",
		sourceId: "book",
		requestId: "register",
		baseVersion: 0,
		provider: "host",
		address: "book:1",
		version: "v1",
		title: "Book",
		summary: "Book",
	});
	const ref = { kind: "source" as const, libraryId: "work", sourceId: "book", version: "v1" };
	const result = await f.client.read(ref);
	assert.deepEqual(result.ref, ref, "success must use the original requested source version");
});
test("malformed grant role is invalid and cannot poison other libraries or leave a receipt", async (t) => {
	for (const [name, role] of [
		["array", ["reader"]],
		["boxed", new String("reader")],
		["object", { reader: true }],
	] as const)
		await t.test(name, async (t) => {
			const f = await fixture(t);
			f.service.createLibrary({ id: "other", title: "Other", ownerId: "alice" });
			const alice = f.service.connect({ id: "alice", check() {} });
			await assert.rejects(
				f.client.grant({ libraryId: "work", requestId: "bad", actorId: "bob", role: role as never }),
				{ code: "invalid" },
			);
			assert.equal(await f.client.lookup("bad"), null);
			assert.equal((await alice.list({ libraryId: "other" })).items.length, 0);
			const saved = await alice.write({ ...write, libraryId: "other" });
			assert.equal(saved.revision, 1);
		});
});
test(
	"foreign hot rollback journal is refused without modifying database or journal bytes",
	{ timeout: 20000 },
	async () => {
		const dir = await mkdtemp(join(tmpdir(), "memo-foreign-")),
			file = join(dir, "main.sqlite");
		const child = fork(
			fileURLToPath(new URL("../../agent/test/sqlite-foreign-child.ts", import.meta.url)),
			[file],
			{ silent: true, execArgv: ["--experimental-strip-types"] },
		);
		let stderr = "";
		child.stderr!.on("data", (d) => {
			stderr += String(d);
		});
		try {
			const [ready] = await Promise.race([
				once(child, "message", { signal: AbortSignal.timeout(15000) }),
				once(child, "exit").then(() => {
					throw Error("Fixture exited: " + stderr);
				}),
			]);
			assert.equal(ready.ready, true);
			const exited = once(child, "exit");
			child.kill("SIGKILL");
			await exited;
			const before = await readFile(file),
				journal = await readFile(file + "-journal");
			assert.equal(journal.subarray(0, 8).toString("hex"), "d9d505f920a163d7");
			assert.throws(() => openMemo({ file }), { code: "unavailable" });
			assert.ok(
				(await readFile(file)).equals(before),
				"identity refusal must not roll back a foreign transaction",
			);
			assert.ok(
				(await readFile(file + "-journal")).equals(journal),
				"identity refusal preserves the foreign hot journal",
			);
		} finally {
			if (child.exitCode === null && child.signalCode === null) {
				const exited = once(child, "exit");
				child.kill("SIGKILL");
				await exited;
			}
			await rm(dir, { recursive: true, force: true });
		}
	},
);
