import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodePocketRequest, decodePocketResponse, decodePocketEvent } from "../src/pocket.ts";
const ref = {
	key: "root",
	sessionId: "session",
	conversationId: "child",
	incarnation: "current",
	profile: "default",
};
const envelope = { version: 2, requestId: "rpc", serverId: "server" };

test("WebUI navigation protocol: finite metadata command/result and scoped list states reject authority/foreign fields", () => {
	const command = {
		op: "conversation.set",
		target: ref,
		input: { requestId: "rename", expectedVersion: 0, name: "Title", archived: true },
	};
	assert.deepEqual(decodePocketRequest({ version: 2, requestId: "rpc", command }).command, command);
	for (const input of [
		{ ...command.input, name: "bad\nname" },
		{ ...command.input, expectedVersion: -1 },
		{ ...command.input, archived: 1 },
		{ ...command.input, actorId: "forged" },
	])
		assert.throws(() =>
			decodePocketRequest({ version: 2, requestId: "rpc", command: { ...command, input } }),
		);
	const list = {
		kind: "list",
		conversations: [ref],
		titles: { child: "Title" },
		states: { child: { version: 1, archived: true } },
	};
	assert.deepEqual(decodePocketResponse({ ...envelope, result: list }, "rpc"), { ...envelope, result: list });
	for (const states of [
		{ foreign: { version: 1, archived: false } },
		{ child: { version: 257, archived: false } },
		{ child: { version: 1, archived: false, receipt: "private" } },
	])
		assert.throws(() => decodePocketResponse({ ...envelope, result: { ...list, states } }, "rpc"));
	const receipt = {
		kind: "metadata",
		requestId: "rename",
		metadata: { ref, name: "Title", version: 1, archived: true },
	};
	assert.deepEqual(decodePocketResponse({ ...envelope, result: receipt }, "rpc"), {
		...envelope,
		result: receipt,
	});
	assert.throws(() =>
		decodePocketResponse(
			{ ...envelope, result: { ...receipt, metadata: { ...receipt.metadata, actorId: "private" } } },
			"rpc",
		),
	);
});

test("WebUI fork transcript: current scope and explicit inherited attribution are independent; attribution is never a resource grant", () => {
	const snapshot = {
		ref,
		entries: [
			{
				id: "1",
				conversationId: "child",
				sourceConversationId: "parent",
				kind: "pi.user",
				messages: [{ role: "user", content: "Inherited native input" }],
			},
		],
		entriesTruncated: false,
		live: { busy: false, tools: [] },
		usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: null },
	};
	const result = { kind: "conversation", snapshot };
	assert.deepEqual(decodePocketResponse({ ...envelope, result }, "rpc"), { ...envelope, result });
	assert.ok(
		decodePocketEvent({
			version: 2,
			serverId: "server",
			streamId: "stream",
			sequence: 1,
			kind: "conversation",
			snapshot,
		}),
	);
	for (const entry of [
		{ ...snapshot.entries[0], conversationId: "foreign" },
		{ ...snapshot.entries[0], sourceConversationId: "child" },
		{ ...snapshot.entries[0], sourceConversationId: "" },
		{ ...snapshot.entries[0], nativeDoc: { private: true } },
	])
		assert.throws(() =>
			decodePocketResponse(
				{ ...envelope, result: { ...result, snapshot: { ...snapshot, entries: [entry] } } },
				"rpc",
			),
		);
});
