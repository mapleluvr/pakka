/// <reference types="node" />
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createMas } from "@pakka/mas";
import { createMasServer } from "../../../apps/server/src/http-server.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createClient } from "../src/index.ts";
import { deferred } from "../../agent/test/fixture.ts";
const token = "local-only-client-test-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
async function crew(respond?: Parameters<typeof runtimeFixture>[2], maxPending?: number) {
	const m = await runtimeFixture({}, undefined, respond);
	try {
		const mas = await createMas({ runtime: m.runtime, namespace: "client", maxDeliveries: 8, maxPending: 2 });
		await mas.bootstrap([{ key: "peer", owner: "operator" }]);
		await mas.activate();
		const server = await createMasServer({
			mas,
			sessionId: m.runtime.view().sessionId,
			maxPending,
			roles: [{ token, principal: "operator", source: null, grants: ["discover", "observe", "send"] }],
		});
		return {
			m,
			mas,
			server,
			ref: (await mas.view()).members[0]!.ref,
			close: async () => {
				await server.close();
				await m.close();
			},
		};
	} catch (error) {
		await m.close();
		throw error;
	}
}
test(
	"M5 client: fresh reconnect reads scoped snapshot, never silently repeats mutations or replaces admission",
	{ timeout: 20000 },
	async () => {
		const m = await crew();
		try {
			const client = createClient({ endpoint: m.server.endpoint, token });
			const initial = await client.reconnect();
			assert.equal(initial.sessionId, m.ref.sessionId);
			assert.equal(initial.members.length, 1);
			assert.equal(initial.serverId, m.server.serverId);
			const sent = await client.request({
				op: "send",
				target: m.ref,
				input: { requestId: "stable", text: "CLIENT-INPUT" },
			});
			if (sent.kind !== "receipt") assert.fail("missing receipt");
			const done = await client.request({ op: "wait", id: sent.receipt.id });
			if (done.kind !== "receipt") assert.fail("missing receipt");
			assert.equal(done.receipt.status, "done");
			assert.equal(done.serverId, m.server.serverId);
			const fresh = createClient({ endpoint: m.server.endpoint, token });
			assert.equal((await fresh.reconnect()).sessionId, initial.sessionId);
			const repeat = await fresh.request({
				op: "send",
				target: m.ref,
				input: { requestId: "stable", text: "CLIENT-INPUT" },
			});
			if (repeat.kind !== "receipt") assert.fail("missing receipt");
			assert.equal(repeat.receipt.id, sent.receipt.id);
			assert.equal(m.m.f.requests.length, 1);
			m.server.revoke("operator");
			await assert.rejects(
				fresh.reconnect(),
				(error) => error instanceof Error && "outcome" in error && error.outcome === "denied",
			);
		} finally {
			await m.close();
		}
	},
);
test(
	"M5 client: uncorrelated pre-body capacity remains unknown rather than trusting HTTP status",
	{ timeout: 20000 },
	async () => {
		const m = await crew(undefined, 1),
			entered = deferred(),
			release = deferred();
		let first: ReturnType<ReturnType<typeof createClient>["request"]> | undefined;
		try {
			m.mas.setAdmission(async () => {
				entered.resolve();
				await release.promise;
				return true;
			});
			const client = createClient({ endpoint: m.server.endpoint, token });
			first = client.request({
				op: "send",
				target: m.ref,
				input: { requestId: "capacity-first", text: "ONLY-CAPACITY-FIRST" },
			});
			await entered.promise;
			await assert.rejects(
				client.request({
					op: "send",
					target: m.ref,
					input: { requestId: "capacity-overflow", text: "NO-CAPACITY-OVERFLOW" },
				}),
				(error) => error instanceof Error && "outcome" in error && error.outcome === "unknown",
			);
			assert.equal(m.m.f.requests.length, 0);
			release.resolve();
			const admitted = await first;
			if (admitted.kind !== "receipt") assert.fail("No admitted first receipt");
			const done = await client.request({ op: "wait", id: admitted.receipt.id });
			if (done.kind !== "receipt") assert.fail("No terminal first receipt");
			assert.equal(done.receipt.status, "done");
			assert.equal(m.m.f.requests.length, 1);
		} finally {
			release.resolve();
			await first?.catch(() => {});
			await m.close();
		}
	},
);
test(
	"M5 client: cancelling an already-placed wait preserves admitted work and causes no implicit target abort",
	{ timeout: 20000 },
	async () => {
		const entered = deferred(),
			release = deferred(),
			m = await crew(async () => {
				entered.resolve();
				await release.promise;
				return { text: "LOCAL-AFTER-WAIT-CANCEL" };
			});
		try {
			const client = createClient({ endpoint: m.server.endpoint, token });
			const sent = await client.request({
				op: "send",
				target: m.ref,
				input: { requestId: "cancel-wait", text: "ADMITTED-BEFORE-WAIT-CANCEL" },
			});
			if (sent.kind !== "receipt") assert.fail("No native receipt");
			await entered.promise;
			const controller = new AbortController(),
				waiting = client.request({ op: "wait", id: sent.receipt.id }, { signal: controller.signal });
			controller.abort();
			await assert.rejects(
				waiting,
				(error) => error instanceof Error && "outcome" in error && error.outcome === "unknown",
			);
			const observed = await client.request({ op: "receipt", id: sent.receipt.id });
			if (observed.kind !== "receipt") assert.fail("No retained receipt");
			assert.equal(observed.receipt.id, sent.receipt.id);
			assert.notEqual(observed.receipt.status, "unanswered");
			assert.equal(m.m.f.requests.length, 1);
			release.resolve();
			const done = await client.request({ op: "wait", id: sent.receipt.id });
			if (done.kind !== "receipt") assert.fail("No terminal receipt");
			assert.equal(done.receipt.status, "done");
			assert.equal(m.m.f.requests.length, 1);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
test(
	"M5 client: malformed response UTF-8 cannot publish a normalized native receipt after real admission",
	{ timeout: 20000 },
	async () => {
		const m = await crew();
		let nativeId = "";
		const proxy = createServer(async (req, res) => {
			try {
				const chunks: Buffer[] = [];
				for await (const chunk of req) chunks.push(Buffer.from(chunk));
				const allowed = new URL(m.server.endpoint);
				assert.equal(allowed.protocol, "http:");
				assert.equal(allowed.hostname, "127.0.0.1");
				const upstream = await fetch(allowed, {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
					body: Buffer.concat(chunks),
				});
				const original = await upstream.text();
				const receipt = original.match(/"receipt":\{[^]*?"id":"([^"]+)"/);
				assert.ok(receipt);
				nativeId = receipt[1]!;
				const marker = '"receipt":{',
					index = original.indexOf(marker);
				assert.ok(index >= 0);
				const corrupt = Buffer.concat([
					Buffer.from(original.slice(0, index + marker.length) + '"reason":"'),
					Buffer.from([0x80]),
					Buffer.from('",' + original.slice(index + marker.length)),
				]);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(corrupt);
			} catch {
				res.destroy();
			}
		});
		try {
			await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
			const address = proxy.address();
			if (!address || typeof address === "string") assert.fail("Missing owned proxy");
			const client = createClient({ endpoint: "http://127.0.0.1:" + address.port + "/rpc", token });
			await assert.rejects(
				client.request({
					op: "send",
					target: m.ref,
					input: { requestId: "malformed-reply", text: "REAL-BEFORE-MALFORMED-REPLY" },
				}),
				(error) => error instanceof Error && "outcome" in error && error.outcome === "unknown",
			);
			const done = await m.mas
				.connect({ principal: "operator", source: null, grants: ["observe"] })
				.wait(nativeId);
			assert.equal(done.status, "done");
			assert.equal(m.m.f.requests.length, 1);
		} finally {
			proxy.closeAllConnections();
			await new Promise<void>((resolve) => proxy.close(() => resolve()));
			await m.close();
		}
	},
);
test(
	"M5 client: lost HTTP response after real delivery stays unknown; caller retry retains message identity",
	{ timeout: 20000 },
	async () => {
		const m = await crew();
		let lost = true;
		const proxy = createServer(async (req, res) => {
			try {
				const chunks: Buffer[] = [];
				for await (const chunk of req) chunks.push(Buffer.from(chunk));
				// Controlled test-only loopback proxy forwards the actual server operation, dropping only its response.
				const allowed = new URL(m.server.endpoint);
				assert.equal(allowed.protocol, "http:");
				assert.equal(allowed.hostname, "127.0.0.1");
				const upstream = await fetch(allowed, {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
					body: Buffer.concat(chunks),
				});
				const body = await upstream.text();
				if (lost) {
					lost = false;
					res.destroy();
					return;
				}
				res.writeHead(upstream.status, { "Content-Type": "application/json" });
				res.end(body);
			} catch {
				res.destroy();
			}
		});
		try {
			await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
			const address = proxy.address();
			if (!address || typeof address === "string") assert.fail("no proxy address");
			const client = createClient({ endpoint: "http://127.0.0.1:" + address.port + "/rpc", token });
			const input = { requestId: "lost", text: "LOST-RESPONSE-REAL-INPUT" };
			await assert.rejects(
				client.request({ op: "send", target: m.ref, input }),
				(error) => error instanceof Error && "outcome" in error && error.outcome === "unknown",
			);
			const repeated = await client.request({ op: "send", target: m.ref, input });
			if (repeated.kind !== "receipt") assert.fail("no receipt");
			const done = await client.request({ op: "wait", id: repeated.receipt.id });
			assert.equal(done.kind, "receipt");
			assert.equal(m.m.f.requests.length, 1);
		} finally {
			proxy.closeAllConnections();
			await new Promise<void>((resolve) => proxy.close(() => resolve()));
			await m.close();
		}
	},
);
