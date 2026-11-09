import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { listenHttp } from "../../../apps/server/src/http-listener.ts";
import { createPocketClient, PocketRemoteError } from "../src/pocket.ts";

const target = {
	key: "root",
	sessionId: "session-a",
	conversationId: "2",
	incarnation: "instance",
	profile: "default",
};
const reference = {
	id: "c".repeat(64),
	source: "entry" as const,
	entryId: "9",
	revision: "3",
	path: "/model/0/content/0/text",
	encoding: "text" as const,
	byteLength: 1024 * 1024,
	previewComplete: false,
};

test("WebUI content client: exact target, source reference and original range are correlated without replay", async () => {
	let mode = "valid",
		seen = 0;
	const server = createServer((request, response) => {
		const parts: Buffer[] = [];
		request.on("data", (part) => parts.push(part));
		request.on("end", () => {
			const parsed = JSON.parse(Buffer.concat(parts).toString("utf8"));
			seen++;
			const chunk = {
				reference: mode === "reference" ? { ...reference, revision: "another" } : reference,
				offset: mode === "offset" ? 1 : 0,
				nextOffset: 128,
				complete: false,
				text: "original bounded fragment",
			};
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					version: 2,
					requestId: parsed.requestId,
					serverId: "server",
					result: {
						kind: "content",
						target: mode === "target" ? { ...target, sessionId: "other-session" } : target,
						chunk,
					},
				}),
			);
		});
	});
	const address = await listenHttp(server, { host: "127.0.0.1" });
	try {
		const client = createPocketClient({ endpoint: `http://127.0.0.1:${address.port}/pocket/rpc` });
		const command = { op: "content.read" as const, target, reference, range: { offset: 0, length: 65536 } };
		const valid = await client.request(command);
		assert.equal(valid.kind, "content");
		for (mode of ["target", "reference", "offset"])
			await assert.rejects(
				client.request(command),
				(failure: unknown) =>
					failure instanceof PocketRemoteError && failure.outcome === "unknown" && failure.code === "UNKNOWN",
			);
		assert.equal(seen, 4);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});
