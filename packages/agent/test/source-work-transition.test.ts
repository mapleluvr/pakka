import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, seed, deferred } from "./fixture.ts";
import { inferencePolicy } from "./strategy-fixture.ts";
import { readStorageText } from "./native-storage.ts";
import type { SourceJob } from "../src/index.ts";

const request = { modelKey: "summary", prompt: "FIXED-RELOAD-REQUEST", maxOutputTokens: 32 };
test("reload permits only existing attempt settlement and persists quarantine before returning", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({}, async (payload) => {
		if (payload.model === "summary-model") {
			entered.resolve();
			await release.promise;
			return { text: "LATE-RESULT" };
		}
		return { text: "MAIN" };
	});
	let pending: Promise<any> | undefined;
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		await seed(host);
		const owner = host.connect("transition-owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = owner.bindStrategy("strategy"),
			frame = b.readFrame(),
			target = frame.projection.find((e) => e.messages.some((m) => m.role === "assistant"))!.sourceEntryId;
		const job = b.createJob(frame.basis, {
			planId: "original-reload-plan",
			targetEntryIds: [target],
			maxCalls: 2,
		});
		const unused = b.createJob(frame.basis, {
			planId: "unused-reload-plan",
			targetEntryIds: [target],
			maxCalls: 2,
		});
		pending = job.infer(request);
		await entered.promise;
		const reload = host.reload();
		await assert.rejects(unused.infer(request), /transition|invalid|stale|cancel/i);
		await reload;
		release.resolve();
		const result = await pending;
		assert.equal(host.view().phase, "ready", host.view().lastError ?? "reload did not settle");
		assert.equal(result.status, "quarantined");
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
		const current = owner.bindStrategy("strategy"),
			audit = current.audit();
		assert.equal(audit.length, 1);
		assert.equal(audit[0].attemptId, result.attemptId);
		assert.equal(audit[0].status, "quarantined");
		assert.throws(() => job.check(), /invalid|stale|cancel/i);
	} finally {
		release.resolve();
		if (pending) await Promise.allSettled([pending]);
		await f.close();
	}
});

test("dispose awaits original attempt quarantine and stores it before releasing the writer", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({}, async (payload) => {
		if (payload.model === "summary-model") {
			entered.resolve();
			await release.promise;
		}
		return { text: "LATE-DISPOSE-RESULT" };
	});
	let pending: ReturnType<SourceJob["infer"]> | undefined;
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		await seed(host);
		const file = host.view().sessionFile;
		const owner = host.connect("dispose-owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = owner.bindStrategy("strategy"),
			frame = b.readFrame();
		const target = frame.projection.find((e) =>
			e.messages.some((m) => m.role === "assistant"),
		)!.sourceEntryId;
		const job = b.createJob(frame.basis, { planId: "dispose-plan", targetEntryIds: [target], maxCalls: 2 });
		pending = job.infer(request);
		await entered.promise;
		await host.dispose();
		const result = await pending;
		assert.equal(result.status, "quarantined");
		assert.equal(host.view().phase, "disposed");
		assert.ok(job.signal.aborted);
		await assert.rejects(job.infer(request), /disposed|cancel|inactive|stale/i);
		const snapshot = JSON.parse(await readStorageText(file));
		const work = snapshot.documents.find(
			(row: { record: { kind: string }; value: { state?: { jobId?: string } } }) =>
				row.record.kind === "pakka.source-work" && row.value.state?.jobId === job.id,
		).value.state;
		assert.equal(work.result.status, "quarantined");
		assert.equal(work.result.attemptId, result.attemptId);
		assert.equal(work.attemptIds.length, 1);
		assert.equal(work.pendingAttempt, null);
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
	} finally {
		release.resolve();
		if (pending) await Promise.allSettled([pending]);
		await f.close();
	}
});
