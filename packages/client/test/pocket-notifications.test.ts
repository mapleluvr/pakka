import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPocketClient, PocketRemoteError } from "../src/pocket.ts";
const target = {
	key: "main",
	sessionId: "session",
	conversationId: "conversation",
	incarnation: "incarnation",
	profile: "default",
};
test("WebUI notification client: real HTTP rejects a legal status for another exact resource and never repeats a device write", async () => {
	let requests = 0,
		returned = target;
	const server = createServer((req, res) => {
		void (async () => {
			let body = "";
			for await (const chunk of req) body += chunk;
			const parsed: unknown = JSON.parse(body);
			assert.ok(parsed && typeof parsed === "object" && "requestId" in parsed);
			requests++;
			res.setHeader("Content-Type", "application/json");
			res.end(
				JSON.stringify({
					version: 2,
					serverId: "server",
					requestId: parsed.requestId,
					result: {
						kind: "notification",
						target: returned,
						status: {
							publicKey: "B" + "x".repeat(86),
							preferences: { done: true, approval: true, chat: true, mention: true },
							devices: [],
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
		assert.equal((await client.request({ op: "notification.status", target })).kind, "notification");
		returned = { ...target, incarnation: "other-incarnation" };
		await assert.rejects(
			client.request({
				op: "notification.preferences",
				target,
				input: { requestId: "prefs", preferences: { chat: false } },
			}),
			(error) => error instanceof PocketRemoteError && error.outcome === "unknown",
		);
		assert.equal(requests, 2);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
