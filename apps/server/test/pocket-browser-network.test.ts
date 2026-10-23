import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:https";
import { request } from "node:http";
import { connect } from "node:tls";
import type { Duplex } from "node:stream";
import { readFile } from "node:fs/promises";
import { browserNetwork } from "../src/pocket-browser-network.ts";

test(
	"WebUI browser network: a real approved HTTPS tunnel preserves TLS validation; a foreign CONNECT has no target request",
	{ timeout: 10000 },
	async () => {
		const [key, cert] = await Promise.all([
			readFile(new URL("../../webui/test/tls/key.pem", import.meta.url)),
			readFile(new URL("../../webui/test/tls/cert.pem", import.meta.url)),
		]);
		let requests = 0;
		const page = createServer({ key, cert }, (_req, res) => {
			requests++;
			res.end("REAL-VALIDATED-TLS-PAGE");
		});
		await new Promise<void>((resolve) => page.listen(0, "127.0.0.1", resolve));
		const address = page.address();
		assert.ok(address && typeof address !== "string");
		const origin = "https://127.0.0.1:" + address.port;
		const proxy = await browserNetwork(new Set([origin]));
		const tunnel = async (authority: string) => {
			let endpoint: URL;
			try {
				endpoint = new URL(proxy.endpoint);
			} catch {
				throw Error("Invalid owned fixture proxy");
			}
			assert.equal(endpoint.hostname, "127.0.0.1");
			return new Promise<{ status: number | undefined; socket: Duplex }>((resolve, reject) => {
				const outbound = request({
					hostname: endpoint.hostname,
					port: endpoint.port,
					method: "CONNECT",
					path: authority,
				});
				outbound.setTimeout(3000, () => outbound.destroy(Error("Fixture CONNECT deadline")));
				outbound.once("connect", (response, socket) => resolve({ status: response.statusCode, socket }));
				outbound.once("error", reject);
				outbound.end();
			});
		};
		try {
			const denied = await tunnel("127.0.0.1:1");
			assert.equal(denied.status, 403);
			denied.socket.destroy();
			assert.equal(requests, 0);
			const approved = await tunnel("127.0.0.1:" + address.port);
			assert.equal(approved.status, 200);
			const body = await new Promise<string>((resolve, reject) => {
				// Trust this test-only certificate, retaining real TLS hostname and certificate validation.
				const tls = connect({ socket: approved.socket, ca: cert, servername: "localhost" }, () => {
					assert.equal(tls.authorized, true);
					tls.write("GET /tls-proof HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
				});
				let output = "";
				tls.setEncoding("utf8");
				tls.setTimeout(3000, () => tls.destroy(Error("Fixture TLS deadline")));
				tls.on("data", (data) => (output += data));
				tls.once("end", () => resolve(output));
				tls.once("error", reject);
			});
			assert.match(body, /REAL-VALIDATED-TLS-PAGE/);
			assert.equal(requests, 1);
		} finally {
			await proxy.close();
			page.closeAllConnections();
			await new Promise<void>((resolve) => page.close(() => resolve()));
		}
	},
);
