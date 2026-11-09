import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPocketObservation } from "../src/pocket.ts";

const ref = {
	key: "root",
	sessionId: "session",
	conversationId: "2",
	incarnation: "original",
	profile: "default",
};
const first = {
	id: "9",
	conversationId: "2",
	kind: "pi.message",
	messages: [{ role: "user" as const, content: "original" }],
};
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
const snapshot = {
	ref,
	entries: [first],
	entriesTruncated: true,
	olderBeforeId: "9",
	live: { busy: false, tools: [] },
	usage,
};
const initial = {
	version: 2 as const,
	serverId: "server",
	streamId: "stream",
	sequence: 4,
	kind: "conversation" as const,
	snapshot,
};
const expected = { serverId: "server", target: ref };

test("WebUI observation client: only an exact original base can reconstruct the next bounded hot page", () => {
	const previous = applyPocketObservation(undefined, initial, expected);
	assert.ok(previous);
	const second = { ...first, id: "10", messages: [{ role: "assistant" as const, content: "new" }] };
	const patch = {
		ref,
		baseSequence: 4,
		entryIds: ["10"],
		entries: [second],
		entriesTruncated: false,
		olderBeforeId: null,
		live: { busy: true, tools: [] },
		usage: { ...usage, output: 20, totalTokens: 20 },
	};
	const update = {
		version: 2 as const,
		serverId: "server",
		streamId: "stream",
		sequence: 6,
		kind: "conversation.patch" as const,
		patch,
	};
	const next = applyPocketObservation(previous, update, expected);
	assert.ok(next);
	assert.deepEqual(next.snapshot, {
		ref,
		entries: [second],
		entriesTruncated: false,
		live: patch.live,
		usage: patch.usage,
	});
	assert.equal(previous.snapshot.entries[0]!.id, "9");
	assert.equal(previous.sequence, 4);
	assert.equal(next.sequence, 6);
	assert.equal(Object.isFrozen(next.snapshot), true);
});

test("WebUI observation client: lost bases, another server/stream/resource and missing rows require a fresh read, not inferred content", () => {
	const previous = applyPocketObservation(undefined, initial, expected);
	assert.ok(previous);
	const event = {
		version: 2 as const,
		serverId: "server",
		streamId: "stream",
		sequence: 6,
		kind: "conversation.patch" as const,
		patch: { ref, baseSequence: 4, live: { busy: true, tools: [] } },
	};
	for (const invalid of [
		{ ...event, serverId: "other" },
		{ ...event, streamId: "other" },
		{ ...event, patch: { ...event.patch, ref: { ...ref, sessionId: "other-session" } } },
		{ ...event, patch: { ...event.patch, baseSequence: 3 } },
		{ ...event, patch: { ...event.patch, entryIds: ["missing"] } },
	])
		assert.throws(() => applyPocketObservation(previous, invalid, expected));
	assert.throws(() => applyPocketObservation(undefined, event, expected));
});
