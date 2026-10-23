import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPocketClient, PocketRemoteError } from "../src/pocket.ts";
const ref = { key: "work", sessionId: "s", conversationId: "c", incarnation: "i", profile: "default" };
test("WebUI settings client: real HTTP metadata keeps exact resource/profile/incarnation correlation without retry", async () => {
	let requests = 0,
		change: Record<string, string> = {};
	const server = createServer((req, res) => {
		void (async () => {
			let body = "";
			for await (const chunk of req) body += chunk;
			const request: unknown = JSON.parse(body);
			assert.ok(request && typeof request === "object" && "requestId" in request);
			requests++;
			res.setHeader("Content-Type", "application/json");
			res.end(
				JSON.stringify({
					version: 2,
					requestId: request.requestId,
					serverId: "server",
					result: {
						kind: "configuration",
						configuration: {
							ref: { ...ref, ...change },
							choices: [{ id: "default", model: "local-model" }],
							canConfigure: false,
							usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: null },
							session: null,
						},
					},
				}),
			);
		})().catch((error) => res.destroy(error));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	try {
		const client = createPocketClient({ endpoint: `http://127.0.0.1:${address.port}/pocket/rpc` });
		const result = await client.request({ op: "configuration", target: ref });
		assert.equal(result.kind, "configuration");
		for (change of [{ conversationId: "other" }, { profile: "other" }, { incarnation: "other" }])
			await assert.rejects(
				client.request({ op: "configuration", target: ref }),
				(error) => error instanceof PocketRemoteError && error.outcome === "unknown",
			);
		assert.equal(requests, 4);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
