import { test } from "node:test";
import assert from "node:assert/strict";
import { createMas, type MasClient } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createMasServer } from "../src/http-server.ts";

test("HTTP snapshot does not publish members when issuer is revoked after synchronous discovery", async () => {
	const m = await runtimeFixture();
	let server: Awaited<ReturnType<typeof createMasServer>> | undefined,
		armed = false,
		revoked = false;
	const token = "local-publication-aaaaaaaaaaaaaaaaaaaaaaaa";
	try {
		const mas = await createMas({ runtime: m.runtime, namespace: "publication-http", maxPending: 4 });
		await mas.bootstrap([{ key: "PRIVATE-MEMBER", owner: "owner", lifetime: "persistent" }]);
		await mas.activate();
		const observe = (client: MasClient): MasClient => ({
			...client,
			withAuthority(check) {
				return observe(client.withAuthority(check));
			},
			discover() {
				const members = client.discover();
				if (armed)
					queueMicrotask(() => {
						server!.revoke("observer");
						revoked = true;
					});
				return members;
			},
		});
		server = await createMasServer({
			mas: {
				...mas,
				connect(role) {
					return observe(mas.connect(role));
				},
			},
			sessionId: m.runtime.view().sessionId,
			roles: [{ token, principal: "observer", source: null, grants: ["discover", "observe"] }],
		});
		const endpoint = new URL(server.endpoint);
		assert.equal(endpoint.protocol, "http:");
		assert.equal(endpoint.hostname, "127.0.0.1", "Only the fixture's loopback server is contacted");
		let sequence = 0;
		const rpc = async () => {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
				body: JSON.stringify({
					version: 1,
					requestId: "snapshot-" + ++sequence,
					command: { op: "snapshot" },
				}),
			});
			return { status: response.status, body: await response.json() };
		};
		const baseline = await rpc();
		assert.equal(baseline.body.result.members[0].key, "PRIVATE-MEMBER");
		armed = true;
		const late = await rpc(),
			next = await rpc();
		assert.equal(revoked, true);
		assert.equal(next.status, 401);
		assert.equal(late.body.result, undefined);
		assert.equal(late.body.error.outcome, "denied", "snapshot has no newly executed effect to reconcile");
		assert.ok(!JSON.stringify(late.body).includes("PRIVATE-MEMBER"));
		assert.equal(m.f.requests.length, 0);
	} finally {
		await server?.close();
		await m.close();
	}
});
