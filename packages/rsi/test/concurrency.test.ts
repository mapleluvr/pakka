import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";
import { deferred } from "../../agent/test/fixture.ts";

test("independent ticket services reconcile simultaneous identical submissions to one original receipt", async () => {
	const m = await runtimeFixture(),
		entered = deferred(),
		released = deferred();
	let intercept = false,
		count = 0;
	try {
		const runtime = {
			...m.runtime,
			records: (options: Parameters<typeof m.runtime.records>[0]) => {
				const native = m.runtime.records(options);
				return {
					...native,
					commit: async (...args: Parameters<typeof native.commit>) => {
						if (intercept && args[0].requestId.startsWith("mutation:")) {
							if (++count === 2) entered.resolve();
							await released.promise;
						}
						return native.commit(...args);
					},
				};
			},
		};
		const actor = { id: "author", role: () => "submitter" as const, check() {} };
		const a = (await createTicketService({ runtime, namespace: "competing" })).connect(actor);
		const b = (await createTicketService({ runtime, namespace: "competing" })).connect(actor);
		intercept = true;
		const input = { requestId: "original", title: "Concurrent", body: "same request", sources: [] };
		const results = Promise.allSettled([a.submit(input), b.submit(input)]);
		await entered.promise;
		released.resolve();
		const values = await results;
		assert.equal(values.filter((v) => v.status === "fulfilled").length, 2);
		if (values[0].status === "fulfilled" && values[1].status === "fulfilled")
			assert.deepEqual(values[0].value, values[1].value);
		assert.equal((await a.list()).items.length, 1);
		await b.submit({ ...input, requestId: "next" });
		assert.equal((await a.list()).items.length, 2);
	} finally {
		released.resolve();
		await m.close();
	}
});
