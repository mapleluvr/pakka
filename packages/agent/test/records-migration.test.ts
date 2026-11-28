import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "./runtime-fixture.ts";

test("record migration freezes the exact legacy snapshot atomically before publishing new records", async () => {
	const m = await runtimeFixture();
	try {
		const check = () => {},
			store = m.runtime.store({ namespace: "legacy-lock", maxBytes: 4096 });
		await store.compareAndSet(0, { schema: 1, original: true }, check);
		const records = m.runtime.records({ namespace: "legacy-lock" });
		const input = {
			requestId: "freeze",
			reads: [{ key: "layout", version: 0 }],
			writes: [{ key: "layout", data: { schema: "migrating" } }],
			append: [],
			freezeLegacy: { expectedVersion: 1, maxBytes: 4096 },
		};
		await records.commit(input, check);
		await assert.rejects(store.compareAndSet(1, { schema: 1, changed: true }, check), /migrat|frozen/i);
		assert.deepEqual((await store.snapshot()).data, { schema: 1, original: true });
		assert.deepEqual(await records.commit(input, check), await records.receipt("freeze", check));
		assert.equal(m.runtime.view().phase, "ready");
	} finally {
		await m.close();
	}
});
