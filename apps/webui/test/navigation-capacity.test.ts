import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fixture } from "./fixture.ts";

test(
	"WebUI metadata single writer: competing CAS admits one; finite capacity preserves original receipts and never prunes/replays",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const original = { requestId: "first", expectedVersion: 0, name: "First metadata", archived: false };
			const results = await Promise.allSettled([
				m.client.setMetadata(m.ref, original),
				m.client.setMetadata(m.ref, { ...original, requestId: "competing", name: "Competing metadata" }),
			]);
			assert.equal(results[0]!.status, "fulfilled");
			assert.equal(results[1]!.status, "rejected");
			for (let expectedVersion = 1; expectedVersion < 256; expectedVersion++)
				await m.client.setMetadata(m.ref, {
					requestId: "update-" + expectedVersion,
					expectedVersion,
					name: "Version " + (expectedVersion + 1),
					archived: false,
				});
			const catalog = m.runtime.catalog({ namespace: "pocket", maxDeliveries: 32, maxPending: 8 }),
				version = (await catalog.snapshot()).version;
			await assert.rejects(
				m.client.setMetadata(m.ref, {
					requestId: "over-capacity",
					expectedVersion: 256,
					name: "Must not commit",
					archived: true,
				}),
				/capacity/,
			);
			assert.equal((await catalog.snapshot()).version, version);
			assert.deepEqual(
				await m.client.setMetadata(m.ref, original),
				results[0]!.status === "fulfilled" ? results[0]!.value : null,
			);
			assert.equal((await m.client.navigation())[0]!.version, 256);
			assert.equal((await m.client.navigation())[0]!.name, "Version 256");
			assert.equal((await catalog.snapshot()).version, version);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
