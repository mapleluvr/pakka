import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";

test("ticket observation publishes only a scoped revision and changes after committed authorized facts", async () => {
	const m = await runtimeFixture();
	try {
		const service = await createTicketService({ runtime: m.runtime, namespace: "observe" });
		const a = service.connect({ id: "a", role: () => "submitter", check() {} });
		const b = service.connect({ id: "b", role: () => "submitter", check() {} });
		const before = await a.observe();
		await b.submit({ requestId: "foreign", title: "PRIVATE", body: "SECRET", sources: [] });
		assert.deepEqual(await a.observe(), before);
		const input = { requestId: "own", title: "Mine", body: "text", sources: [] };
		await a.submit(input);
		const after = await a.observe();
		assert.notEqual(after.revision, before.revision);
		assert.equal(JSON.stringify(after).includes("SECRET"), false);
		await a.submit(input);
		assert.deepEqual(await a.observe(), after);
		const denied = a.withAuthority(() => {
			throw Error("revoked");
		});
		await assert.rejects(denied.observe(), /denied/);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
