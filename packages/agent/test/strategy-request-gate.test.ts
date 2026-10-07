import { test } from "node:test";
import assert from "node:assert/strict";
import { binding, inferencePolicy } from "./strategy-fixture.ts";
import { fixture, seed } from "./fixture.ts";

test("main provider failure cannot trigger hidden HTTP transport retries", { timeout: 15000 }, async () => {
	const f = await fixture({}, () => ({ error: 503 }));
	try {
		const host = await f.start();
		const user = host.connect("user", ["input.submit"]);
		await user.submit({ key: "failed", text: "ONE-CALL" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 1);
		assert.equal(host.view().phase, "failed");
	} finally {
		await f.close();
	}
});

for (const kind of ["duplicate", "nonfinite", "unlisted"])
	test(`bootstrap ${kind} inference definitions fail before any HTTP`, async () => {
		const f = await fixture();
		try {
			const config = inferencePolicy(f.endpoint);
			if (kind === "duplicate")
				config.inference = {
					...config.inference!,
					models: [config.inference!.models[0], config.inference!.models[0]],
				};
			if (kind === "nonfinite")
				config.inference = {
					...config.inference!,
					models: [{ ...config.inference!.models[0], maxTokens: Infinity }],
				};
			if (kind === "unlisted")
				config.inference = {
					...config.inference!,
					policies: [{ ...config.inference!.policies[0], modelKeys: ["foreign"] }],
				};
			await assert.rejects(f.start(config), /model|definition|allowlist|finite/);
			assert.equal(f.requests.length, 0);
		} finally {
			await f.close();
		}
	});

for (const kind of ["expired-frame", "foreign-principal", "artifact-only-write"])
	test(`artifact authority refuses ${kind} without persisting foreign data`, async () => {
		const f = await fixture();
		try {
			const host = await f.start();
			const { client: user } = await seed(host);
			const owner = host.connect("owner", ["real_context.write", "context_artifacts.write"]);
			owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
			const b = binding(owner),
				frame = b.readFrame();
			if (kind === "expired-frame") {
				await user.submit({ key: "tail", text: "TAIL" });
				await host.waitForIdle();
				assert.throws(
					() => b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ bad: true }] }),
					/basis|scope|source/,
				);
			}
			if (kind === "foreign-principal") {
				const foreign = host.connect("foreign", ["context_artifacts.write"]);
				assert.throws(() => foreign.bindStrategy("strategy"), /owner/);
			}
			if (kind === "artifact-only-write") {
				owner.deactivateStrategy("strategy");
				owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
				const real = binding(owner);
				assert.throws(
					() =>
						real.artifacts.append(real.readFrame().basis, { expectedVersion: 0, records: [{ bad: true }] }),
					/context_artifacts/,
				);
			}
			assert.deepEqual(binding(owner).readFrame().artifacts.records, []);
		} finally {
			await f.close();
		}
	});
