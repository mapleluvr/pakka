import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deferred } from "./fixture.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

for (const outcome of ["revoked", "unknown"] as const)
	test(
		`reload during an awaited projection: ${outcome} blocks dispatch without losing the failure boundary`,
		{ timeout: 15000 },
		async () => {
			const entered = deferred(),
				release = deferred();
			const m = await runtimeFixture();
			try {
				const host = m.runtime.root();
				const user = host.connect("input-owner", ["input.submit"]);
				const owner = host.connect("projection-owner", ["real_context.write"]);
				owner.activateStrategy({ id: "projection", hooks: ["real_context.write"] });
				owner.bindStrategy("projection").installProjector(async (frame) => {
					entered.resolve();
					await release.promise;
					if (outcome === "unknown") throw new Error("UNKNOWN-PROJECTION-FAILURE");
					return { status: "disabled", basis: frame.basis };
				});
				const original = await user.submit({ key: "original", text: "ORIGINAL-BLOCKED-BEFORE-PROVIDER" });
				await entered.promise;
				const transition = host.reload();
				const settled =
					outcome === "unknown" ? assert.rejects(transition, /UNKNOWN-PROJECTION-FAILURE/) : transition;
				assert.equal(host.view().phase, "transitioning");
				release.resolve();
				await settled;
				assert.equal(m.f.requests.length, 0);
				assert.equal(m.runtime.view().budget.primaryAttempts, 0);
				if (outcome === "unknown") {
					assert.equal(host.view().phase, "failed");
					assert.throws(() => host.connect("must-not-recover", ["input.submit"]), /failed/);
				} else {
					assert.equal(host.view().phase, "ready");
					const preserved = user.receipt(original.id);
					await user.submit({ key: "explicit-fresh", text: "EXPLICIT-FRESH-AFTER-RELOAD" });
					await host.waitForIdle();
					assert.equal(m.f.requests.length, 1);
					assert.equal(m.runtime.view().budget.primaryAttempts, 1);
					assert.deepEqual(user.receipt(original.id), preserved);
				}
			} finally {
				release.resolve();
				await m.close();
			}
		},
	);
