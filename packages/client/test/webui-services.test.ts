import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { listenHttp } from "../../../apps/server/src/http-listener.ts";
import { createWebUiServiceClient } from "../src/webui.ts";
import { PocketRemoteError } from "../src/pocket.ts";
import { WEBUI_SERVICE_API, decodeWebUiRequest } from "@pakka/protocol/webui";

test("WebUI notification client: exact original, Person and browser subscription are correlated without retry", async () => {
	const target = {
		key: "main",
		sessionId: "session",
		conversationId: "one",
		incarnation: "original",
		profile: "default",
	};
	const subscription = {
		endpoint: "https://fcm.googleapis.com/push/original",
		keys: { p256dh: "B" + "x".repeat(86), auth: "x".repeat(22) },
	};
	const preference = {
		op: "notification.preferences" as const,
		target,
		input: { requestId: "preference", preferences: { chat: false } },
	};
	const registration = {
		op: "notification.subscribe" as const,
		target,
		input: { requestId: "device", subscription },
	};
	const key = createHash("sha256").update(JSON.stringify(subscription)).digest("hex");
	let mode = "valid",
		calls = 0;
	const server = createServer(async (request, response) => {
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		const envelope = decodeWebUiRequest(JSON.parse(Buffer.concat(parts).toString("utf8")));
		if (envelope.command.op !== "notification.lookup")
			throw Error("Unexpected notification client operation");
		calls++;
		const original = structuredClone(
			envelope.command.original.op === "notification.subscribe" ? registration : preference,
		);
		if (mode === "request") original.input.requestId = "other-request";
		if (mode === "session") original.target.sessionId = "other-session";
		if (mode === "binding" || mode === "empty-binding") original.target.incarnation = "other-binding";
		if (mode === "intent" && original.op === "notification.preferences")
			original.input.preferences.chat = true;
		const status = {
			publicKey: subscription.keys.p256dh,
			preferences: {
				done: true,
				approval: true,
				chat: original.op === "notification.preferences" ? original.input.preferences.chat : true,
				mention: true,
			},
			devices:
				original.op === "notification.subscribe"
					? [{ id: "device", subscriptionKey: mode === "subscription" ? "a".repeat(64) : key }]
					: [],
		};
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify({
				api: WEBUI_SERVICE_API,
				requestId: envelope.requestId,
				serverId: "server",
				result: {
					kind: "notification-operation",
					actorId: mode === "actor" || mode === "empty-actor" ? "other" : "person",
					original,
					status: ["absent", "empty-actor", "empty-binding"].includes(mode) ? null : status,
				},
			}),
		);
	});
	const listening = await listenHttp(server, { host: "127.0.0.1" });
	try {
		const client = createWebUiServiceClient({
			endpoint: `http://127.0.0.1:${listening.port}/pakka-webui/services`,
			personId: () => "person",
			serverId: () => "server",
		});
		const query = { op: "notification.lookup" as const, original: preference };
		assert.equal((await client.request(query)).status?.preferences.chat, false);
		mode = "absent";
		assert.equal((await client.request(query)).status, null);
		for (mode of ["actor", "request", "intent", "session", "binding", "empty-actor", "empty-binding"])
			await assert.rejects(client.request(query), { code: "UNKNOWN", outcome: "unknown" });
		mode = "valid";
		assert.equal(
			(await client.request({ op: "notification.lookup", original: registration })).status?.devices[0]
				?.subscriptionKey,
			key,
		);
		mode = "subscription";
		await assert.rejects(client.request({ op: "notification.lookup", original: registration }), {
			code: "UNKNOWN",
			outcome: "unknown",
		});
		assert.equal(calls, 11);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});

// The subject is the production HTTP client. A controlled peer exercises semantically valid
// but uncorrelated replies that the shape decoder alone cannot reject.
test("WebUI history client: original Session, content identity, byte range and service version are correlated without retry", async () => {
	const reference = { kind: "conversation" as const, sessionId: "session-a", conversationId: "12" };
	const content = {
		id: "c".repeat(64),
		source: "entry" as const,
		entryId: "9",
		revision: "3",
		path: "/data/text",
		encoding: "text" as const,
		byteLength: 1024,
		previewComplete: false,
	};
	const history = {
		status: "unloaded",
		page: {
			reference,
			sequence: "10",
			entries: [],
			entriesTruncated: false,
			saved: { busy: false, tools: [] },
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: null },
		},
	};
	let mode = "valid",
		calls = 0;
	const server = createServer(async (request, response) => {
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		const parsed = JSON.parse(Buffer.concat(parts).toString("utf8"));
		calls++;
		assert.equal(parsed.api, WEBUI_SERVICE_API);
		const target = mode === "session" ? { ...reference, sessionId: "session-b" } : reference;
		const result =
			parsed.command.op === "resource.history"
				? { kind: "resource-history", history: { ...history, page: { ...history.page, reference: target } } }
				: {
						kind: "resource-content",
						reference: target,
						chunk: {
							reference: mode === "locator" ? { ...content, revision: "4" } : content,
							text: "original",
							offset: mode === "offset" ? 1 : 0,
							nextOffset: mode === "range" ? 32 : 8,
							complete: false,
						},
					};
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify({
				api: mode === "version" ? 3 : WEBUI_SERVICE_API,
				requestId: parsed.requestId,
				serverId: "server",
				result,
			}),
		);
	});
	const listening = await listenHttp(server, { host: "127.0.0.1" });
	try {
		const client = createWebUiServiceClient({
			endpoint: `http://127.0.0.1:${listening.port}/pakka-webui/services`,
			personId: () => "person",
			serverId: () => "server",
		});
		const read = { op: "resource.history" as const, reference };
		const range = { op: "resource.content" as const, reference, content, range: { offset: 0, length: 16 } };
		assert.deepEqual((await client.request(read)).history, history);
		assert.equal((await client.request(range)).chunk.text, "original");
		mode = "session";
		for (const command of [read, range])
			await assert.rejects(client.request(command), { code: "UNKNOWN", outcome: "unknown" });
		for (mode of ["locator", "offset", "range"])
			await assert.rejects(client.request(range), { code: "UNKNOWN", outcome: "unknown" });
		mode = "version";
		await assert.rejects(
			client.request(read),
			(error: unknown) =>
				error instanceof PocketRemoteError &&
				error.code === "VERSION_MISMATCH" &&
				error.outcome === "unknown",
		);
		assert.equal(calls, 8);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});

// Valid JSON for another binding or intent must not acknowledge a pending configuration.
test("WebUI configuration client: correlates the original binding and intent even on empty lookup", async () => {
	const target = {
		key: "work",
		sessionId: "session",
		conversationId: "1",
		incarnation: "before",
		profile: "default",
	};
	const original = {
		requestId: "config",
		target,
		selection: { kind: "agent" as const, change: { model: "provider/model", thinkingLevel: "low" as const } },
	};
	const receipt = { actorId: "person", original, ref: { ...target, incarnation: "after" }, at: 1 };
	let mode = "valid",
		calls = 0;
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk);
		const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		calls++;
		const changed = structuredClone(receipt);
		if (mode === "actor" || mode === "empty-actor") changed.actorId = "other";
		if (mode === "intent") changed.original.selection.change.model = "provider/other";
		if (mode === "binding" || mode === "empty-binding") changed.original.target.incarnation = "other";
		if (mode === "result") changed.ref.conversationId = "2";
		const result = {
			kind: "conversation-configuration-operation",
			actorId: changed.actorId,
			original: changed.original,
			receipt: ["absent", "empty-actor", "empty-binding"].includes(mode) ? null : changed,
		};
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify({ api: WEBUI_SERVICE_API, requestId: envelope.requestId, serverId: "server", result }),
		);
	});
	const listening = await listenHttp(server, { host: "127.0.0.1" });
	try {
		const client = createWebUiServiceClient({
			endpoint: `http://127.0.0.1:${listening.port}/pakka-webui/services`,
			personId: () => "person",
			serverId: () => "server",
		});
		const query = { op: "conversation-configuration.lookup" as const, original };
		assert.deepEqual((await client.request(query)).receipt, receipt);
		mode = "absent";
		assert.equal((await client.request(query)).receipt, null);
		for (mode of ["actor", "intent", "binding", "result", "empty-actor", "empty-binding"])
			await assert.rejects(client.request(query), { code: "UNKNOWN", outcome: "unknown" });
		assert.equal(calls, 8);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});

// Wrong budget receipts can clear an unresolved write, so check correlation through the actual client.
test("WebUI budget client: rejects mismatched Session, person, intent and policy version without retry", async () => {
	const change = {
		requestId: "budget",
		expectedVersion: 0,
		limits: { maxConversations: 4, maxPrimaryAttempts: 6, maxAuxiliaryAttempts: 2 },
		reason: "Reviewed",
	};
	const receipt = {
		version: 1,
		source: "management",
		actorId: "person",
		requestId: change.requestId,
		reason: change.reason,
		at: 1,
		before: change.limits,
		after: change.limits,
		budget: { primaryAttempts: 1, auxiliaryAttempts: 0 },
		conversationCount: 1,
		addedProfiles: [],
	};
	let mode = "valid",
		calls = 0;
	const server = createServer(async (request, response) => {
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		const parsed = JSON.parse(Buffer.concat(parts).toString("utf8"));
		calls++;
		const changed = structuredClone(receipt);
		if (mode === "actor") changed.actorId = "another-person";
		if (mode === "request") changed.requestId = "another-request";
		if (mode === "version") changed.version = 2;
		if (mode === "intent") changed.reason = "Another intent";
		if (mode === "limits") changed.after = { ...change.limits, maxPrimaryAttempts: 7 };
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify({
				api: WEBUI_SERVICE_API,
				requestId: parsed.requestId,
				serverId: "server",
				result: {
					kind: "session-budget-operation",
					sessionId: mode === "session" ? "other-session" : "session",
					receipt:
						mode === "absent" ? null : mode === "source" ? { ...changed, source: ["management"] } : changed,
				},
			}),
		);
	});
	const listening = await listenHttp(server, { host: "127.0.0.1" });
	try {
		const client = createWebUiServiceClient({
			endpoint: `http://127.0.0.1:${listening.port}/pakka-webui/services`,
			personId: () => "person",
			serverId: () => "server",
		});
		const command = { op: "session-budget.lookup" as const, sessionId: "session", original: change };
		assert.deepEqual((await client.request(command)).receipt, receipt);
		mode = "absent";
		assert.equal((await client.request(command)).receipt, null);
		for (mode of ["actor", "request", "version", "intent", "limits", "session", "source"])
			await assert.rejects(client.request(command), { code: "UNKNOWN", outcome: "unknown" });
		assert.equal(calls, 9);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});

// Exercise the shipped client: valid JSON for another request must not acknowledge collaboration.
test("WebUI collaboration client: rejects foreign or altered receipts and empty lookup bindings", async () => {
	const target = {
		key: "work",
		sessionId: "session",
		conversationId: "one",
		incarnation: "original",
		profile: "default",
	};
	const original = {
		requestId: "shared-note",
		target,
		action: { kind: "note" as const, expectedVersion: 0, text: "ORIGINAL" },
	};
	const receipt = {
		actorId: "person",
		original,
		version: 1,
		at: 1,
		result: { kind: "note" as const, version: 1 },
	};
	let mode = "valid",
		calls = 0;
	const server = createServer(async (request, response) => {
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		const envelope = JSON.parse(Buffer.concat(parts).toString("utf8"));
		calls++;
		const changed = structuredClone(receipt);
		if (mode === "actor" || mode === "empty-actor") changed.actorId = "other";
		if (mode === "request") changed.original.requestId = "other-request";
		if (mode === "intent") changed.original.action.text = "ALTERED";
		if (mode === "session") changed.original.target.sessionId = "other-session";
		if (mode === "binding" || mode === "empty-binding")
			changed.original.target.incarnation = "other-incarnation";
		if (mode === "result") changed.result.version = 2;
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify({
				api: WEBUI_SERVICE_API,
				requestId: envelope.requestId,
				serverId: "server",
				result: {
					kind: "collaboration-operation",
					actorId: changed.actorId,
					original: changed.original,
					receipt: ["absent", "empty-actor", "empty-binding"].includes(mode) ? null : changed,
				},
			}),
		);
	});
	const listening = await listenHttp(server, { host: "127.0.0.1" });
	try {
		const client = createWebUiServiceClient({
			endpoint: `http://127.0.0.1:${listening.port}/pakka-webui/services`,
			personId: () => "person",
			serverId: () => "server",
		});
		const query = { op: "collaboration.lookup" as const, original };
		assert.deepEqual((await client.request(query)).receipt, receipt);
		mode = "absent";
		assert.equal((await client.request(query)).receipt, null);
		for (mode of [
			"actor",
			"request",
			"intent",
			"session",
			"binding",
			"result",
			"empty-actor",
			"empty-binding",
		])
			await assert.rejects(client.request(query), { code: "UNKNOWN", outcome: "unknown" });
		assert.equal(calls, 10);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});

// A valid but unrelated authority receipt must never release the browser's pending operation.
test("WebUI people client: correlates actor, request and exact permission intent without retry", async () => {
	const original = {
		requestId: "authority-change",
		action: {
			op: "person.set" as const,
			personId: "target",
			role: "viewer" as const,
			resources: ["resource-a", "resource-b"],
		},
	};
	const receipt = { ...original, actorId: "issuer", sessionId: "primary", version: 2, at: 1 };
	let mode = "valid",
		calls = 0;
	const server = createServer(async (request, response) => {
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		const envelope = JSON.parse(Buffer.concat(parts).toString("utf8"));
		calls++;
		const actorId = mode === "actor" || mode === "empty-actor" ? "other-issuer" : "issuer";
		const requestId = mode === "request" ? "other-request" : original.requestId;
		const action =
			mode === "role"
				? { ...original.action, role: "sender" }
				: mode === "target"
					? { ...original.action, personId: "other-target" }
					: mode === "scope"
						? { ...original.action, resources: "*" }
						: { ...original.action, resources: [...original.action.resources].reverse() };
		const result = {
			kind: "people-operation",
			actorId,
			requestId,
			receipt:
				mode === "absent" || mode === "empty-actor" ? null : { ...receipt, actorId, requestId, action },
		};
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify({ api: WEBUI_SERVICE_API, requestId: envelope.requestId, serverId: "server", result }),
		);
	});
	const listening = await listenHttp(server, { host: "127.0.0.1" });
	try {
		const client = createWebUiServiceClient({
			endpoint: `http://127.0.0.1:${listening.port}/pakka-webui/services`,
			personId: () => "issuer",
			serverId: () => "server",
		});
		const query = { op: "people.lookup" as const, original };
		assert.equal((await client.request(query)).receipt?.requestId, original.requestId);
		mode = "absent";
		assert.equal((await client.request(query)).receipt, null);
		for (mode of ["actor", "request", "role", "target", "scope", "empty-actor"])
			await assert.rejects(client.request(query), { code: "UNKNOWN", outcome: "unknown" });
		assert.equal(calls, 8);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});
