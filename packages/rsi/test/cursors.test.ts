import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";

test("foreign history cursors are rejected without disabling a healthy ticket space", async () => {
	const m = await runtimeFixture();
	try {
		const client = (await createTicketService({ runtime: m.runtime, namespace: "cursors" })).connect({
			id: "owner",
			role: () => "manager",
			check() {},
		});
		let a = await client.submit({ requestId: "a", title: "A", body: "A", sources: [] });
		const b = await client.submit({ requestId: "b", title: "B", body: "B", sources: [] });
		for (let n = 0; n < 35; n++)
			a = await client.edit({
				requestId: `edit-${n}`,
				id: a.id,
				expectedVersion: a.version,
				title: "A",
				body: String(n),
				sources: [],
			});
		const cursor = (await client.get(a.id)).cursors.revisions!;
		await assert.rejects(
			client.history({ id: b.id, kind: "revisions", cursor }),
			(error) => error instanceof Error && "code" in error && error.code === "invalid",
		);
		assert.equal((await client.get(a.id)).ticket.version, 36);
		assert.equal(m.runtime.view().phase, "ready");
		assert.equal((await client.list()).items.length, 2);
	} finally {
		await m.close();
	}
});
