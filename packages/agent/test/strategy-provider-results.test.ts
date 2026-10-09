import { test } from "node:test";
import assert from "node:assert/strict";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";
import { fixture, seed } from "./fixture.ts";

for (const finishReason of ["length", "tool_calls"])
	test(`auxiliary SSE ${finishReason} is incomplete with measured usage retained`, async () => {
		const f = await fixture({}, (p) => ({
			text: "PARTIAL SUMMARY",
			finishReason: p.model === "summary-model" ? finishReason : "stop",
		}));
		try {
			const host = await f.start(inferencePolicy(f.endpoint));
			await seed(host);
			const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
			owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
			const b = binding(owner),
				frame = b.readFrame(),
				job = b.createJob(frame.basis, {
					planId: "incomplete",
					targetEntryIds: [target(frame)],
					maxCalls: 1,
				});
			const result = await job.infer({ modelKey: "summary", prompt: "FIXED", maxOutputTokens: 64 });
			assert.equal(result.status, "failed");
			assert.match(result.reason!, /incomplete|length|toolUse/i);
			assert.equal(result.usageStatus, "known");
			assert.equal(result.usage!.output, 2);
			assert.equal(b.audit()[0].status, "failed");
			assert.equal(b.audit()[0].usage!.output, 2);
			assert.equal(f.requests.at(-1)!.max_tokens, 64);
		} finally {
			await f.close();
		}
	});

for (const reported of [false, true])
	test(`successful auxiliary usage ${reported ? "has measurements" : "does not fabricate zero"}`, async () => {
		const f = await fixture({}, (p) => ({
			text: "SUMMARY",
			...(p.model === "summary-model" && !reported ? { usage: null } : {}),
		}));
		try {
			const host = await f.start(inferencePolicy(f.endpoint));
			await seed(host);
			const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
			owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
			const b = binding(owner),
				frame = b.readFrame(),
				job = b.createJob(frame.basis, { planId: "usage", targetEntryIds: [target(frame)], maxCalls: 1 });
			const result = await job.infer({ modelKey: "summary", prompt: "FIXED" });
			assert.equal(result.status, "completed");
			assert.equal(result.usageStatus, reported ? "known" : "unknown");
			assert.equal(result.usage?.output, reported ? 2 : undefined);
			assert.equal(b.audit()[0].usageStatus, reported ? "known" : "unknown");
		} finally {
			await f.close();
		}
	});
