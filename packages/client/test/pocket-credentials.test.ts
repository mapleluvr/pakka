import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPocketClient, PocketRemoteError } from "../src/pocket.ts";

// A structurally legal but unrelated status must not turn a possibly committed private write into success.
test("WebUI private client: real HTTP requires the original version and replace/clear outcome, with no automatic replay", async () => {
	let requests = 0;
	let status: Record<string, unknown> = { version: 1, configured: true };
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
					result: { kind: "credential", status },
				}),
			);
		})().catch((error) => res.destroy(error));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	try {
		const client = createPocketClient({ endpoint: `http://127.0.0.1:${address.port}/pocket/rpc` });
		const command = {
			op: "credential.replace" as const,
			input: { requestId: "replace", expectedVersion: 0, secret: "SYNTHETIC-CLIENT-KEY" },
		};
		const replaced = await client.request(command);
		assert.equal(replaced.kind, "credential");
		for (status of [
			{ version: 2, configured: true },
			{ version: 1, configured: false },
			{ version: 1, configured: true, secret: "SYNTHETIC-LEAK" },
		]) {
			await assert.rejects(
				client.request(command),
				(error) => error instanceof PocketRemoteError && error.outcome === "unknown",
			);
		}
		status = { version: 1, configured: true };
		await assert.rejects(
			client.request({ op: "credential.clear", input: { requestId: "clear", expectedVersion: 0 } }),
			(error) => error instanceof PocketRemoteError && error.outcome === "unknown",
		);
		assert.equal(requests, 5);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
