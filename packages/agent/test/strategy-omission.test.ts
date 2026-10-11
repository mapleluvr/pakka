import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SummaryRangeReplacement } from "../src/index.ts";
import { binding, inferencePolicy, target } from "./strategy-fixture.ts";
import { oracleFixture as fixture, raw, seed, text } from "./fixture.ts";

const omit = (sourceEntryIds: readonly string[]): SummaryRangeReplacement => ({
	sourceEntryIds,
	summary: null,
});

test("explicit null range omits an existing summary without resurrecting source or adding a placeholder", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const { client: user, receipt } = await seed(host, "OMITTED-SOURCE");
		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
		const b = binding(owner);
		let summary: string | null = "FIRST-SUMMARY";
		b.installProjector((frame) => ({
			status: "apply",
			basis: frame.basis,
			replacements: [{ sourceEntryIds: [receipt.entryId!], summary }],
		}));
		const before = await raw(host);
		await user.submit({ key: "summarized", text: "FIRST-TAIL" });
		await host.waitForIdle();
		assert.match(text(f.requests[1]), /FIRST-SUMMARY/);
		assert.doesNotMatch(text(f.requests[1]), /OMITTED-SOURCE/);
		summary = null;
		await user.submit({ key: "omitted", text: "SECOND-TAIL" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 3);
		assert.equal(host.view().phase, "ready");
		assert.match(text(f.requests[2]), /PAKKA-SYSTEM/);
		assert.match(text(f.requests[2]), /FIRST-TAIL/);
		assert.match(text(f.requests[2]), /SECOND-TAIL/);
		assert.doesNotMatch(text(f.requests[2]), /OMITTED-SOURCE|FIRST-SUMMARY|Host strategy summary|null/);
		assert.equal((await raw(host)).startsWith(before), true);
		assert.doesNotMatch(await raw(host), /FIRST-SUMMARY|"type":"compaction"|"type":"context_edit"/);
	} finally {
		await f.close();
	}
});

test("null range omission retains the protected native checkpoint and remaining tail on wire", async () => {
	const f = await fixture();
	try {
		const first = await f.start();
		await seed(first, "EARLY-SOURCE");
		const file = first.view().sessionFile;
		await first.dispose();
		const manager = SessionManager.open(file);
		const checkpoint = manager.appendMessage({
			role: "system",
			content: "MID-OMISSION-CHECKPOINT",
			timestamp: 2,
		});
		const omitted = manager.appendMessage({ role: "user", content: "LATER-SOURCE", timestamp: 3 });
		const host = await f.start({ reopenSessionFile: file });
		const user = host.connect("user", ["input.submit"]),
			owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
		const b = binding(owner);
		const original = b.readFrame();
		assert.equal(original.projection.find((e) => e.sourceEntryId === checkpoint)!.boundary, "system");
		b.installProjector((frame) => ({ status: "apply", basis: frame.basis, replacements: [omit([omitted])] }));
		await user.submit({ key: "tail", text: "VISIBLE-TAIL" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 2);
		assert.equal(host.view().phase, "ready");
		assert.match(text(f.requests[1]), /EARLY-SOURCE/);
		assert.match(text(f.requests[1]), /MID-OMISSION-CHECKPOINT/);
		assert.match(text(f.requests[1]), /VISIBLE-TAIL/);
		assert.doesNotMatch(text(f.requests[1]), /LATER-SOURCE|Host strategy summary/);
	} finally {
		await f.close();
	}
});

test("null range omission cannot cross a system checkpoint", async () => {
	const f = await fixture();
	try {
		const first = await f.start();
		await seed(first, "EARLY-SOURCE");
		const file = first.view().sessionFile;
		await first.dispose();
		const manager = SessionManager.open(file);
		manager.appendMessage({ role: "system", content: "MID-CHECKPOINT", timestamp: 2 });
		const later = manager.appendMessage({ role: "user", content: "LATER-SOURCE", timestamp: 3 });
		const host = await f.start({ reopenSessionFile: file });
		const user = host.connect("user", ["input.submit"]),
			owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
		const b = binding(owner);
		const early = target(b.readFrame());
		b.installProjector((frame) => ({
			status: "apply",
			basis: frame.basis,
			replacements: [omit([early, later])],
		}));
		await user.submit({ key: "blocked", text: "DO-NOT-SEND" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 1);
		assert.equal(host.view().phase, "failed");
	} finally {
		await f.close();
	}
});

for (const complete of [false, true])
	test(`null range omission ${complete ? "removes a complete" : "refuses a split"} native call/result pair`, async () => {
		const f = await fixture(
			{
				tools: [
					{
						name: "native",
						description: "native",
						parameters: { type: "object", properties: {} },
						execute: async () => "PAIR-RESULT",
					},
				],
			},
			(_payload, n) => (n === 1 ? { tool: "native", args: {} } : { text: "ANSWER" }),
		);
		try {
			const host = await f.start();
			const { client: user } = await seed(host);
			const owner = host.connect("owner", ["real_context.write"]);
			owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
			const b = binding(owner);
			const before = await raw(host),
				original = b.readFrame();
			const call = original.projection.find((e) =>
				e.messages.some((m) => m.role === "assistant" && JSON.stringify(m.content).includes("toolCall")),
			)!.sourceEntryId;
			const result = original.projection.find((e) =>
				e.messages.some((m) => m.role === "toolResult"),
			)!.sourceEntryId;
			b.installProjector((frame) => ({
				status: "apply",
				basis: frame.basis,
				replacements: [omit(complete ? [call, result] : [call])],
			}));
			await user.submit({ key: "tail", text: "VISIBLE-TAIL" });
			await host.waitForIdle();
			assert.equal(f.requests.length, complete ? 3 : 2);
			assert.equal(host.view().phase, complete ? "ready" : "failed");
			if (complete) {
				const payload = f.requests[2];
				assert.equal(
					payload.messages.some((m) => "tool_calls" in m || m.role === "tool"),
					false,
				);
				assert.match(text(payload), /PAKKA-SYSTEM/);
				assert.match(text(payload), /VISIBLE-TAIL/);
				assert.doesNotMatch(text(payload), /PAIR-RESULT|Host strategy summary/);
				assert.equal((await raw(host)).startsWith(before), true);
			}
		} finally {
			await f.close();
		}
	});

test("null range omission keeps completed job source authority after later source edit", async () => {
	const f = await fixture();
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const id = target(frame),
			job = b.createJob(frame.basis, { planId: "omitted-job", targetEntryIds: [id], maxCalls: 1 });
		assert.equal(
			(await job.infer({ modelKey: "summary", prompt: "SOURCE", maxOutputTokens: 64 })).status,
			"completed",
		);
		b.installProjector((current) => ({
			status: "apply",
			basis: current.basis,
			replacements: [{ ...omit([id]), jobScope: job.scope }],
		}));
		await owner.commit(owner.capture(), { type: "edit", targetId: id, text: "EDITED-SOURCE" });
		await user.submit({ key: "blocked", text: "DO-NOT-SEND" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 2);
		assert.equal(host.view().phase, "failed");
	} finally {
		await f.close();
	}
});
