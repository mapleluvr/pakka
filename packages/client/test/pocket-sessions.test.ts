import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { once } from "node:events";
import { createPocketClient, PocketRemoteError } from "../src/pocket.ts";

// Transport correlation only, not proof of a producer's capabilities or native persistence.
test("WebUI Session correlation: a same-ID receipt or team snapshot from another parent is rejected", async () => {
	const seen: unknown[] = [];
	const ref = {
		key: "member",
		sessionId: "parent-b",
		conversationId: "9",
		incarnation: "instance",
		profile: "default",
	};
	const server = createServer((request, response) => {
		const parts: Buffer[] = [];
		request.on("data", (part) => parts.push(part));
		request.on("end", () => {
			const parsed = JSON.parse(Buffer.concat(parts).toString("utf8"));
			seen.push(parsed.command);
			const result =
				parsed.command.op === "hello"
					? {
							kind: "hello",
							versions: [2],
							sessionId: "control",
							person: { id: "human", name: "Owner", role: "admin", resources: "*", active: true },
						}
					: parsed.command.op === "receipt"
						? {
								kind: "receipt",
								receipt: {
									id: "native-original",
									requestId: "original-input",
									actorId: "human",
									target: ref,
									status: "done",
								},
							}
						: {
								kind: "collaboration",
								snapshot: {
									conversationId: ref.conversationId,
									sessionId: ref.sessionId,
									version: 0,
									messages: [],
									note: { version: 0, text: "", authorId: null, updatedAt: null },
									driver: { version: 0, personId: null, expiresAt: null },
									presence: [],
								},
							};
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ version: 2, serverId: "server", requestId: parsed.requestId, result }));
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	try {
		const client = createPocketClient({ endpoint: `http://127.0.0.1:${address.port}/pocket/rpc` });
		await client.request({ op: "hello" });
		const unconfirmed = (failure: unknown) =>
			failure instanceof PocketRemoteError && failure.code === "UNKNOWN" && failure.outcome === "unknown";
		await assert.rejects(
			client.request({ op: "receipt", id: "native-original", sessionId: "parent-a" }),
			unconfirmed,
		);
		await assert.rejects(
			client.request({ op: "collaboration.read", target: { ...ref, sessionId: "parent-a" } }),
			unconfirmed,
		);
		const original = await client.request({ op: "receipt", id: "native-original", sessionId: ref.sessionId });
		assert.equal(original.kind, "receipt");
		assert.deepEqual(seen[1], { op: "receipt", id: "native-original", sessionId: "parent-a" });
		assert.equal(seen.length, 4);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});
