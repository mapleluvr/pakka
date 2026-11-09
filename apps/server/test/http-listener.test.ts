import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { listenHttp } from "../src/http-listener.ts";

// Only OS port selection is controlled; every listen, close and HTTP exchange is real.
for (const blockedPort of [4045, 4190, 6679]) {
	test(`HTTP listeners replace Fetch-blocked ephemeral port ${blockedPort} before publishing their address`, async (t) => {
		const server = createServer((_request, response) => response.end("REAL-HTTP-READY"));
		const original = server.listen.bind(server);
		let first = true;
		t.mock.method(server, "listen", (...args: unknown[]) => {
			if (first && args[0] === 0) {
				first = false;
				args[0] = blockedPort;
			}
			return Reflect.apply(original, server, args);
		});
		try {
			const address = await listenHttp(server, { host: "127.0.0.1" });
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
