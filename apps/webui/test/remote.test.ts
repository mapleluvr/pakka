import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer as createHttps, request as tlsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { createServer as createTcp } from "node:net";
import { readFile } from "node:fs/promises";
import { fixture } from "./fixture.ts";
import { createPocketHttp } from "../src/http.ts";

// Public test-only TLS material generated for localhost; never used as a deployment certificate or credential.
test(
	"Pocket remote: actual TLS proxy uses exact trusted peer/origin and secure cookies; direct/plain/spoofed access is rejected",
	{ timeout: 20000 },
	async () => {
		const m = await fixture();
		const reserve = createTcp();
		await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
		const address = reserve.address();
		assert.ok(address && typeof address !== "string");
		const backendPort = address.port;
		await new Promise<void>((r) => reserve.close(() => r()));
		const [key, cert] = await Promise.all([
			readFile(new URL("./tls/key.pem", import.meta.url)),
			readFile(new URL("./tls/cert.pem", import.meta.url)),
		]);
		let publicHost = "",
			forwardedProto = "https";
		const proxy = createHttps({ key, cert }, (incoming, outgoing) => {
			// The fixed loopback destination belongs to this fixture, never to request fields.
			const upstream = httpRequest(
				{
					hostname: "127.0.0.1",
					port: backendPort,
					path: incoming.url,
					method: incoming.method,
					headers: {
						...incoming.headers,
						host: publicHost,
						"x-forwarded-host": publicHost,
						"x-forwarded-proto": forwardedProto,
						"x-forwarded-for": incoming.socket.remoteAddress,
					},
				},
				(response) => {
					outgoing.writeHead(response.statusCode ?? 502, response.headers);
					response.pipe(outgoing);
				},
			);
			upstream.on("error", (error) => outgoing.destroy(error));
			incoming.pipe(upstream);
		});
		await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
		const socket = proxy.address();
		assert.ok(socket && typeof socket !== "string");
		const proxyPort = socket.port;
		publicHost = "127.0.0.1:" + proxyPort;
		const origin = "https://" + publicHost;
		const remote = await createPocketHttp({
			runtime: m.runtime,
			people: m.people,
			workspace: m.workspace,
			host: "127.0.0.1",
			port: backendPort,
			publicOrigin: origin,
			trustedProxyPeers: ["127.0.0.1"],
		});
		function request(path: string, body: object, cookies?: string, csrf?: string, customOrigin = origin) {
			return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>(
				(resolve, reject) => {
					const call = tlsRequest(
						{
							hostname: "127.0.0.1",
							port: proxyPort,
							path,
							method: "POST",
							ca: cert,
							headers: {
								"Content-Type": "application/json",
								Origin: customOrigin,
								...(cookies ? { Cookie: cookies } : {}),
								...(csrf ? { "X-Pakka-CSRF": csrf } : {}),
							},
						},
						(response) => {
							let bytes = "";
							response.setEncoding("utf8");
							response.on("data", (chunk) => {
								bytes += chunk;
							});
							response.on("end", () =>
								resolve({ status: response.statusCode ?? 0, headers: response.headers, body: bytes }),
							);
						},
					);
					call.on("error", reject);
					call.end(JSON.stringify(body));
				},
			);
		}
		try {
			const rotated = await m.people.rotate(m.actor);
			const login = await request("/pocket/exchange", { kind: "session", token: rotated.token });
			assert.equal(login.status, 200);
			assert.ok(login.headers["set-cookie"]?.every((value) => /; Secure/.test(value)));
			assert.match(login.headers["set-cookie"]![0]!, /HttpOnly/);
			const cookie = login.headers["set-cookie"]!.map((v) => v.split(";")[0]).join("; "),
				csrf = /pakka_csrf=([^;]+)/.exec(cookie)![1]!;
			const body = {
				version: 2,
				requestId: "remote-request",
				command: {
					op: "submit",
					target: m.ref,
					input: { requestId: "tls-input", mode: "prompt", text: "REAL-TLS" },
				},
			};
			const submitted = await request("/pocket/rpc", body, cookie, csrf);
			assert.equal(submitted.status, 200);
			const receipt = JSON.parse(submitted.body) as { result: { receipt: { id: string } } };
			assert.equal(
				(
					await request(
						"/pocket/rpc",
						{ version: 2, requestId: "remote-wait", command: { op: "wait", id: receipt.result.receipt.id } },
						cookie,
						csrf,
					)
				).status,
				200,
			);
			assert.equal(m.f.requests.length, 1);
			assert.equal(
				(await request("/pocket/rpc", body, cookie, csrf, "https://untrusted.invalid")).status,
				403,
			);
			forwardedProto = "http";
			assert.equal((await request("/pocket/rpc", body, cookie, csrf)).status, 403);
			forwardedProto = "https";
			const direct = await fetch(`http://127.0.0.1:${backendPort}/pocket/rpc`, {
				method: "POST",
				headers: { Origin: origin, Cookie: cookie, "X-Pakka-CSRF": csrf, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			assert.equal(direct.status, 403);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await remote.close();
			await new Promise<void>((r) => {
				proxy.close(() => r());
				proxy.closeAllConnections();
			});
			await m.close();
		}
	},
);
