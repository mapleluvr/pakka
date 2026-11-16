import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { listenHttp } from "../../../apps/server/src/http-listener.ts";
import { createWebUiServiceClient } from "../src/webui.ts";
import { PocketRemoteError } from "../src/pocket.ts";

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
		assert.equal(parsed.api, 3);
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
				api: mode === "version" ? 2 : 3,
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
