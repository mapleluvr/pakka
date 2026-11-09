import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodePocketRequest, decodePocketResponse } from "../src/pocket.ts";

const target = {
	key: "root",
	sessionId: "session",
	conversationId: "2",
	incarnation: "incarnation",
	profile: "default",
};
const reference = {
	id: "c".repeat(64),
	source: "entry",
	entryId: "9",
	revision: "3",
	path: "/model/0/content/0/text",
	encoding: "text",
	byteLength: 14 * 1024 * 1024,
	previewComplete: false,
};
const page = {
	ref: target,
	entries: [
		{
			id: "9",
			conversationId: "2",
			kind: "pi.tool-result",
			messages: [
				{
					role: "toolResult",
					toolCallId: "call",
					toolName: "command",
					isError: true,
					content: [{ type: "text", text: "HEAD\n…\nTAIL", contentReference: reference }],
				},
			],
		},
	],
	entriesTruncated: false,
	live: { busy: false, tools: [] },
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
};

test("WebUI content protocol: preview pages and content ranges stay finite, original-bound, and free of native objects", () => {
	const command = { op: "preview", target, page: { limit: 64, maxBytes: 256 * 1024 } };
	assert.deepEqual(decodePocketRequest({ version: 2, requestId: "preview", command }).command, command);
	const response = {
		version: 2,
		requestId: "preview",
		serverId: "server",
		result: { kind: "conversation", snapshot: page },
	};
	assert.deepEqual(decodePocketResponse(response, "preview"), response);
	const read = { op: "content.read", target, reference, range: { offset: 0, length: 65536 } };
	assert.deepEqual(decodePocketRequest({ version: 2, requestId: "content", command: read }).command, read);
	const chunk = { reference, offset: 0, nextOffset: 65530, complete: false, text: "original fragment" };
	const content = {
		version: 2,
		requestId: "content",
		serverId: "server",
		result: { kind: "content", target, chunk },
	};
	assert.deepEqual(decodePocketResponse(content, "content"), content);
});

test("WebUI content protocol: image payloads can be absent while the complete original remains explicitly addressable", () => {
	const image = { ...reference, id: "d".repeat(64), path: "/model/0/content/1/data", encoding: "base64" };
	const snapshot = {
		...page,
		entries: [
			{
				...page.entries[0],
				messages: [
					{
						role: "user",
						content: [{ type: "image", data: "", mimeType: "image/png", contentReference: image }],
					},
				],
			},
		],
	};
	const result = {
		version: 2,
		requestId: "image",
		serverId: "server",
		result: { kind: "conversation", snapshot },
	};
	assert.deepEqual(decodePocketResponse(result, "image"), result);
});

test("WebUI content protocol: unbounded ranges, forged native fields and inconsistent completion cannot pass decoding", () => {
	const valid = { op: "content.read", target, reference, range: { offset: 0, length: 65536 } };
	for (const command of [
		{ ...valid, range: { offset: -1, length: 65536 } },
		{ ...valid, range: { offset: 0, length: 65537 } },
		{ ...valid, reference: { ...reference, native: { apiKey: "private" } } },
		{ ...valid, reference: { ...reference, source: "session" } },
		{ ...valid, reference: { ...reference, path: "not-a-pointer" } },
		{ op: "preview", target, page: { limit: 64, maxBytes: 512 * 1024 } },
	])
		assert.throws(() => decodePocketRequest({ version: 2, requestId: "invalid", command }));
	const chunk = { reference, offset: 0, nextOffset: 65536, complete: true, text: "fragment" };
	assert.throws(() =>
		decodePocketResponse(
			{ version: 2, requestId: "invalid", serverId: "server", result: { kind: "content", target, chunk } },
			"invalid",
		),
	);
});
