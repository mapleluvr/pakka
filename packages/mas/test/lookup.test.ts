import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMas } from "../src/index.ts";

test("MAS original request lookup is passive, payload-bound and rechecks the original authority", async () => {
	const m = await runtimeFixture();
	try {
		const mas = await createMas({ runtime: m.runtime, namespace: "lookup", maxPending: 4 });
		await mas.bootstrap([
			{ key: "worker", owner: "owner" },
			{ key: "other", owner: "owner" },
		]);
		await mas.activate();
		const members = (await mas.view()).members,
			target = members[0]!.ref,
			other = members[1]!.ref;
		const client = mas.connect({ principal: "owner", source: null, grants: ["send", "observe"] });
		let admissions = 0;
		mas.setAdmission(() => {
			admissions++;
			return true;
		});
		const input = { requestId: "original", text: "Fixed input" };
		assert.equal(typeof client.lookup, "function");
		assert.equal(await client.lookup(target, input), null);
		assert.equal(admissions, 0);
		const accepted = await client.send(target, input);
		await m.runtime.waitForIdle();
		const result = await client.lookup(target, input);
		assert.equal(result?.id, accepted.id);
		assert.equal(result?.status, "done");
		await assert.rejects(client.lookup(other, input), /conflict|identity|route/i);
		await assert.rejects(client.lookup(target, { ...input, text: "Changed" }), /conflict|identity/i);
		assert.equal(admissions, 1);
		assert.equal(m.f.requests.length, 1);
		mas.revoke("owner");
		await assert.rejects(client.lookup(target, input), /revoked/i);
	} finally {
		await m.close();
	}
});
