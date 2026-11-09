import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";

test("result references preserve artifact identity separately from content and cannot bind a foreign run", async () => {
	const m = await runtimeFixture();
	try {
		const manager = (await createTicketService({ runtime: m.runtime, namespace: "results" })).connect({
			id: "manager",
			role: () => "manager",
			check() {},
		});
		const created = await manager.submit({
			requestId: "new",
			title: "Research",
			body: "Fixed content",
			sources: [],
		});
		const results = [
			{ uri: "artifact:report", version: "v2", sha256: "a".repeat(64), description: "Measured output" },
		];
		await manager.report({
			requestId: "result",
			id: created.id,
			expectedVersion: 1,
			state: "waiting",
			text: "Results available",
			links: [],
			results,
		});
		const view = await manager.get(created.id);
		assert.equal(view.ticket.contentRevision, 1);
		assert.deepEqual(view.ticket.events.at(-1)?.results, results);
		await assert.rejects(
			manager.report({
				requestId: "foreign",
				id: created.id,
				expectedVersion: view.ticket.version,
				state: "closed",
				text: "wrong run",
				links: [],
				runId: "foreign-run",
				results,
			}),
			/Run not found/,
		);
		assert.equal((await manager.get(created.id)).ticket.version, 2);
	} finally {
		await m.close();
	}
});
