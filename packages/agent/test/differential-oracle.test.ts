import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, oracleFixture, seed, text, type Payload } from "./fixture.ts";
import { binding } from "./strategy-fixture.ts";
import type { HostEvent } from "../src/index.ts";

test("A-11: Differential trace compares durable and oracle backends on identical scenario", async () => {
	for (const backend of ["durable", "oracle"] as const) {
		const f = backend === "oracle" ? await oracleFixture() : await fixture();
		const events: HostEvent[] = [];
		try {
			const host = await f.start();
			host.subscribe((e) => events.push(e));

			const user = host.connect("user", ["input.submit"]);
			const receipt = await user.submit({ key: "k1", text: "DIFF-INPUT" });
			await host.waitForIdle();

			// 1. Both backends committed the input
			assert.equal(user.receipt(receipt.id)?.state, "committed");

			// 2. Both backends made exactly 1 provider request with identical user text
			assert.equal(f.requests.length, 1);
			assert.match(text(f.requests[0]), /DIFF-INPUT/);

			// 3. Both backends emitted receipt events in order
			const receiptStates = events
				.filter((e) => e.type === "receipt" && e.receipt.id === receipt.id)
				.map((e) => (e as Extract<HostEvent, { type: "receipt" }>).receipt.state);
			assert.ok(receiptStates.includes("queued"));
			assert.ok(receiptStates.includes("consumed"));
			assert.ok(receiptStates.includes("committed"));

			// 4. View properties match
			const view = host.view();
			assert.equal(view.phase, "ready");
			assert.equal(view.busy, false);
			assert.equal(view.autoCompaction, false);
			assert.equal(view.effects, "not-assessed");

			await host.dispose();
			assert.equal(host.view().phase, "disposed");
		} finally {
			await f.close();
		}
	}
});

test("A-11: Differential tool invocation compares execution count and provider request sequence", async () => {
	for (const backend of ["durable", "oracle"] as const) {
		let toolExecutions = 0;
		const toolDef = {
			tools: [
				{
					name: "diff_tool",
					description: "Tool for differential testing",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						toolExecutions++;
						return "DIFF-TOOL-OUTPUT";
					},
				},
			],
		};
		const reply = (_p: Payload, n: number) =>
			n === 1 ? { tool: "diff_tool" } : { text: "AFTER-TOOL-ANSWER" };

		const f = backend === "oracle" ? await oracleFixture(toolDef, reply) : await fixture(toolDef, reply);
		try {
			const host = await f.start();
			const user = host.connect("user", ["input.submit"]);
			await user.submit({ key: "run-tool", text: "TRIGGER-DIFF-TOOL" });
			await host.waitForIdle();

			// Both backends executed the tool exactly once
			assert.equal(toolExecutions, 1, `Backend ${backend} must execute tool exactly once`);

			// Both backends sent 2 HTTP requests (tool call + final answer)
			assert.equal(f.requests.length, 2, `Backend ${backend} must send 2 provider requests`);
			assert.match(text(f.requests[1]), /DIFF-TOOL-OUTPUT/);

			await host.dispose();
		} finally {
			await f.close();
		}
	}
});

test("A-11: Differential projection replacement aligns request payload across backends", async () => {
	for (const backend of ["durable", "oracle"] as const) {
		const f = backend === "oracle" ? await oracleFixture() : await fixture();
		try {
			const host = await f.start();
			const { client: user } = await seed(host);
			const owner = host.connect("owner", ["real_context.write"]);
			owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });

			const b = binding(owner);
			const frame = b.readFrame();
			const targetId = frame.projection.find((e) =>
				JSON.stringify(e.messages).includes("ORIGINAL"),
			)!.sourceEntryId;

			b.installProjector((fr) => ({
				status: "apply",
				basis: fr.basis,
				patches: [
					{
						sourceEntryId: targetId,
						messageIndex: 0,
						content: [{ type: "text", text: "PROJECTED-DIFF-PATCH" }],
					},
				],
			}));

			await user.submit({ key: "next", text: "OBSERVE-PROJECTION" });
			await host.waitForIdle();

			assert.equal(f.requests.length, 2);
			assert.match(text(f.requests[1]), /PROJECTED-DIFF-PATCH/);
			assert.doesNotMatch(text(f.requests[1]), /ORIGINAL/);

			await host.dispose();
		} finally {
			await f.close();
		}
	}
});
