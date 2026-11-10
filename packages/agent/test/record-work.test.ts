import { test } from "node:test";
import { strict as assert } from "node:assert";
import { dirname } from "node:path";
import { createRuntime, openStorageMaintenance } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

test("record work is atomic with its checkpoint and participates in offline recovery fingerprints", async () => {
	const m = await runtimeFixture();
	let after: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const records = m.runtime.records({ namespace: "work" }),
			check = () => {};
		await records.commit(
			{
				requestId: "plan",
				reads: [{ key: "run", version: 0 }],
				writes: [{ key: "run", data: { stage: "planned" } }],
				append: [],
				work: [{ key: "run", state: "planned" }],
			},
			check,
		);
		const file = m.runtime.view().sessionFile,
			sessionId = m.runtime.view().sessionId;
		await m.runtime.close();
		let maintenance = await openStorageMaintenance({
			storageDir: dirname(file),
			expectedSessionId: sessionId,
			stores: [],
		});
		let first;
		try {
			first = await maintenance.work();
			assert.equal(first.pendingRecords, 1);
			assert.ok(first.sample.some((row) => row.kind === "record" && row.state === "planned"));
		} finally {
			await maintenance.close();
		}
		after = await createRuntime({ ...m.config, reopenSessionFile: file });
		await after.records({ namespace: "work" }).commit(
			{
				requestId: "finish",
				reads: [{ key: "run", version: 1 }],
				writes: [{ key: "run", data: { stage: "done" } }],
				append: [],
				work: [{ key: "run", state: null }],
			},
			check,
		);
		await after.close();
		maintenance = await openStorageMaintenance({ storageDir: dirname(file), stores: [] });
		try {
			const work = await maintenance.work();
			assert.equal(work.pendingRecords, 0);
			assert.notEqual(work.fingerprint, first.fingerprint);
		} finally {
			await maintenance.close();
		}
		assert.equal(m.f.requests.length, 0);
	} finally {
		await after?.close();
		await m.close();
	}
});
