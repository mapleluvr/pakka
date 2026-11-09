import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { listenHttp } from "../src/http-listener.ts";

// Only the first OS-reported port is controlled; binding, close/rebind and HTTP remain real.
for (const blockedPort of [4045, 4190, 6679]) {
	test(`HTTP listeners close Fetch-blocked reported port ${blockedPort} before publishing a rebound address`, async (t) => {
		const server = createServer((_request, response) => response.end("REAL-HTTP-READY"));
		const original = server.address.bind(server);
		let first = true;
		let closes = 0;
		server.on("close", () => closes++);
		t.mock.method(server, "address", () => {
			const address = original();
			if (first && address && typeof address !== "string") {
				first = false;
				return { ...address, port: blockedPort };
			}
			return address;
		});
		try {
			const address = await listenHttp(server, { host: "127.0.0.1" });
			assert.equal(first, false, "the first real listener must report the controlled blocked port");
			assert.ok(closes >= 1, "a rejected address must close before rebinding");
			assert.notEqual(address.port, blockedPort, "the published port must be usable by Fetch and browsers");
			assert.equal(await (await fetch(`http://127.0.0.1:${address.port}`)).text(), "REAL-HTTP-READY");
		} finally {
			server.closeAllConnections();
			if (server.listening)
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
		}
	});

	test(`explicitly blocked HTTP port ${blockedPort} is refused before binding`, async () => {
		const server = createServer();
		try {
			await assert.rejects(listenHttp(server, { host: "127.0.0.1", port: blockedPort }), {
				code: "ERR_UNSAFE_HTTP_PORT",
			});
			assert.equal(server.listening, false);
		} finally {
			if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
}
