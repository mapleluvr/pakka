import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodePocketRequest, decodePocketResponse, decodePocketEvent } from "../src/pocket.ts";
const target = {
	key: "main",
	sessionId: "store",
	conversationId: "c1",
	incarnation: "i1",
	profile: "default",
};
const snapshot = {
	conversationId: "c1",
	version: 2,
	messages: [
		{
			id: "chat-one",
			requestId: "post",
			authorId: "human-one",
			authorName: "Alice",
			text: "Human only",
			createdAt: 1,
			quoteId: null,
			mentions: [],
			pinned: true,
			reactions: [{ emoji: "👍", people: ["human-two"] }],
		},
	],
	note: { version: 1, text: "Shared", authorId: "human-one", updatedAt: 2 },
	driver: { version: 1, personId: "human-one", expiresAt: 30000 },
	presence: [{ personId: "human-two", name: "Bob", state: "typing", expiresAt: 10000 }],
};
// A permissive generic payload could accept forged authors/driver identities or private storage metadata.
test("WebUI collaboration protocol: human operations reject serialized authority, unbounded values and metadata", () => {
	const commands = [
		{ op: "collaboration.read", target },
		{
			op: "collaboration.post",
			target,
			input: { requestId: "post", text: "Human only", mentions: ["human-two"] },
		},
		{ op: "collaboration.note", target, input: { expectedVersion: 0, text: "Shared" } },
		{ op: "collaboration.react", target, input: { messageId: "chat-one", emoji: "👍", active: true } },
		{ op: "collaboration.pin", target, input: { messageId: "chat-one", pinned: true } },
		{ op: "collaboration.driver", target, input: { expectedVersion: 0, action: "claim", ttlMs: 30000 } },
		{ op: "collaboration.presence", target, input: { state: "typing" } },
	];
	for (const command of commands)
		assert.deepEqual(decodePocketRequest({ version: 2, requestId: "rpc", command }).command, command);
	for (const input of [
		{ requestId: "p", text: "x", authorId: "forged" },
		{ requestId: "p", text: "x", mentions: ["peer", "peer"] },
		{ requestId: "p", text: "x".repeat(8193) },
	])
		assert.throws(() =>
			decodePocketRequest({
				version: 2,
				requestId: "rpc",
				command: { op: "collaboration.post", target, input },
			}),
		);
	for (const input of [
		{ expectedVersion: 0, action: "claim", ttlMs: 0 },
		{ expectedVersion: 0, action: "claim", ttlMs: Infinity },
		{ expectedVersion: 0, action: "take", ttlMs: 30000, personId: "forged" },
		{ expectedVersion: 0, action: "release", ttlMs: 1000 },
	])
		assert.throws(() =>
			decodePocketRequest({
				version: 2,
				requestId: "rpc",
				command: { op: "collaboration.driver", target, input },
			}),
		);
});
// Client-visible snapshots/events have their own finite decode; source DTO typing cannot sanitize wire bytes.
test("WebUI collaboration protocol: bounded attributed snapshots and scoped events reject malformed state", () => {
	const response = {
		version: 2,
		requestId: "rpc",
		serverId: "server-one",
		result: { kind: "collaboration", snapshot },
	};
	assert.deepEqual(decodePocketResponse(response, "rpc"), response);
	const event = {
		version: 2,
		serverId: "server-one",
		streamId: "stream-one",
		sequence: 1,
		kind: "collaboration",
		snapshot,
	};
	assert.deepEqual(decodePocketEvent(event), event);
	for (const bad of [
		{ ...snapshot, tokenHash: "hidden" },
		{ ...snapshot, messages: [{ ...snapshot.messages[0], fingerprint: "private" }] },
		{ ...snapshot, note: { ...snapshot.note, version: -1 } },
		{ ...snapshot, driver: { ...snapshot.driver, expiresAt: null } },
		{
			...snapshot,
			messages: [{ ...snapshot.messages[0], reactions: [{ emoji: "👍", people: ["same", "same"] }] }],
		},
	])
		assert.throws(() =>
			decodePocketResponse({ ...response, result: { kind: "collaboration", snapshot: bad } }, "rpc"),
		);
});
