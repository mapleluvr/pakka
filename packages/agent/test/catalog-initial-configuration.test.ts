import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "./runtime-fixture.ts";

// Ignoring initial configuration would create the right name with the wrong model; applying a full preset would change instructions.
test("Catalog initial configuration: explicit model/cwd are committed with creation without applying another Agent preset", async () => {
	const m = await runtimeFixture({
		profiles: [
			{ id: "alternate", model: "alternate-creation-model", systemPrompt: "DO-NOT-APPLY-THIS-PRESET" },
		],
	});
	try {
		const catalog = m.runtime.catalog({
			namespace: "initial.configuration",
			maxDeliveries: 8,
			maxPending: 4,
		});
		const spec = {
			key: "initial",
			profile: "default",
			data: { kind: "creation-test" },
			configuration: { model: "alternate-creation-model", cwd: m.f.cwd },
		};
		const [created] = await catalog.enroll([spec], () => {});
		assert.ok(created);
		assert.deepEqual(await m.runtime.configuration(created.ref), {
			model: "alternate-creation-model",
			cwd: m.f.cwd,
		});
		assert.equal(created.ref.profile, "default");
		assert.equal(m.runtime.view().budget.primaryAttempts, 0);
		assert.equal(m.f.requests.length, 0);
		const bad = { ...spec, key: "unknown-model", configuration: { model: "not-configured", cwd: m.f.cwd } };
		await assert.rejects(
			catalog.enroll([bad], () => {}),
			/model|configuration/i,
		);
		assert.equal((await catalog.snapshot()).members.length, 1);
		assert.equal(m.runtime.view().conversations.length, 2);
	} finally {
		await m.close();
	}
});
