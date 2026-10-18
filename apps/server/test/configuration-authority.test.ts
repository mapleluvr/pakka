import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime } from "@pakka/agent";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";

test("Configuration authority: a narrowed project ceiling is rechecked before committing independent cwd", async () => {
	const m = await runtimeFixture();
	await m.runtime.close();
	const other = join(m.f.root, "restricted");
	await mkdir(other);
	const runtime = await createRuntime({
		...m.config,
		dataDir: join(m.f.root, "authority"),
		profiles: [{ id: "extra", cwd: other }],
	});
	try {
		const people = await createPocketPeople({ runtime, namespace: "narrow-people" }),
			owner = await people.initializeOwner("Owner"),
			actor = await people.authenticate(owner.token);
		let armed = false,
			limited = false;
		// Deterministic host-policy change between the first directory validation and commit checks.
		const workspace = createPocketWorkspace({
			runtime,
			people,
			catalog: { namespace: "narrow", maxDeliveries: 8, maxPending: 2 },
			profileCeiling: () => {
				const current = limited ? ["default"] : ["default", "extra"];
				if (armed) limited = true;
				return current;
			},
		});
		const client = workspace.bind(actor),
			ref = await client.create({ requestId: "resource", name: "Project", profile: "default" });
		armed = true;
		await assert.rejects(client.configureAgent(ref, { cwd: other }), /denied/i);
		assert.deepEqual(await runtime.configuration(ref), { model: "local-model", cwd: m.f.cwd });
		assert.equal(m.f.requests.length, 0);
	} finally {
		await runtime.close();
		await m.close();
	}
});
