import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePocketEvent } from "../src/pocket.ts";

const ref = {
	key: "root",
	sessionId: "session",
	conversationId: "2",
	incarnation: "original",
	profile: "default",
};
const patch = {
	ref,
	baseSequence: 4,
	live: { busy: true, tools: [{ callId: "7", name: "command", status: "running", output: "bounded tail" }] },
};
const event = {
	version: 2,
	serverId: "server",
	streamId: "stream",
	sequence: 6,
	kind: "conversation.patch",
	patch,
};

test("WebUI incremental observation protocol: exact original resource/base and changed fields are finite", () => {
	assert.deepEqual(decodePocketEvent(event), event);
	const entry = {
		id: "9",
		conversationId: "2",
		kind: "pi.message",
		messages: [{ role: "user", content: "new original" }],
	};
	const changed = {
		...event,
		patch: {
			ref,
			baseSequence: 4,
			entries: [entry],
			entryIds: ["9"],
			entriesTruncated: false,
			olderBeforeId: null,
		},
	};
	assert.deepEqual(decodePocketEvent(changed), changed);
});

test("WebUI incremental observation protocol: missing/forward bases, duplicate IDs and foreign entry ownership are refused", () => {
	for (const invalid of [
		{ ...event, patch: { ...patch, baseSequence: 0 } },
		{ ...event, patch: { ...patch, baseSequence: 6 } },
		{ ...event, patch: { ...patch, entryIds: ["9", "9"] } },
		{
			...event,
			patch: {
				...patch,
				entries: [{ id: "9", conversationId: "another", kind: "pi.message", messages: [] }],
			},
		},
		{ ...event, patch: { ...patch, nativeSession: { private: true } } },
		{ ...event, snapshot: {} },
		{ ...event, patch: { ref, baseSequence: 4 } },
	])
		assert.throws(() => decodePocketEvent(invalid));
});
