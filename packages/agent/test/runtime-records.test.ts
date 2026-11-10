import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { blockSqliteWrites } from "./native-storage.ts";

const check = () => {};
function records(runtime: Awaited<ReturnType<typeof createRuntime>>) {
	assert.equal(typeof runtime.records, "function", "The public bounded records port is missing");
	return runtime.records({ namespace: "tickets" });
}

test("records: atomic heads, history and original receipts survive reopen without inference", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const store = records(m.runtime);
		const input = {
			requestId: "create",
			reads: [{ key: "ticket-a", version: 0 }],
			writes: [{ key: "ticket-a", data: { title: "Original", revision: 1 } }],
			append: [{ stream: "events-a", data: { kind: "created", revision: 1 } }],
		};
		const receipt = await store.commit(input, check);
		assert.equal(receipt.sequence, 1);
		assert.equal((await store.get("ticket-a", check)).version, 1);
		assert.deepEqual(await store.commit(input, check), receipt);
		await assert.rejects(
			store.commit({ ...input, writes: [{ key: "ticket-a", data: { title: "Forged" } }] }, check),
			/identity|conflict/i,
		);
		await assert.rejects(store.commit({ ...input, requestId: "stale" }, check), /version|conflict/i);
		assert.equal((await store.page({ stream: "events-a", limit: 10 }, check)).items.length, 1);
		const sessionFile = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: sessionFile });
		const after = records(reopened);
		assert.deepEqual(await after.receipt("create", check), receipt);
		assert.deepEqual(await after.commit(input, check), receipt);
		assert.deepEqual((await after.get("ticket-a", check)).data, { title: "Original", revision: 1 });
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("records: finite pages traverse growing history and bind cursors to the original stream", async () => {
	const m = await runtimeFixture();
	try {
		const store = records(m.runtime);
		for (let i = 0; i < 140; i++)
			await store.commit(
				{
					requestId: `write-${i}`,
					reads: [],
					writes: [],
					append: [{ stream: "history", data: { n: i, text: "x".repeat(1100) } }],
				},
				check,
			);
		let page = await store.page({ stream: "history", limit: 20, maxBytes: 4096 }, check);
		assert.ok(page.items.length > 0 && page.items.length < 20);
		assert.ok(Buffer.byteLength(JSON.stringify(page)) < 4096);
		assert.ok(page.cursor);
		await assert.rejects(store.page({ stream: "other", cursor: page.cursor!, limit: 20 }, check), /cursor/i);
		const seen = page.items.map((r) => r.data.n);
		while (page.cursor) {
			page = await store.page({ stream: "history", cursor: page.cursor, limit: 20, maxBytes: 4096 }, check);
			seen.push(...page.items.map((r) => r.data.n));
		}
		assert.deepEqual(
			seen,
			Array.from({ length: 140 }, (_, i) => 139 - i),
		);
		const denied = () => {
			throw Error("revoked");
		};
		await assert.rejects(store.page({ stream: "history" }, denied), /revoked/);
		await assert.rejects(store.get("missing", denied), /revoked/);
	} finally {
		await m.close();
	}
});

test("records: a rejected second record or revoked commit cannot partially mutate the first", async () => {
	const m = await runtimeFixture();
	try {
		const store = records(m.runtime);
		await store.commit(
			{
				requestId: "one",
				reads: [{ key: "b", version: 0 }],
				writes: [{ key: "b", data: { value: 1 } }],
				append: [],
			},
			check,
		);
		await assert.rejects(
			store.commit(
				{
					requestId: "bad",
					reads: [
						{ key: "a", version: 0 },
						{ key: "b", version: 0 },
					],
					writes: [
						{ key: "a", data: { value: 2 } },
						{ key: "b", data: { value: 2 } },
					],
					append: [{ stream: "audit", data: { value: 2 } }],
				},
				check,
			),
			/version|conflict/i,
		);
		assert.equal((await store.get("a", check)).data, null);
		assert.equal((await store.page({ stream: "audit" }, check)).items.length, 0);
		assert.equal(await store.receipt("bad", check), null);
		await assert.rejects(
			store.commit(
				{
					requestId: "denied",
					reads: [{ key: "a", version: 0 }],
					writes: [{ key: "a", data: { value: 3 } }],
					append: [],
				},
				() => {
					throw Error("revoked");
				},
			),
			{ name: "RecordsRequestRefusedError", code: "denied" },
		);
		assert.equal((await store.get("a", check)).data, null);
	} finally {
		await m.close();
	}
});

test("records: a real SQLite write fault never publishes a successful receipt", async () => {
	const m = await runtimeFixture();
	try {
		const store = records(m.runtime);
		const lock = blockSqliteWrites(m.runtime.view().sessionFile);
		try {
			await assert.rejects(
				store.commit(
					{
						requestId: "locked",
						reads: [{ key: "a", version: 0 }],
						writes: [{ key: "a", data: { value: 1 } }],
						append: [],
					},
					check,
				),
			);
		} finally {
			lock();
		}
		assert.equal(m.runtime.view().phase, "failed");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
