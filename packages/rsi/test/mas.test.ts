import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { deferred, text } from "../../agent/test/fixture.ts";
import { createMas } from "../../mas/src/index.ts";
import { createTicketService } from "../src/index.ts";

async function dispatcherFactory(): Promise<typeof import("../src/mas.ts").createMasTicketDispatcher> {
	const module = await import(new URL("../src/mas.ts", import.meta.url).href).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
			return {};
		},
	);
	assert.equal(typeof module.createMasTicketDispatcher, "function", "MAS ticket adapter is missing");
	return module.createMasTicketDispatcher;
}
const actor = (id: string, role: "submitter" | "handler" | "manager") => ({
	id,
	role: () => role,
	check() {},
});

test("MAS tickets: explicit dispatch captures a revision; native completion remains separate from ticket closure", async () => {
	const create = await dispatcherFactory(),
		entered = deferred(),
		release = deferred();
	const m = await runtimeFixture({}, undefined, async () => {
		entered.resolve();
		await release.promise;
		return { text: "Investigation complete" };
	});
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "ticket-mas",
			maxDeliveries: 16,
			maxPending: 4,
		});
		await mas.bootstrap([{ key: "worker", owner: "operator" }]);
		await mas.activate();
		const target = (await mas.view()).members[0]!.ref;
		const sender = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
		const dispatcher = create({ routes: [{ handlerId: "research", target, client: sender }] });
		const service = await createTicketService({
			runtime: m.runtime,
			namespace: "tickets",
			handlers: [{ id: "research", label: "Research", actorId: "worker" }],
			dispatcher,
		});
		const author = service.connect(actor("im", "submitter")),
			manager = service.connect(actor("owner", "manager"));
		const created = await author.submit({
			requestId: "create",
			title: "Shared workspace",
			body: "ORIGINAL-WORKLOAD",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "assign",
			id: created.id,
			expectedVersion: 1,
			handlerId: "research",
		});
		assert.equal(m.f.requests.length, 0);
		const run = await manager.dispatch({
			requestId: "dispatch",
			id: created.id,
			expectedVersion: assigned.version,
		});
		await entered.promise;
		assert.ok(run.runId);
		assert.equal((await manager.get(created.id)).ticket.runs[0].contentRevision, 1);
		assert.equal((await manager.get(created.id)).ticket.state, "active");
		assert.deepEqual(
			await manager.dispatch({ requestId: "dispatch", id: created.id, expectedVersion: assigned.version }),
			run,
		);
		const current = await author.get(created.id);
		await author.edit({
			requestId: "edit",
			id: created.id,
			expectedVersion: current.ticket.version,
			title: "Updated workload",
			body: "LATER-WORKLOAD",
			sources: [],
		});
		assert.equal(text(m.f.requests[0]!).includes("ORIGINAL-WORKLOAD"), true);
		assert.equal(text(m.f.requests[0]!).includes("LATER-WORKLOAD"), false);
		release.resolve();
		await m.runtime.waitForIdle();
		await manager.refresh({ id: created.id, runId: run.runId });
		const view = await manager.get(created.id);
		assert.equal(view.ticket.runs[0].state, "done");
		assert.equal(view.ticket.state, "active");
		assert.equal(view.ticket.contentRevision, 2);
		assert.equal(m.f.requests.length, 1);
		const worker = service.connect(actor("worker", "handler"));
		const reported = await worker.report({
			requestId: "complete",
			id: created.id,
			workId: run.runId!,
			text: "Measured result",
			links: ["https://example.org/result"],
		});
		assert.equal(
			(await worker.readReport({ id: created.id, reportId: reported.reportId })).contentRevision,
			1,
		);
		assert.equal((await author.get(created.id)).ticket.state, "active");
		await worker.setState({
			requestId: "close",
			id: created.id,
			expectedVersion: view.ticket.version,
			state: "closed",
			text: "Current handler accepts the result",
			links: [],
		});
		assert.equal((await author.get(created.id)).ticket.state, "closed");
	} finally {
		release.resolve();
		await m.close();
	}
});

test("MAS tickets: a delayed earlier native observation cannot replace a confirmed terminal delivery", async () => {
	const create = await dispatcherFactory(),
		generating = deferred(),
		finish = deferred(),
		observed = deferred(),
		releaseObservation = deferred();
	const m = await runtimeFixture({}, undefined, async () => {
		generating.resolve();
		await finish.promise;
		return { text: "Done" };
	});
	let stale: Promise<unknown> | undefined;
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "ticket-mas",
			maxDeliveries: 16,
			maxPending: 4,
		});
		await mas.bootstrap([{ key: "worker", owner: "operator" }]);
		await mas.activate();
		const target = (await mas.view()).members[0]!.ref;
		const sender = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
		const original = create({ routes: [{ handlerId: "research", target, client: sender }] });
		let first = true;
		const dispatcher = {
			...original,
			observe: async (...args: Parameters<typeof original.observe>) => {
				const result = await original.observe(...args);
				if (first) {
					first = false;
					observed.resolve();
					await releaseObservation.promise;
				}
				return result;
			},
		};
		const manager = (
			await createTicketService({
				runtime: m.runtime,
				namespace: "tickets",
				handlers: [{ id: "research", label: "Research", actorId: "worker" }],
				dispatcher,
			})
		).connect(actor("owner", "manager"));
		const created = await manager.submit({
			requestId: "create",
			title: "Observe",
			body: "Actual delayed result",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "assign",
			id: created.id,
			expectedVersion: created.version,
			handlerId: "research",
		});
		const sent = await manager.dispatch({
			requestId: "dispatch",
			id: created.id,
			expectedVersion: assigned.version,
		});
		await generating.promise;
		const query = { id: created.id, runId: sent.runId! };
		stale = manager.refresh(query);
		await observed.promise;
		finish.resolve();
		await m.runtime.waitForIdle();
		assert.equal((await manager.refresh(query)).ticket.runs[0]!.state, "done");
		releaseObservation.resolve();
		await stale;
		assert.equal((await manager.get(created.id)).ticket.runs[0]!.state, "done");
		assert.equal(m.f.requests.length, 1);
	} finally {
		finish.resolve();
		releaseObservation.resolve();
		await stale?.catch(() => {});
		await m.close();
	}
});

test("MAS tickets: lost send result retains unknown run and repeated dispatch never redelivers", async () => {
	const create = await dispatcherFactory(),
		m = await runtimeFixture();
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "ticket-mas",
			maxDeliveries: 16,
			maxPending: 4,
		});
		await mas.bootstrap([{ key: "worker", owner: "operator" }]);
		await mas.activate();
		const target = (await mas.view()).members[0]!.ref;
		const sender = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
		const original = create({ routes: [{ handlerId: "research", target, client: sender }] });
		const dispatcher = {
			...original,
			send: async (...args: Parameters<typeof original.send>) => {
				await original.send(...args);
				throw Error("lost reply after native admission");
			},
		};
		const service = await createTicketService({
			runtime: m.runtime,
			namespace: "tickets",
			handlers: [{ id: "research", label: "Research", actorId: "worker" }],
			dispatcher,
		});
		const manager = service.connect(actor("owner", "manager"));
		const created = await manager.submit({
			requestId: "create",
			title: "Check",
			body: "ACTUAL-DELIVERY",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "assign",
			id: created.id,
			expectedVersion: 1,
			handlerId: "research",
		});
		const sent = await manager.dispatch({
			requestId: "dispatch",
			id: created.id,
			expectedVersion: assigned.version,
		});
		await m.runtime.waitForIdle();
		const view = await manager.get(created.id);
		assert.equal(view.ticket.runs[0].state, "unknown");
		assert.equal(view.ticket.runs[0].receiptId, null);
		await manager.dispatch({ requestId: "dispatch", id: created.id, expectedVersion: assigned.version });
		await assert.rejects(
			manager.dispatch({ requestId: "replacement", id: created.id, expectedVersion: view.ticket.version }),
		);
		const recovered = await manager.refresh({ id: created.id, runId: sent.runId! });
		assert.equal(recovered.ticket.runs[0].state, "done");
		assert.ok(recovered.ticket.runs[0].receiptId);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await m.close();
	}
});
