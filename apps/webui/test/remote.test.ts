import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer as createHttps, request as tlsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { createServer as createTcp } from "node:net";
import { readFile } from "node:fs/promises";
import { fixture } from "./fixture.ts";
import { createPocketHttp } from "../src/http.ts";
import { createWebUiServices } from "../src/webui-services.ts";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { WEBUI_SERVICE_API, decodeWebUiResponse } from "@pakka/protocol/webui";

// Public test-only TLS material generated for localhost; never used as a deployment certificate or credential.
test(
	"WebUI remote: actual TLS proxy uses exact trusted peer/origin and secure cookies; direct/plain/spoofed access is rejected",
	{ timeout: 20000 },
	async () => {
		// Load required assets before allocating a Runtime/listener, so a missing fixture cannot leak handles.
		const [key, cert] = await Promise.all([
			readFile(new URL("./tls/key.pem", import.meta.url)),
			readFile(new URL("./tls/cert.pem", import.meta.url)),
		]);
		const m = await fixture();
		const reserve = createTcp();
		await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
		const address = reserve.address();
		assert.ok(address && typeof address !== "string");
		const backendPort = address.port;
		await new Promise<void>((r) => reserve.close(() => r()));
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
		const services = await createWebUiServices({
			runtime: m.runtime,
			people: m.people,
			workspace: m.workspace,
		});
		let personId = "";
		const remote = await createPocketHttp({
			runtime: m.runtime,
			people: m.people,
			workspace: m.workspace,
			webuiServices: services,
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
								...(personId ? { "X-Pakka-Person": personId, "X-Pakka-Server": remote.serverId } : {}),
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
			const login = await request("/pakka-webui/exchange", { kind: "session", token: rotated.token });
			assert.equal(login.status, 200);
			assert.ok(login.headers["set-cookie"]?.every((value) => /; Secure/.test(value)));
			assert.match(login.headers["set-cookie"]![0]!, /HttpOnly/);
			const cookie = login.headers["set-cookie"]!.map((v) => v.split(";")[0]).join("; "),
				csrf = /pakka_csrf=([^;]+)/.exec(cookie)![1]!;
			const actor = await m.people.authenticate(/pakka_pocket=([^;]+)/.exec(cookie)![1]!);
			personId = m.people.current(actor).id;
			const original = {
				target: m.ref,
				input: { requestId: "tls-input", mode: "prompt", text: "REAL-TLS" },
			};
			const body = {
				version: 2,
				requestId: "remote-request",
				command: { op: "submit", ...original },
			};
			const submitted = await request("/pakka-webui/rpc", body, cookie, csrf);
			assert.equal(submitted.status, 200);
			const receipt = decodePocketResponse(JSON.parse(submitted.body), body.requestId);
			assert.ok("result" in receipt && receipt.result.kind === "receipt");
			const receiptId = receipt.result.receipt.id;
			const waited = await request(
				"/pakka-webui/rpc",
				{ version: 2, requestId: "remote-wait", command: { op: "wait", id: receiptId } },
				cookie,
				csrf,
			);
			assert.equal(waited.status, 200);
			const final = decodePocketResponse(JSON.parse(waited.body), "remote-wait");
			assert.ok("result" in final && final.result.kind === "receipt");
			assert.equal(final.result.receipt.status, "done");
			assert.equal(m.f.requests.length, 1);
			const query = {
				api: WEBUI_SERVICE_API,
				requestId: "remote-lookup",
				binding: { personId, serverId: remote.serverId },
				command: { op: "input.lookup", original },
			};
			const found = await request("/pakka-webui/services", query, cookie, csrf);
			assert.equal(found.status, 200);
			const decoded = decodeWebUiResponse(JSON.parse(found.body), query.requestId);
			assert.ok("result" in decoded && decoded.result.kind === "input-operation");
			assert.equal(decoded.result.receipt?.id, receiptId);
			assert.equal(decoded.result.receipt?.status, "done");
			assert.equal((await request("/pakka-webui/services", query, cookie, "wrong-csrf")).status, 403);
			assert.equal(
				(
					await request(
						"/pakka-webui/services",
						{ ...query, binding: { ...query.binding, personId: "another-person" } },
						cookie,
						csrf,
					)
				).status,
				403,
			);
			assert.equal(
				(await request("/pakka-webui/rpc", body, cookie, csrf, "https://untrusted.invalid")).status,
				403,
			);
			for (const [path, payload] of [
				["/pakka-webui/rpc", body],
				["/pakka-webui/services", query],
			] as const) {
				forwardedProto = "http";
				assert.equal((await request(path, payload, cookie, csrf)).status, 403);
				forwardedProto = "https";
				const direct = await fetch(`http://127.0.0.1:${backendPort}${path}`, {
					method: "POST",
					headers: {
						Origin: origin,
						Cookie: cookie,
						"X-Pakka-CSRF": csrf,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
				});
				assert.equal(direct.status, 403);
			}
			assert.equal(m.f.requests.length, 1);
		} finally {
			await remote.close();
			await services.close();
			await new Promise<void>((r) => {
				proxy.close(() => r());
				proxy.closeAllConnections();
			});
			await m.close();
		}
	},
);
