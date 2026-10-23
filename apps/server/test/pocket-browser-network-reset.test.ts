import { test } from "node:test";
import { strict as assert } from "node:assert";
import { connect } from "node:net";
import { createServer } from "node:http";
import { browserNetwork } from "../src/pocket-browser-network.ts";

test(
	"WebUI browser network: a real reset after a rejected CONNECT stays connection-local and never reaches the target",
	{ timeout: 10000 },
	async () => {
		let requests = 0;
		const target = createServer((_req, res) => {
			requests++;
			res.end("NOT-APPROVED");
		});
		await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
		const address = target.address();
		assert.ok(address && typeof address !== "string");
		const proxy = await browserNetwork(new Set());
		const endpoint = new URL(proxy.endpoint);
		try {
			for (let attempt = 0; attempt < 24; attempt++) {
				const response = await new Promise<string>((resolve, reject) => {
					const socket = connect({ host: "127.0.0.1", port: Number(endpoint.port) });
					let data = "";
					socket.setTimeout(1000, () => socket.destroy(Error("Fixture CONNECT deadline")));
					socket.once("connect", () =>
						socket.write(
							`CONNECT 127.0.0.1:${address.port} HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\n\r\n`,
						),
					);
					socket.once("data", (chunk) => {
						data += chunk.toString();
						socket.resetAndDestroy();
					});
					socket.once("error", reject);
					socket.once("close", () => resolve(data));
				});
				assert.match(response, /^HTTP\/1\.1 403 Forbidden\r\n/);
			}
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(requests, 0);
		} finally {
			await proxy.close();
			target.closeAllConnections();
			await new Promise<void>((resolve) => target.close(() => resolve()));
		}
	},
);
