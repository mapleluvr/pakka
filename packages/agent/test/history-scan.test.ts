import { test } from "node:test";
import assert from "node:assert/strict";

async function planner() {
	const path = "../src/history-scan.ts";
	const module = await import(path).catch(() => ({}));
	assert.equal(
		typeof module.planHistoryScan,
		"function",
		"history refresh needs a bounded incremental scan policy",
	);
	return module.planHistoryScan;
}

test("same immutable Conversation history starts after its last confirmed ID and uses bounded pages", async () => {
	const plan = (await planner())({ conversationId: "11", cachedConversationId: "11", lastEntryId: 410 });
	assert.deepEqual(plan, { reset: false, pageSize: 256, minEntryId: 411 });
	assert.ok(Object.isFrozen(plan));
});

test("cold load and a changed Conversation reset the history rather than reuse a foreign lower bound", async () => {
	const scan = await planner();
	assert.deepEqual(scan({ conversationId: "12" }), { reset: true, pageSize: 256 });
	assert.deepEqual(scan({ conversationId: "12", cachedConversationId: "11", lastEntryId: 900 }), {
		reset: true,
		pageSize: 256,
	});
});

test("empty histories begin at the start and unsafe ID arithmetic is refused", async () => {
	const scan = await planner();
	assert.deepEqual(scan({ conversationId: "11", cachedConversationId: "11" }), {
		reset: false,
		pageSize: 256,
	});
	for (const lastEntryId of [-1, 1.5, Number.MAX_SAFE_INTEGER, Number.NaN])
		assert.throws(
			() => scan({ conversationId: "11", cachedConversationId: "11", lastEntryId }),
			/identity|ID|bound/i,
		);
});
