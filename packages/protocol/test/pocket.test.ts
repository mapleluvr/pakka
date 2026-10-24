import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodeRequest as decodeV1 } from "../src/index.ts";
import { decodePocketRequest, decodePocketResponse, decodePocketEvent } from "../src/pocket.ts";

const ref = {
	key: "root",
	sessionId: "storage-a",
	conversationId: "c1",
	incarnation: "instance-a",
	profile: "default",
};
const person = { id: "human-a", name: "Alice", role: "viewer", resources: ["c1"], active: true };
const page = {
	ref,
	entries: [
		{ id: "1", conversationId: "c1", kind: "pi.user", messages: [{ role: "user", content: "REAL-INPUT" }] },
	],
	entriesTruncated: false,
	live: { busy: false, tools: [] },
	usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: null },
};
const response = {
	version: 2,
	requestId: "read-1",
	serverId: "server-a",
	result: { kind: "conversation", snapshot: page },
};

// Sharing a decoder/default with headless v1 would silently widen the original authenticated API.
test("WebUI protocol: explicit v2 commands are independent of unchanged headless v1", () => {
	assert.deepEqual(decodeV1({ version: 1, requestId: "old", command: { op: "hello" } }).command, {
		op: "hello",
	});
	const request = {
		version: 2,
		requestId: "read-1",
		command: { op: "read", target: ref, page: { limit: 25, beforeEntryId: "entry-20" } },
	};
	assert.deepEqual(decodePocketRequest(request), request);
	assert.throws(() => decodeV1(request));
	assert.throws(() => decodePocketRequest({ ...request, version: 1 }));
	for (const extra of [{ actorId: "other" }, { role: "admin" }, { grants: ["manage"] }, { token: "secret" }])
		assert.throws(() => decodePocketRequest({ ...request, command: { ...request.command, ...extra } }));
	for (const limit of [0, 257, NaN, Infinity])
		assert.throws(() =>
			decodePocketRequest({ ...request, command: { ...request.command, page: { limit } } }),
		);
});

// Accepting raw native docs, system messages or an unrelated response id would leak configuration or miscorrelate work.
test("WebUI protocol: complete sanitized Conversation DTOs are bounded and strictly correlated", () => {
	assert.deepEqual(decodePocketResponse(response, "read-1"), response);
	assert.equal(Object.isFrozen(decodePocketResponse(response, "read-1")), true);
	assert.throws(() => decodePocketResponse(response, "another-request"));
	for (const snapshot of [
		{ ...page, providerSessionId: "private" },
		{ ...page, entries: [{ ...page.entries[0], conversationId: "peer" }] },
		{ ...page, entries: [{ ...page.entries[0], messages: [{ role: "system", content: "PRIVATE-SYSTEM" }] }] },
		{ ...page, live: { busy: false, tools: [], raw: { apiKey: "private" } } },
		{ ...page, usage: { ...page.usage, cost: Infinity } },
	])
		assert.throws(() =>
			decodePocketResponse({ ...response, result: { kind: "conversation", snapshot } }, "read-1"),
		);
	const hello = {
		version: 2,
		requestId: "hello",
		serverId: "server-a",
		result: { kind: "hello", versions: [2], person, sessionId: "storage-a" },
	};
	assert.deepEqual(decodePocketResponse(hello, "hello"), hello);
	assert.throws(() =>
		decodePocketResponse(
			{ ...hello, result: { ...hello.result, person: { ...person, tokenHash: "private" } } },
			"hello",
		),
	);
});

// Native failed assistant turns must remain readable over RPC and SSE after a service restart.
test("WebUI protocol: bounded assistant error history survives both response and event decoding", () => {
	const failed = {
		role: "assistant",
		content: [],
		stopReason: "error",
		errorMessage: "Configured provider credential unavailable",
	};
	const snapshot = {
		...page,
		entries: [{ id: "error-2", conversationId: "c1", kind: "pi.assistant", messages: [failed] }],
	};
	const result = { ...response, result: { kind: "conversation", snapshot } };
	const event = {
		version: 2,
		serverId: "server-a",
		streamId: "stream-a",
		sequence: 1,
		kind: "conversation",
		snapshot,
	};
	assert.deepEqual(decodePocketResponse(result, "read-1"), result);
	assert.deepEqual(decodePocketEvent(event), event);
	const live = { ...snapshot, live: { busy: true, tools: [], message: failed } };
	assert.deepEqual(decodePocketEvent({ ...event, snapshot: live }), { ...event, snapshot: live });
	for (const errorMessage of [null, {}, 429, "x".repeat(65537)]) {
		const invalid = {
			...snapshot,
			entries: [{ ...snapshot.entries[0], messages: [{ ...failed, errorMessage }] }],
		};
		assert.throws(() => decodePocketEvent({ ...event, snapshot: invalid }));
	}
	assert.throws(() =>
		decodePocketEvent({
			...event,
			snapshot: {
				...snapshot,
				entries: [{ ...snapshot.entries[0], messages: [{ ...failed, role: "user" }] }],
			},
		}),
	);
});

// A slash text cannot bypass the human dispatcher by entering the raw model-input endpoint.
test("WebUI protocol: human display, explicit model work and person administration use finite separate commands", () => {
	const commands = [
		{ op: "display", target: ref, requestId: "card", kind: "card", text: "Not model input" },
		{ op: "submit", target: ref, input: { requestId: "input", text: "Explicit work", mode: "followUp" } },
		{ op: "invite", requestId: "invite", role: "viewer", resources: ["c1"], ttlMs: 60000 },
		{ op: "person.set", personId: "human-a", role: "sender", resources: ["c1"] },
		{ op: "session.rotate" },
		{ op: "session.logout" },
		{ op: "people" },
	];
	for (const command of commands)
		assert.deepEqual(decodePocketRequest({ version: 2, requestId: "request", command }).command, command);
	assert.throws(() =>
		decodePocketRequest({
			version: 2,
			requestId: "request",
			command: { op: "submit", target: ref, input: { requestId: "input", text: "/unknown", mode: "prompt" } },
		}),
	);
	assert.throws(() =>
		decodePocketRequest({
			version: 2,
			requestId: "request",
			command: { op: "invite", requestId: "invite", role: "superuser", resources: "*", ttlMs: 60000 },
		}),
	);
	assert.throws(() =>
		decodePocketRequest({
			version: 2,
			requestId: "request",
			command: { op: "display", target: ref, requestId: "card", kind: "card", text: "x".repeat(16385) },
		}),
	);
});

// Profile selection is a request, never a serialized permission grant.
test("WebUI protocol: human resource control selects a profile without accepting a capability or runtime configuration", () => {
	const commands = [
		{ op: "create", requestId: "work", name: "Work", profile: "safe" },
		{ op: "configure", target: ref, profile: "safe" },
		{ op: "fork", target: ref, requestId: "alternate", name: "Alternative", profile: "safe", entryId: "10" },
	];
	for (const command of commands)
		assert.deepEqual(decodePocketRequest({ version: 2, requestId: "rpc", command }).command, command);
	for (const extra of [
		{ grants: ["spawn"] },
		{ endpoint: "https://forbidden.invalid" },
		{ actorId: "owner" },
	])
		assert.throws(() =>
			decodePocketRequest({ version: 2, requestId: "rpc", command: { ...commands[0], ...extra } }),
		);
	const created = { version: 2, requestId: "rpc", serverId: "server-a", result: { kind: "reference", ref } };
	assert.deepEqual(decodePocketResponse(created, "rpc"), created);
	assert.throws(() => decodeV1({ version: 1, requestId: "rpc", command: commands[0] }));
});

test("WebUI protocol: receipt reasons are bounded native data, not browser-inferred state", () => {
	const response = {
		version: 2,
		requestId: "receipt",
		serverId: "server-a",
		result: {
			kind: "receipt",
			receipt: {
				id: "receipt-1",
				requestId: "input-1",
				actorId: "owner",
				target: ref,
				status: "unanswered",
				reason: "blocked",
			},
		},
	};
	assert.deepEqual(decodePocketResponse(response, "receipt"), response);
	for (const reason of [null, 1, {}, "x".repeat(16385)])
		assert.throws(() =>
			decodePocketResponse(
				{ ...response, result: { ...response.result, receipt: { ...response.result.receipt, reason } } },
				"receipt",
			),
		);
});

// Cursors belong to one authorized stream/resource, not a global cross-Session revision or a serialized capability.
test("WebUI protocol: resource streams validate incarnation and explicit resnapshot signals", () => {
	const event = {
		version: 2,
		serverId: "server-a",
		streamId: "stream-a",
		sequence: 1,
		kind: "conversation",
		snapshot: page,
	};
	assert.deepEqual(decodePocketEvent(event), event);
	assert.deepEqual(
		decodePocketEvent({
			version: 2,
			serverId: "server-a",
			streamId: "stream-a",
			sequence: 2,
			kind: "resnapshot",
		}).kind,
		"resnapshot",
	);
	for (const changed of [
		{ ...event, sequence: -1 },
		{ ...event, scope: "all" },
		{ ...event, treeRevision: 1 },
		{ ...event, snapshot: { ...page, ref: { ...ref, incarnation: "" } } },
	])
		assert.throws(() => decodePocketEvent(changed));
});
