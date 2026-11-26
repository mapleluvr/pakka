import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";

// Break caught: result references attach to the latest ticket/state or a
// caller-supplied run instead of the service-issued fixed original work.
test("result references retain original report attribution without adopting ticket state or a foreign run", async () => {
	const m = await runtimeFixture();
	try {
		const service = await createTicketService({
			runtime: m.runtime,
			namespace: "results",
			handlers: [{ id: "H", label: "H", actorId: "H" }],
		});
		const manager = service.connect({ id: "manager", role: () => "manager", check() {} });
		const worker = service.connect({ id: "H", role: () => "handler", check() {} });
		const created = await manager.submit({
			requestId: "new",
			title: "Research",
			body: "Fixed content",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "assign",
			id: created.id,
			expectedVersion: 1,
			handlerId: "H",
		});
		const conversation = await m.runtime.createConversation({ key: "result-work" });
		const work = await manager.registerWork({
			requestId: "work",
			id: created.id,
			expectedVersion: assigned.version,
			handlerId: "H",
			contentRevision: 1,
			conversation,
		});
		const results = [
			{ uri: "artifact:report", version: "v2", sha256: "a".repeat(64), description: "Measured output" },
		];
		const input = {
			requestId: "result",
			id: created.id,
			workId: work.workId,
			text: "Results available",
			links: [],
			results,
		};
		const receipt = await worker.report(input);
		const report = await worker.readReport({ id: created.id, reportId: receipt.reportId });
		assert.deepEqual(report.results, results);
		assert.equal(report.contentRevision, 1);
		assert.equal(report.actorId, "H");
		assert.equal(report.runId, null);
		assert.deepEqual(report.conversation, conversation);
		await assert.rejects(worker.report({ ...input, requestId: "foreign", runId: "foreign-run" } as never), {
			code: "invalid",
		});
		assert.equal(await worker.lookup("foreign"), null);
		const view = await manager.get(created.id);
		assert.equal(view.ticket.version, assigned.version);
		assert.equal(view.ticket.contentRevision, 1);
		assert.equal(view.ticket.state, "open");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
