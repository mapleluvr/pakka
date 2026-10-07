import { test } from "node:test";
import assert from "node:assert/strict";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";
import { deferred, fixture, raw, seed, text } from "./fixture.ts";

test("auxiliary inference consumes 64/128 on wire, is bounded, and leaves main C2 untouched", async () => {
	const f = await fixture();
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		assert.doesNotMatch(JSON.stringify(b.models()), /SUMMARY-SECRET|127\.0\.0\.1|apiKey|endpoint/);
		const job = b.createJob(frame.basis, {
			planId: "fixed",
			targetEntryIds: [target(frame)],
			contextEntryIds: [],
			maxCalls: 2,
		});
		const before = await raw(host);
		for (const cap of [64, 128]) {
			const result = await job.infer({
				modelKey: "summary",
				systemPrompt: "SUMMARY-SYSTEM",
				prompt: "FIXED-TARGET",
				maxOutputTokens: cap,
			});
			assert.equal(result.status, "completed");
			assert.equal(result.text, "LOCAL-ANSWER");
			assert.equal(result.usage?.cost, null, "Unpriced model usage is not proof of zero billing cost");
			assert.equal(f.requests.at(-1)!.max_tokens, cap);
		}
		await assert.rejects(job.infer({ modelKey: "summary", prompt: "EXTRA", maxOutputTokens: 64 }), /budget/);
		assert.equal(await raw(host), before);
		assert.equal(b.audit().length, 2);
		assert.equal(f.requests.length, 3);
		await user.submit({ key: "main", text: "MAIN-NEXT" });
		await host.waitForIdle();
		assert.doesNotMatch(text(f.requests.at(-1)!), /FIXED-TARGET|SUMMARY-SYSTEM/);
	} finally {
		await f.close();
	}
});

test("artifact-only binding cannot spend without an explicit inference grant", async () => {
	const f = await fixture();
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		await seed(host);
		const owner = host.connect("owner", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		assert.throws(
			() =>
				b.createJob(frame.basis, { planId: "unauthorized", targetEntryIds: [target(frame)], maxCalls: 1 }),
			/model.infer/,
		);
		assert.equal(f.requests.length, 1);
	} finally {
		await f.close();
	}
});

test("source job allows tail growth but rejects source edits before publication or next attempt", async () => {
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
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, {
			planId: "growth",
			targetEntryIds: [target(frame)],
			contextEntryIds: [],
			maxCalls: 2,
		});
		const pending = job.infer({ modelKey: "summary", prompt: "FIXED", maxOutputTokens: 64 });
		await entered.promise;
		await user.submit({ key: "tail", text: "ORDINARY-TAIL" });
		await host.waitForIdle();
		release.resolve();
		assert.equal((await pending).status, "completed");
		assert.doesNotThrow(() => job.check());
		assert.equal(
			(await owner.commit(owner.capture(), { type: "edit", targetId: target(frame), text: "EDITED" })).status,
			"committed",
		);
		assert.throws(() => job.check(), /source/);
		assert.throws(
			() => b.artifacts.append(job.scope, { expectedVersion: 0, records: [{ kind: "stale" }] }),
			/source|scope/,
		);
		await assert.rejects(job.infer({ modelKey: "summary", prompt: "RETRY" }), /source|scope/);
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
	} finally {
		release.resolve();
		await f.close();
	}
});

for (const change of ["edit", "reload", "newSession", "owner", "ABA", "dispose"])
	test(`pending inference ${change} quarantines completion and blocks later attempts`, async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture({}, async (p) => {
			if (p.model === "summary-model") {
				entered.resolve();
				await release.promise;
			}
			return { text: "LATE" };
		});
		try {
			const host = await f.start(inferencePolicy(f.endpoint));
			const { receipt } = await seed(host);
			const owner = host.connect("owner", [
				"real_context.write",
				"context_artifacts.write",
				"model.infer",
				"branch.control",
			]);
			owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
			const b = binding(owner),
				frame = b.readFrame();
			const job = b.createJob(frame.basis, { planId: change, targetEntryIds: [target(frame)], maxCalls: 2 });
			const pending = job.infer({ modelKey: "summary", prompt: "FIXED", maxOutputTokens: 64 });
			await entered.promise;
			if (change === "edit")
				await owner.commit(owner.capture(), { type: "edit", targetId: target(frame), text: "CHANGED" });
			if (change === "reload") await host.reload();
			if (change === "newSession") await host.newSession();
			if (change === "owner") owner.deactivateStrategy("strategy");
			if (change === "ABA") {
				const leaf = host.view().leafId!;
				owner.branch(owner.capture(), receipt.entryId!);
				owner.branch(owner.capture(), leaf);
			}
			if (change === "dispose") await host.dispose();
			release.resolve();
			assert.equal((await pending).status, "quarantined");
			await assert.rejects(
				job.infer({ modelKey: "summary", prompt: "RETRY" }),
				/source|scope|inactive|lease|disposed|cancel/,
			);
			assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
			assert.ok(job.signal.aborted);
		} finally {
			release.resolve();
			await f.close();
		}
	});

test("provider failure has unknown usage and never causes implicit transport or model retry", async () => {
	const f = await fixture({}, (p) => (p.model === "summary-model" ? { error: 503 } : { text: "MAIN" }));
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		await seed(host);
		const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, { planId: "failure", targetEntryIds: [target(frame)], maxCalls: 1 });
		const result = await job.infer({ modelKey: "summary", prompt: "FAIL", maxOutputTokens: 64 });
		assert.equal(result.status, "failed");
		assert.equal(result.usageStatus, "unknown");
		assert.equal(f.requests.length, 2);
		assert.equal(b.audit()[0].usageStatus, "unknown");
	} finally {
		await f.close();
	}
});
