import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture, runtimeLimits } from "./runtime-fixture.ts";
import { inferencePolicy, target } from "./strategy-fixture.ts";
import { text } from "./fixture.ts";
import type { Host } from "../src/index.ts";

function activate(host: Host) {
	const owner = host.connect("owner", [
		"real_context.write",
		"context_artifacts.write",
		"model.infer",
		"branch.control",
	]);
	owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
	return { owner, binding: owner.bindStrategy("strategy") };
}
function makeJob(host: Host) {
	const { binding } = activate(host),
		frame = binding.readFrame();
	return {
		binding,
		job: binding.createJob(frame.basis, { planId: "shared", targetEntryIds: [target(frame)], maxCalls: 1 }),
	};
}

test("M1 review: InferencePolicy.maxCalls bounds a strategy across Conversations/forks/reopen", async () => {
	const m = await runtimeFixture((endpoint) => {
		const policy = inferencePolicy(endpoint).inference!;
		return {
			inference: { ...policy, policies: policy.policies.map((p) => ({ ...p, maxCalls: 2, maxJobCalls: 1 })) },
		};
	}, runtimeLimits);
	let restored: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const a = m.runtime.root(),
			b = await m.runtime.conversation(await m.runtime.createConversation({ key: "peer" }));
		await a.connect("user", ["input.submit"]).submit({ key: "seed", text: "A-SOURCE" });
		await a.waitForIdle();
		await b.connect("user", ["input.submit"]).submit({ key: "seed", text: "B-SOURCE" });
		await b.waitForIdle();
		const aa = makeJob(a),
			bb = makeJob(b),
			ja = aa.job,
			jb = bb.job;
		for (const result of await Promise.all([
			ja.infer({ modelKey: "summary", prompt: "A-ALLOW" }),
			jb.infer({ modelKey: "summary", prompt: "B-ALLOW" }),
		]))
			assert.equal(result.status, "completed");
		assert.equal(m.f.requests.length, 4);
		const admin = a.connect("navigator", ["branch.control"]);
		admin.branch(admin.capture(), a.view().entries.find((entry) => entry.role === "user")!.id);
		await a.waitForIdle();
		const forkJob = aa.binding;
		const frame = forkJob.readFrame();
		const attempted = forkJob.createJob(frame.basis, {
			planId: "after-fork",
			targetEntryIds: [target(frame)],
			maxCalls: 1,
		});
		assert.notEqual(
			(await attempted.infer({ modelKey: "summary", prompt: "FORK-MUST-NOT-RESET" })).status,
			"completed",
		);
		assert.equal(m.f.requests.length, 4, "same strategy cannot spend again merely by changing Conversation");
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		restored = await createRuntime({ ...m.config, reopenSessionFile: file });
		const next = makeJob(restored.root()).job;
		assert.notEqual(
			(await next.infer({ modelKey: "summary", prompt: "REOPEN-MUST-NOT-RESET" })).status,
			"completed",
		);
		assert.equal(m.f.requests.length, 4);
		assert.equal(restored.view().budget.auxiliaryAttempts, 2);
	} finally {
		await restored?.close();
		await m.close();
	}
});

test("M1 review: post-fork prompt tools are current and idle followUp is explicitly refused", async () => {
	let invocations = 0;
	const m = await runtimeFixture(
		{
			tools: [
				{
					name: "probe",
					description: "invoke on current branch",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						invocations++;
						return "VALID-TOOL";
					},
				},
			],
		},
		runtimeLimits,
		(payload) =>
			text(payload).includes("CURRENT-FOLLOW-UP") && !payload.messages.some((msg) => msg.role === "tool")
				? { tool: "probe" }
				: { text: "answer" },
	);
	try {
		const a = m.runtime.root(),
			input = a.connect("user", ["input.submit", "branch.control"]);
		await input.submit({ key: "seed", text: "OLD-PROMPT" });
		await a.waitForIdle();
		input.branch(input.capture(), a.view().entries.find((entry) => entry.role === "user")!.id);
		await a.waitForIdle();
		await assert.rejects(
			input.submit({ key: "idle-queue", text: "CURRENT-FOLLOW-UP", mode: "followUp" }),
			/incompatible/i,
		);
		await input.submit({ key: "next", text: "CURRENT-FOLLOW-UP" });
		await a.waitForIdle();
		assert.equal(invocations, 1);
		assert.equal(a.view().phase, "ready");
		assert.equal(m.f.requests.length, 3);
	} finally {
		await m.close();
	}
});

test("M1 review: damaged Conversation artifact storage seals its shared Session", async () => {
	const m = await runtimeFixture();
	let path: string | undefined, before: string | undefined;
	try {
		const a = m.runtime.root(),
			b = await m.runtime.conversation(await m.runtime.createConversation({ key: "peer" }));
		const aa = activate(a),
			frame = aa.binding.readFrame();
		const receipt = aa.binding.artifacts.append(frame.basis, { expectedVersion: 0, records: ["owned"] });
		assert.equal(receipt.status, "committed");
		path = receipt.journalPath;
		before = await readFile(path, "utf8");
		await writeFile(path, before.slice(0, -1));
		assert.throws(() => aa.binding.readFrame(), /storage|journal/i);
		assert.equal(a.view().phase, "failed");
		assert.equal(b.view().phase, "failed");
		assert.equal(m.runtime.view().phase, "failed");
		assert.equal(m.f.requests.length, 0);
	} finally {
		if (path && before) await writeFile(path, before);
		await m.close();
	}
});

test("M1 review: foreign jobScope in a peer projection is rejected before HTTP", async () => {
	const m = await runtimeFixture(inferencePolicy);
	try {
		const a = m.runtime.root(),
			b = await m.runtime.conversation(await m.runtime.createConversation({ key: "peer" }));
		for (const [host, value] of [
			[a, "A-SOURCE"],
			[b, "B-SOURCE"],
		] as const) {
			await host.connect("input", ["input.submit"]).submit({ key: "seed", text: value });
			await host.waitForIdle();
		}
		const aa = activate(a),
			bb = activate(b),
			fa = aa.binding.readFrame();
		const job = aa.binding.createJob(fa.basis, {
			planId: "A-ONLY",
			targetEntryIds: [target(fa)],
			maxCalls: 1,
		});
		bb.binding.installProjector((frame) => ({
			status: "apply",
			basis: frame.basis,
			replacements: [
				{ sourceEntryIds: [target(frame)], summary: "FOREIGN-JOB-MUST-NOT-LAND", jobScope: job.scope },
			],
		}));
		await b.connect("follow", ["input.submit"]).submit({ key: "next", text: "NO-FOREIGN-WIRE" });
		await b.waitForIdle();
		assert.equal(m.f.requests.length, 2);
		assert.equal(b.view().phase, "failed");
		assert.equal(a.view().phase, "ready");
		assert.match(b.view().lastError ?? "", /job scope/i);
		job.check();
	} finally {
		await m.close();
	}
});
