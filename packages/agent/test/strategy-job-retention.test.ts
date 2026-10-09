import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";
import { fixture, seed } from "./fixture.ts";

async function collect(): Promise<void> {
	for (let i = 0; i < 8; i++) {
		await setImmediate();
		global.gc!();
	}
}

test("source jobs retain fingerprints, not complete historical frames", async () => {
	assert.equal(typeof global.gc, "function", "Run the retention gate with --expose-gc");
	const f = await fixture();
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		await seed(host);
		const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner);
		const { job, weak } = (() => {
			const frame = b.readFrame();
			return {
				job: b.createJob(frame.basis, { planId: "live", targetEntryIds: [target(frame)], maxCalls: 1 }),
				weak: new WeakRef(frame),
			};
		})();
		await collect();
		assert.equal(weak.deref(), undefined, "Job must not retain the complete frame after source validation");
		assert.doesNotThrow(() => job.check(), "Collecting a snapshot must not revoke a valid scope");
		assert.equal(
			b.artifacts.append(job.scope, { expectedVersion: 0, records: [{ adopted: true }] }).status,
			"committed",
		);
	} finally {
		await f.close();
	}
});

for (const invalidation of ["cancel", "edit", "newSession"])
	test(`unusable source jobs are released after ${invalidation}`, async () => {
		assert.equal(typeof global.gc, "function");
		const f = await fixture();
		try {
			const host = await f.start(inferencePolicy(f.endpoint));
			await seed(host);
			const owner = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
			owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
			const b = binding(owner),
				refs: WeakRef<AbortSignal>[] = [];
			const id = target(b.readFrame());
			(() => {
				for (let i = 0; i < 200; i++) {
					const frame = b.readFrame(),
						job = b.createJob(frame.basis, { planId: String(i), targetEntryIds: [id], maxCalls: 1 });
					refs.push(new WeakRef(job.signal));
					if (invalidation === "cancel") job.cancel();
				}
			})();
			if (invalidation === "edit")
				assert.equal(
					(await owner.commit(owner.capture(), { type: "edit", targetId: id, text: "CHANGED" })).status,
					"committed",
				);
			if (invalidation === "newSession") await host.newSession();
			await collect();
			assert.equal(
				refs.filter((ref) => ref.deref() !== undefined).length,
				0,
				"Cancelled/invalid jobs must not be held by host tracking",
			);
			assert.equal(f.requests.length, 1, "Retention checks do not spend auxiliary calls");
		} finally {
			await f.close();
		}
	});
