import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createExtensionClient } from "../src/extension-client.ts";

const call = { extension: "sample", generation: "gen-1", action: "save", requestId: "stable", input: {} };
function listener(body: Uint8Array | string, status = 200) {
	let requests = 0;
	const server = createServer(async (req, res) => {
		for await (const chunk of req) void chunk;
		requests++;
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(body);
	});
	return { server, count: () => requests };
}
test(
	"Extension client: lost/malformed or mismatched response stays unknown and does not replay a write",
	{ timeout: 10000 },
	async () => {
		for (const body of [
			'{"version":2,"requestId":"wrong","serverId":"server","result":{"kind":"updated"}}',
			Buffer.from([0xc3, 0x28]),
		]) {
			const m = listener(body);
			await new Promise<void>((resolve) => m.server.listen(0, "127.0.0.1", resolve));
			try {
				const address = m.server.address();
				assert.ok(address && typeof address !== "string");
				const client = createExtensionClient({
					endpoint: "http://127.0.0.1:" + address.port + "/pocket/extensions/rpc",
				});
				await assert.rejects(
					client.call(call),
					(error: Error & { outcome?: string }) => error.outcome === "unknown",
				);
				assert.equal(m.count(), 1);
			} finally {
				await new Promise<void>((resolve) => m.server.close(() => resolve()));
			}
		}
	},
);
