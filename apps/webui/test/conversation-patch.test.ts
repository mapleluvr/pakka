import { test } from "node:test";
import assert from "node:assert/strict";
import type { PocketSnapshot } from "@pakka/protocol/pocket";
import { createPocketSnapshotPatch } from "../src/conversation-patch.ts";
import { applyPocketObservation } from "@pakka/client/pocket";

const ref = {
	key: "root",
	sessionId: "session",
	conversationId: "2",
	incarnation: "original",
	profile: "default",
};
const before: PocketSnapshot = {
	ref,
	entries: [
		{
			id: "9",
			conversationId: "2",
			kind: "pi.tool-result",
			messages: [
				{
					role: "toolResult",
					toolCallId: "7",
					toolName: "command",
					isError: false,
					content: "COMPLETED-CANARY\n".repeat(500),
				},
			],
		},
	],
	entriesTruncated: true,
	olderBeforeId: "9",
	live: { busy: false, tools: [] },
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
};

test("WebUI patch projection: unchanged completed outputs do not recur in a live-only update", () => {
	assert.equal(createPocketSnapshotPatch(before, before, 1), undefined);
	const after: PocketSnapshot = {
		...before,
		live: {
			busy: true,
			tools: [{ callId: "10", name: "command", status: "running", output: "changed tail" }],
		},
	};
	const patch = createPocketSnapshotPatch(before, after, 1);
	assert.ok(patch);
	assert.deepEqual(Object.keys(patch).sort(), ["ref", "baseSequence", "live"].sort());
	assert.equal(JSON.stringify(patch).includes("COMPLETED-CANARY"), false);
	const expected = { serverId: "server", target: ref };
	const initial = {
		version: 2,
		serverId: "server",
		streamId: "stream",
		sequence: 1,
		kind: "conversation",
		snapshot: before,
	};
	const prior = applyPocketObservation(undefined, initial, expected);
	assert.ok(prior);
	const next = applyPocketObservation(
		prior,
		{ version: 2, serverId: "server", streamId: "stream", sequence: 2, kind: "conversation.patch", patch },
		expected,
	);
	assert.deepEqual(next?.snapshot, after);
});

test("WebUI patch projection: hot-page movement and usage changes reconstruct exactly without claiming archive deletion", () => {
	const after: PocketSnapshot = {
		...before,
		entries: [{ ...before.entries[0]!, id: "11" }],
		entriesTruncated: false,
		usage: { ...before.usage, output: 7, totalTokens: 7 },
	};
	const { olderBeforeId: _old, ...complete } = after;
	const patch = createPocketSnapshotPatch(before, complete, 1);
	assert.ok(patch);
	assert.deepEqual(patch.entryIds, ["11"]);
	assert.equal(patch.olderBeforeId, null);
	assert.equal(patch.entries?.length, 1);
	assert.throws(() =>
		createPocketSnapshotPatch(before, { ...complete, ref: { ...ref, sessionId: "another" } }, 1),
	);
});
