import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createPocketClient, PocketRemoteError } from "../src/pocket.ts";

const ref = {
	key: "root",
	sessionId: "storage-a",
	conversationId: "c1",
	incarnation: "instance-a",
	profile: "default",
};
const person = { id: "human-a", name: "Alice", role: "sender", resources: ["c1"], active: true };
async function localServer(handler: (request: IncomingMessage, response: ServerResponse) => void) {
	const server = createServer(handler);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return {
		endpoint: `http://127.0.0.1:${address.port}/pocket/rpc`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			}),
	};
}

// The browser-safe path must retain instance correlation and send only explicit finite Pocket commands.
test("Pocket fetch client: actual HTTP uses v2/CSRF and reconnect checks the storage instance", async () => {
	const seen: Record<string, unknown>[] = [];
	const server = await localServer((req, res) => {
		const parts: Buffer[] = [];
		req.on("data", (chunk) => parts.push(chunk));
		req.on("end", () => {
			let request: { requestId: string; command: { op: string } };
			try {
				request = JSON.parse(Buffer.concat(parts).toString("utf8"));
			} catch {
				res.destroy();
				return;
			}
			seen.push({ path: req.url, csrf: req.headers["x-pakka-csrf"], ...request });
			const result =
				request.command.op === "hello"
					? { kind: "hello", versions: [2], person, sessionId: "storage-a" }
					: { kind: "list", conversations: [ref] };
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify({ version: 2, requestId: request.requestId, serverId: "server-a", result }));
		});
	});
	try {
		const client = createPocketClient({ endpoint: server.endpoint, csrf: () => "x".repeat(43) });
		const list = await client.reconnect();
		assert.equal(list.kind, "list");
		assert.equal(list.serverId, "server-a");
		assert.equal(seen.length, 2);
		assert.equal(seen[0]!.path, "/pocket/rpc");
		assert.equal(seen[0]!.version, 2);
		assert.equal(seen[0]!.csrf, "x".repeat(43));
		assert.equal(Object.isFrozen(list), true);
	} finally {
		await server.close();
	}
});

// A connection drop after the server receives a mutation is not proof of refusal and must not auto-replay it.
test("Pocket fetch client: a received mutation followed by disconnect remains unknown with zero automatic retries", async () => {
	let received = 0;
	const server = await localServer((req, res) => {
		req.resume();
		req.on("end", () => {
			received++;
			res.destroy();
		});
	});
	try {
		const client = createPocketClient({ endpoint: server.endpoint });
		await assert.rejects(
			client.request(
				{ op: "submit", target: ref, input: { requestId: "stable-message", text: "Work", mode: "prompt" } },
				{ requestId: "transport-id" },
			),
			(error) =>
				error instanceof PocketRemoteError &&
				error.outcome === "unknown" &&
				error.requestId === "transport-id",
		);
		assert.equal(received, 1);
	} finally {
		await server.close();
	}
});

// HTTP status cannot substitute for a valid correlated protocol refusal; malformed bytes must not be replaced.
test("Pocket fetch client: unrelated errors, wrong target and malformed UTF-8 remain unknown", async () => {
	let mode = "unrelated";
	const server = await localServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.statusCode = 403;
			res.setHeader("Content-Type", "application/json");
			const body = {
				version: 2,
				requestId: mode === "unrelated" ? "other" : "rpc",
				serverId: "server-a",
				error: { code: "FORBIDDEN", outcome: "denied", message: "Refused" },
			};
			if (mode === "utf8") {
				const bytes = Buffer.from(JSON.stringify(body));
				const at = bytes.indexOf("Refused");
				bytes[at] = 0xc3;
				bytes[at + 1] = 0x28;
				res.end(bytes);
			} else res.end(JSON.stringify(body));
		});
	});
	try {
		const client = createPocketClient({ endpoint: server.endpoint });
		for (mode of ["unrelated", "utf8"])
			await assert.rejects(
				client.request({ op: "list" }, { requestId: "rpc" }),
				(error) => error instanceof PocketRemoteError && error.outcome === "unknown",
			);
		mode = "correlated";
		await assert.rejects(
			client.request({ op: "list" }, { requestId: "rpc" }),
			(error) => error instanceof PocketRemoteError && error.outcome === "denied",
		);
	} finally {
		await server.close();
	}
});

// A well-formed result for a different resource/profile still cannot confirm a requested human mutation.
test("Pocket fetch client: create/configure/fork results bind the requested resource and profile", async () => {
	let wrong = false;
	const server = await localServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			let request: { requestId: string; command: { op: string } };
			try {
				request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				res.destroy();
				return;
			}
			const next = {
				...ref,
				profile: wrong ? "powerful" : "safe",
				incarnation: "new-instance",
				...(request.command.op === "fork" ? { key: "forked", conversationId: "c2" } : {}),
			};
			res.setHeader("Content-Type", "application/json");
			res.end(
				JSON.stringify({
					version: 2,
					requestId: request.requestId,
					serverId: "server-a",
					result: { kind: "reference", ref: next },
				}),
			);
		});
	});
	try {
		const client = createPocketClient({ endpoint: server.endpoint });
		for (const command of [
			{ op: "create" as const, requestId: "create", name: "Work", profile: "safe" },
			{ op: "configure" as const, target: ref, profile: "safe" },
			{
				op: "fork" as const,
				target: ref,
				requestId: "fork",
				name: "Alternative",
				profile: "safe",
				entryId: "1",
			},
		]) {
			wrong = false;
			assert.equal((await client.request(command)).kind, "reference");
			wrong = true;
			await assert.rejects(
				client.request(command),
				(error) => error instanceof PocketRemoteError && error.outcome === "unknown",
			);
		}
	} finally {
		await server.close();
	}
});
