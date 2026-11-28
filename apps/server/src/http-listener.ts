import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// WHATWG Fetch port blocking: https://fetch.spec.whatwg.org/#port-blocking
// Windows may allocate these even for listen(0). Do not disable browser/Fetch protection.
const blocked = new Set([
	1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104,
	109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
	526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
	3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** Trusted host utility: bind an HTTP server before publishing a browser/Fetch-facing address. */
export async function listenHttp(
	server: Server,
	options: { host: string; port?: number },
): Promise<AddressInfo> {
	const port = options.port ?? 0;
	if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError("Invalid HTTP port");
	if (blocked.has(port))
		throw Object.assign(new RangeError("HTTP port is blocked by Fetch; select another port"), {
			code: "ERR_UNSAFE_HTTP_PORT",
		});
	for (let attempt = 0; attempt < 32; attempt++) {
		await new Promise<void>((resolve, reject) => {
			const ready = () => {
				server.off("error", failed);
				resolve();
			};
			const failed = (error: Error) => {
				server.off("listening", ready);
				reject(error);
			};
			server.once("error", failed);
			server.once("listening", ready);
			try {
				server.listen(port, options.host);
			} catch (error) {
				server.off("error", failed);
				server.off("listening", ready);
				reject(error);
			}
		});
		const address = server.address();
		if (address && typeof address !== "string" && !blocked.has(address.port)) return address;
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
		if (!address || typeof address === "string") throw new Error("HTTP listener address unavailable");
	}
	throw new Error("No Fetch-compatible ephemeral HTTP port available");
}
