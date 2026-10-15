import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "./runtime-fixture.ts";

const options = { namespace: "bounded-jobs", maxJobs: 1, maxBytes: 65536 };

// Unknown fields are not approved job payload or a place to smuggle private host configuration into receipts.
test("Pocket jobs: unapproved programs and extra authority/configuration fields are rejected before execution", async () => {
	let executions = 0;
	const m = await runtimeFixture({
		jobs: [
			{
				id: "approved",
				version: 1,
				authorize: () => {},
				run: async (ctx) => {
					executions++;
					await ctx.complete({ ok: true });
				},
			},
		],
	});
	try {
		const port = m.runtime.jobs(options),
			spec = {
				requestId: "one",
				actorId: "human",
				target: m.runtime.view().conversations[0]!,
				definition: "approved",
				payload: {},
			};
		await assert.rejects(
			port.start({ ...spec, definition: "unknown" }, () => {}),
			/unapproved/i,
		);
		await assert.rejects(
			port.start({ ...spec, ...{ endpoint: "PRIVATE-CONFIG-CANARY" } }, () => {}),
			/invalid|unknown|field/i,
		);
		await assert.rejects(
			port.start({ ...spec, payload: { function: () => 1 } } as never, () => {}),
			/JSON|clone|data/i,
		);
		assert.equal(executions, 0);
		assert.equal(m.f.requests.length, 0);
		assert.equal(m.runtime.view().phase, "ready");
	} finally {
		await m.close();
	}
});

// Distinct submissions must consume real retention capacity; retries must not allocate extra native tasks.
test("Pocket jobs: concurrent retries share one native execution and options conflicts do not poison the Session", async () => {
	let executions = 0;
	const m = await runtimeFixture({
		jobs: [
			{
				id: "approved",
				version: 1,
				authorize: () => {},
				run: async (ctx) => {
					executions++;
					await ctx.complete({ ok: true });
				},
			},
		],
	});
	try {
		const port = m.runtime.jobs(options),
			spec = {
				requestId: "one",
				actorId: "human",
				target: m.runtime.view().conversations[0]!,
				definition: "approved",
				payload: {},
			};
		const receipts = await Promise.all(Array.from({ length: 8 }, () => port.start(spec, () => {})));
		assert.equal(new Set(receipts.map((r) => r.id)).size, 1);
		const done = await port.wait(receipts[0]!.id, () => {});
		assert.equal(done.state, "done");
		assert.equal(executions, 1);
		await assert.rejects(
			port.start({ ...spec, requestId: "two" }, () => {}),
			/capacity/i,
		);
		assert.equal(executions, 1);
		await assert.rejects(
			m.runtime.jobs({ ...options, maxJobs: 2 }).receipt(done.id, () => {}),
			/conflict/i,
		);
		assert.equal(m.runtime.view().phase, "ready");
		assert.equal((await port.receipt(done.id, () => {})).state, "done");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
