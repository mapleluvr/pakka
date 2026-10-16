import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { connect, type Socket } from "node:net";

/** Process-owned egress filter: covers popups/workers that are outside a page's CDP session. */
export async function browserNetwork(origins: ReadonlySet<string>) {
	let closed = false,
		active = 0;
	const sockets = new Set<Socket>();
	const allowed = (raw: string, protocol: string): URL | undefined => {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return;
		}
		if (url.protocol !== protocol || url.username || url.password || !origins.has(url.origin)) return;
		return url;
	};
	const headers = (incoming: IncomingHttpHeaders): IncomingHttpHeaders => {
		const value = { ...incoming };
		for (const key of [
			"connection",
			"proxy-connection",
			"proxy-authorization",
			"proxy-authenticate",
			"keep-alive",
			"upgrade",
			"te",
			"trailer",
			"transfer-encoding",
		])
			delete value[key];
		return value;
	};
	const proxy = createServer(
		{ maxHeaderSize: 16384, requestTimeout: 10000, headersTimeout: 5000 },
		(req, res) => {
			const target = allowed(req.url ?? "", "http:");
			if (closed || !target || active >= 64) {
				res.writeHead(403);
				res.end();
				req.resume();
				return;
			}
			active++;
			let requestBytes = 0,
				responseBytes = 0;
			// target is selected only after an exact origin match to the host-approved set; no redirects/retries.
			const outgoing = request(
				target,
				{
					method: req.method,
					headers: { ...headers(req.headers), host: target.host },
					timeout: 5000,
					agent: false,
				},
				(response) => {
					if (res.destroyed) {
						response.destroy();
						return;
					}
					res.writeHead(response.statusCode ?? 502, headers(response.headers));
					response.on("data", (data: Buffer) => {
						responseBytes += data.length;
						if (responseBytes > 8 * 1024 * 1024) {
							outgoing.destroy();
							res.destroy();
						}
					});
					response.on("error", () => res.destroy());
					response.pipe(res);
				},
			);
			outgoing.on("timeout", () => outgoing.destroy());
			outgoing.on("error", () => {
				if (!res.headersSent) {
					res.writeHead(502);
					res.end();
				} else res.destroy();
			});
			outgoing.once("close", () => {
				active--;
			});
			req.on("data", (data: Buffer) => {
				requestBytes += data.length;
				if (requestBytes > 2 * 1024 * 1024) {
					outgoing.destroy();
					req.destroy();
				}
			});
			req.on("error", () => outgoing.destroy());
			res.on("close", () => outgoing.destroy());
			req.pipe(outgoing);
		},
	);
	proxy.on("connection", (socket) => {
		// Rejected CONNECT sockets also own their reset/error cleanup, before any tunnel exists.
		socket.on("error", () => socket.destroy());
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
		socket.setTimeout(10000, () => socket.destroy());
	});
	proxy.on("upgrade", (_request, socket) => {
		socket.destroy();
	});
	proxy.on("connect", (req, client, head) => {
		const target = allowed("https://" + (req.url ?? ""), "https:");
		const authority = target ? target.hostname + ":" + (target.port || "443") : "";
		if (closed || !target || (req.url !== target.host && req.url !== authority) || active >= 64) {
			client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
			return;
		}
		active++;
		// CONNECT cannot change host/port within the tunnel. Only explicitly approved HTTPS origins enter.
		const remote = connect({
			host: target.hostname.replace(/^\[|\]$/g, ""),
			port: Number(target.port || 443),
		});
		sockets.add(remote);
		remote.setTimeout(10000, () => remote.destroy());
		remote.once("connect", () => {
			client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			if (head.length) remote.write(head);
			remote.pipe(client);
			client.pipe(remote);
		});
		remote.on("error", () => client.destroy());
		client.on("error", () => remote.destroy());
		client.once("close", () => remote.destroy());
		remote.once("close", () => {
			active--;
			sockets.delete(remote);
			client.destroy();
		});
	});
	proxy.on("clientError", (_error, socket) => socket.destroy());
	await new Promise<void>((resolve, reject) => {
		proxy.once("error", reject);
		proxy.listen(0, "127.0.0.1", () => {
			proxy.removeListener("error", reject);
			resolve();
		});
	});
	const address = proxy.address();
	if (!address || typeof address === "string") {
		proxy.close();
		throw Error("Owned browser network unavailable");
	}
	return Object.freeze({
		endpoint: "http://127.0.0.1:" + address.port,
		close: async () => {
			if (closed) return;
			closed = true;
			for (const socket of sockets) socket.destroy();
			proxy.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				proxy.close((error) => (error ? reject(error) : resolve())),
			);
		},
	});
}
