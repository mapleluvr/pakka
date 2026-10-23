import { test } from "node:test";
import assert from "node:assert/strict";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";
import { fixture, seed, raw } from "./fixture.ts";

const outputTool = {
	name: "submit_candidate",
	description: "Submit a source-bound candidate.",
	parameters: {
		type: "object",
		properties: { text: { type: "string", minLength: 3 } },
		required: ["text"],
		additionalProperties: false,
	},
};

// Without the provider declaration/result path this must fail at the actual
// returned call, even though the normal main-run tool has the same name.
test("auxiliary output tool reaches real HTTP and returns an immutable call without executing a tool", async () => {
	let executions = 0;
	const f = await fixture({}, (p) =>
		p.model === "summary-model"
			? { tool: "submit_candidate", args: { text: "CANDIDATE" } }
			: { text: "MAIN" },
	);
	try {
		const host = await f.start({
			...inferencePolicy(f.endpoint),
			tools: [
				{
					...outputTool,
					execute: async () => {
						executions++;
						return "EXECUTED";
					},
				},
			],
		});
		await seed(host);
		const before = await raw(host);
		const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, {
			planId: "tool-output",
			targetEntryIds: [target(frame)],
			maxCalls: 1,
		});
		const result = await job.infer({
			modelKey: "summary",
			prompt: "SOURCE",
			maxOutputTokens: 64,
			outputTool,
		});
		assert.equal(result.status, "completed", result.reason ?? "output tool must complete");
		assert.deepEqual(result.toolCall, {
			id: "call-2",
			name: "submit_candidate",
			arguments: { text: "CANDIDATE" },
		});
		assert.equal(result.text, undefined);
		assert.ok(Object.isFrozen(result.toolCall?.arguments));
		assert.throws(() => Object.assign(result.toolCall!.arguments, { text: "MUTATED" }), TypeError);
		assert.deepEqual(b.audit()[0].toolCall, result.toolCall);
		assert.equal(result.usage!.output, 2);
		assert.ok(result.attemptId);
		assert.equal(f.requests.length, 2);
		assert.equal(f.requests[1].max_tokens, 64);
		assert.deepEqual(f.requests[1].tools, [{ type: "function", function: outputTool }]);
		assert.equal(executions, 0);
		assert.equal(await raw(host), before);
	} finally {
		await f.close();
	}
});

for (const [name, answer] of [
	["prose-only", { text: "ordinary text is not a submission" }],
	["wrong-tool", { tool: "another_tool", args: { text: "CANDIDATE" } }],
	["missing-parameter", { tool: "submit_candidate", args: {} }],
	["extra-parameter", { tool: "submit_candidate", args: { text: "CANDIDATE", forged: true } }],
	["coerced-parameter", { tool: "submit_candidate", args: { text: 1234 } }],
	["truncated-call", { tool: "submit_candidate", args: { text: "CANDIDATE" }, finishReason: "length" }],
	["unfinished-json-with-tool-stop", { tool: "submit_candidate", argsJson: '{"text":"CANDIDATE"' }],
	["repaired-json-escape", { tool: "submit_candidate", argsJson: '{"text":"bad\\q"}' }],
] as const)
	test(`auxiliary output tool rejects ${name} and preserves measured usage`, async () => {
		const f = await fixture({}, (p) => (p.model === "summary-model" ? answer : { text: "MAIN" }));
		try {
			const host = await f.start(inferencePolicy(f.endpoint));
			await seed(host);
			const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
			owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
			const b = binding(owner),
				frame = b.readFrame();
			const job = b.createJob(frame.basis, { planId: name, targetEntryIds: [target(frame)], maxCalls: 1 });
			const result = await job.infer({ modelKey: "summary", prompt: "SOURCE", outputTool });
			assert.equal(result.status, "failed");
			assert.equal(result.toolCall, undefined);
			assert.equal(result.usageStatus, "known");
			assert.equal(result.usage!.output, 2);
			assert.equal(b.audit()[0].status, "failed");
		} finally {
			await f.close();
		}
	});

test("invalid output tool declaration is refused before an inference reservation or HTTP", async () => {
	const f = await fixture();
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		await seed(host);
		const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, {
			planId: "bad-tool",
			targetEntryIds: [target(frame)],
			maxCalls: 1,
		});
		await assert.rejects(
			job.infer({
				modelKey: "summary",
				prompt: "SOURCE",
				outputTool: { ...outputTool, name: "bad tool name" },
			}),
			/output tool|declaration/i,
		);
		assert.equal(f.requests.length, 1);
		assert.deepEqual(b.audit(), []);
	} finally {
		await f.close();
	}
});
