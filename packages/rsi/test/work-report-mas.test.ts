import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { deferred, text } from "../../agent/test/fixture.ts";
import { createMas } from "../../mas/src/index.ts";
import { createTicketService } from "../src/index.ts";
import { createMasTicketDispatcher } from "../src/mas.ts";

// Break caught: native dispatch lacks a durable original contributor relation,
// or a lost dispatch response strips that relation and allows redelivery.
test("work reports MAS: original dispatch registers H atomically and includes its fixed work identity, even if admission response is lost", async () => {
	const entered = deferred(),
		release = deferred();
	const m = await runtimeFixture({}, undefined, async () => {
		entered.resolve();
		await release.promise;
		return { text: "Original investigation finished" };
	});
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "work-mas",
			maxPending: 8,
			maxDeliveries: 16,
		});
		await mas.bootstrap([
			{ key: "H", owner: "operator" },
			{ key: "J", owner: "operator" },
		]);
		await mas.activate();
		const members = (await mas.view()).members;
		const Href = members.find((m) => m.key === "H")!.ref;
		const sender = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
		const original = createMasTicketDispatcher({
			routes: [{ handlerId: "H", target: Href, client: sender }],
		});
		const dispatcher = {
			...original,
			send: async (...args: Parameters<typeof original.send>) => {
				await original.send(...args);
				throw Error("Lost admitted response");
			},
		};
		const service = await createTicketService({
			runtime: m.runtime,
			namespace: "work-tickets",
			handlers: [
				{ id: "H", label: "H", actorId: "H" },
				{ id: "J", label: "J", actorId: "J" },
			],
			dispatcher,
		});
		const manager = service.connect({ id: "manager", role: () => "manager", check() {} });
		const H = service.connect({ id: "H", role: () => "handler", check() {} });
		const ticket = await manager.submit({
			requestId: "ticket",
			title: "Parse",
			body: "ORIGINAL-PARSE-DATA",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "H-assigned",
			id: ticket.id,
			expectedVersion: 1,
			handlerId: "H",
		});
		const dispatched = await manager.dispatch({
			requestId: "original-dispatch",
			id: ticket.id,
			expectedVersion: assigned.version,
		});
		await entered.promise;
		assert.ok(dispatched.runId);
		const work = await H.getWork({ id: ticket.id, workId: dispatched.runId });
		assert.equal(work.work.actorId, "H");
		assert.equal(work.work.runId, dispatched.runId);
		assert.deepEqual(work.work.conversation, Href);
		assert.equal(work.content.body, "ORIGINAL-PARSE-DATA");
		assert.equal(
			text(m.f.requests[0]!).includes('"workId":"' + dispatched.runId + '"'),
			true,
			"the worker must receive the service-issued original work identity",
		);
		const before = (await manager.get(ticket.id)).ticket;
		await manager.assign({
			requestId: "J-assigned",
			id: ticket.id,
			expectedVersion: before.version,
			handlerId: "J",
		});
		const report = await H.report({
			requestId: "H-finished",
			id: ticket.id,
			workId: dispatched.runId,
			text: "Original parser result after reassignment",
			links: [],
		});
		assert.equal((await H.readReport({ id: ticket.id, reportId: report.reportId })).runId, dispatched.runId);
		await manager.dispatch({
			requestId: "original-dispatch",
			id: ticket.id,
			expectedVersion: assigned.version,
		});
		release.resolve();
		await m.runtime.waitForIdle();
		await manager.refresh({ id: ticket.id, runId: dispatched.runId });
		assert.equal((await manager.get(ticket.id)).ticket.handler!.actorId, "J");
		assert.equal(m.f.requests.length, 1);
	} finally {
		release.resolve();
		await m.close();
	}
});
