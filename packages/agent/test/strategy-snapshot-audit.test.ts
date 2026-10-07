import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProjectionPlan } from "../src/index.ts";
import { fixture, seed, text, deferred } from "./fixture.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";

test("synchronous projector return is snapshotted before later caller mutation", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
		const b = binding(owner);
		b.installProjector((frame) => {
			const range = { sourceEntryIds: [target(frame)], summary: "AUTHORIZED-RETURN" };
			const plan: ProjectionPlan = { status: "apply", basis: frame.basis, replacements: [range] };
			queueMicrotask(() => {
				range.summary = "MUTATED-AFTER-RETURN";
			});
			return plan;
		});
		await user.submit({ key: "next", text: "NEXT" });
		await host.waitForIdle();
		assert.match(text(f.requests[1]), /AUTHORIZED-RETURN/);
		assert.doesNotMatch(text(f.requests[1]), /MUTATED-AFTER-RETURN/);
	} finally {
		await f.close();
	}
});

test("pending auxiliary reservation remains observable with unknown usage until completion", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({}, async (p) => {
		if (p.model === "summary-model") {
			entered.resolve();
			await release.promise;
		}
		return { text: "ANSWER" };
	});
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		await seed(host);
		const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, { planId: "pending", targetEntryIds: [target(frame)], maxCalls: 1 });
		const pending = job.infer({ modelKey: "summary", prompt: "SOURCE", maxOutputTokens: 64 });
		await entered.promise;
		assert.equal(b.audit().length, 1);
		assert.equal(b.audit()[0].usageStatus, "unknown");
		assert.match(b.audit()[0].reason!, /completion|outcome/i);
		release.resolve();
		assert.equal((await pending).status, "completed");
		assert.equal(b.audit().length, 1);
		assert.equal(b.audit()[0].usageStatus, "known");
	} finally {
		release.resolve();
		await f.close();
	}
});
