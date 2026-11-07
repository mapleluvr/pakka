import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { listenHttp } from "@pakka/server/http-listener";
import { createPocketClient, PocketRemoteError } from "../src/pocket.ts";

test("Session recovery client accepts only the requested native identity without replaying mismatched results", async () => {
	let target = "original-session",
		received = 0;
	const server = createServer((request, response) => {
		request.resume();
		request.on("end", () => {
			received++;
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					version: 2,
					requestId: "open-original",
					serverId: "server",
					result: {
						kind: "session.state",
						session: { id: target, name: "Original", status: "ready" },
					},
				}),
			);
		});
	});
	try {
		const address = await listenHttp(server, { host: "127.0.0.1" });
		const client = createPocketClient({ endpoint: `http://127.0.0.1:${address.port}/pocket/rpc` });
		const command = { op: "session.reopen" as const, sessionId: "original-session" };
		const result = await client.request(command, { requestId: "open-original" });
		assert.equal(result.kind, "session.state");
		assert.equal(received, 1);
		target = "different-session";
		await assert.rejects(
			client.request(command, { requestId: "open-original" }),
			(error) => error instanceof PocketRemoteError && error.outcome === "unknown",
		);
		assert.equal(received, 2, "an unrelated result cannot trigger another opening request");
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});
