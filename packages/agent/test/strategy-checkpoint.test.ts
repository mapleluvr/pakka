import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { binding } from "./strategy-fixture.ts";
import { fixture, seed, text } from "./fixture.ts";

test("protected system checkpoint between a valid call/result pair survives active projection", async () => {
	const f = await fixture(
		{
			backend: "oracle",
			tools: [
				{
					name: "native",
					description: "native",
					parameters: { type: "object", properties: {} },
					execute: async () => "RESULT",
				},
			],
		},
		(_p, n) => (n === 1 ? { tool: "native" } : { text: "ANSWER" }),
	);
	try {
		const first = await f.start();
		await seed(first);
		const file = first.view().sessionFile;
		await first.dispose();
		const manager = SessionManager.open(file);
		const assistant = manager
			.getEntries()
			.find(
				(e) =>
					e.type === "message" &&
					e.message.role === "assistant" &&
					e.message.content.some((b) => b.type === "toolCall"),
			);
		assert.ok(assistant && assistant.type === "message" && assistant.message.role === "assistant");
		manager.appendMessage({
			...structuredClone(assistant.message),
			content: [{ type: "toolCall", id: "checkpoint-call", name: "native", arguments: {} }],
		});
		manager.appendMessage({ role: "system", content: "PAIR-CHECKPOINT", timestamp: 2 });
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "checkpoint-call",
			toolName: "native",
			content: [{ type: "text", text: "PAIR-RESULT" }],
			isError: false,
			timestamp: 3,
		});
		const host = await f.start({ reopenSessionFile: file });
		const user = host.connect("next-user", ["input.submit"]),
			owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
		binding(owner).installProjector((frame) => ({ status: "disabled", basis: frame.basis }));
		await user.submit({ key: "checkpoint", text: "NEXT" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 3);
		assert.equal(host.view().phase, "ready");
		assert.match(text(f.requests[2]), /PAIR-CHECKPOINT/);
		assert.match(text(f.requests[2]), /PAIR-RESULT/);
		assert.equal(f.requests[2].messages.find((m) => m.tool_call_id === "checkpoint-call")!.role, "tool");
	} finally {
		await f.close();
	}
});
