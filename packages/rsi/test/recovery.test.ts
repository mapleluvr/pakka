import { test } from "node:test";
import { strict as assert } from "node:assert";
import { dirname } from "node:path";
import { createRuntime, openStorageMaintenance, type Runtime } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMas } from "../../mas/src/index.ts";
import { createTicketService } from "../src/index.ts";
import { createMasTicketDispatcher } from "../src/mas.ts";

const actor = { id: "owner", role: () => "manager" as const, check() {} };
const handlers = [{ id: "worker", label: "Worker", actorId: "worker" }];
async function dispatcher(runtime: Runtime, initial = false) {
	const mas = await createMas({ runtime, namespace: "dispatch-recovery", maxPending: 4 });
	if (initial) {
		await mas.bootstrap([{ key: "worker", owner: "operator" }]);
		await mas.activate();
	}
	const target = (await mas.view()).members[0]!.ref;
	const client = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
	return createMasTicketDispatcher({ routes: [{ handlerId: "worker", target, client }] });
}
for (const boundary of ["before-checkpoint", "after-checkpoint"] as const)
	test(`dispatch ${boundary}: real reopen is passive and explicit recovery preserves send uncertainty`, async () => {
		const m = await runtimeFixture();
		let reopened: Runtime | undefined;
		try {
			let fail = true;
			const runtime = {
				...m.runtime,
				records: (options: Parameters<Runtime["records"]>[0]) => {
					const records = m.runtime.records(options);
					return {
						...records,
						commit: async (...args: Parameters<typeof records.commit>) => {
							if (fail && args[0].writes.some((row) => row.data.stage === "dispatching")) {
								fail = false;
								if (boundary === "after-checkpoint") await records.commit(...args);
								throw Error("process interrupted at dispatch boundary");
							}
							return records.commit(...args);
						},
					};
				},
			};
			const client = (
				await createTicketService({
					runtime,
					namespace: "tickets",
					handlers,
					dispatcher: await dispatcher(runtime, true),
				})
			).connect(actor);
			const created = await client.submit({
				requestId: "submit",
				title: "Original",
				body: "FIXED-REVISION",
				sources: [],
			});
			const assigned = await client.assign({
				requestId: "assign",
				id: created.id,
				expectedVersion: 1,
				handlerId: "worker",
			});
			await assert.rejects(
				client.dispatch({ requestId: "dispatch", id: created.id, expectedVersion: assigned.version }),
			);
			assert.equal(m.f.requests.length, 0);
			const file = m.runtime.view().sessionFile;
			await m.runtime.close();
			const maintenance = await openStorageMaintenance({ storageDir: dirname(file), stores: [] });
			try {
				const work = await maintenance.work();
				assert.equal(work.pendingRecords, 1);
				assert.ok(work.sample.some((row) => row.kind === "record"));
			} finally {
				await maintenance.close();
			}
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			const after = (
				await createTicketService({
					runtime: reopened,
					namespace: "tickets",
					handlers,
					dispatcher: await dispatcher(reopened),
				})
			).connect(actor);
			let view = await after.get(created.id);
			const run = view.ticket.runs[0]!;
			assert.equal(run.stage, boundary === "before-checkpoint" ? "planned" : "dispatching");
			assert.equal((await after.lookup("dispatch"))?.runId, run.id);
			await after.list();
			await after.refresh({ id: created.id, runId: run.id });
			assert.equal(m.f.requests.length, 0, "reopen, query and refresh never send");
			view = await after.get(created.id);
			const input = {
				requestId: "recover",
				id: created.id,
				runId: run.id,
				expectedVersion: view.ticket.version,
			};
			const receipt = await after.recover(input);
			await reopened.waitForIdle();
			assert.deepEqual(await after.recover(input), receipt);
			view = await after.refresh({ id: created.id, runId: run.id });
			assert.equal(m.f.requests.length, boundary === "before-checkpoint" ? 1 : 0);
			assert.equal(view.ticket.runs[0]!.state, boundary === "before-checkpoint" ? "done" : "unknown");
			assert.equal(view.ticket.state, "active");
		} finally {
			await reopened?.close();
			await m.close();
		}
	});

test("run observation rejects a run belonging to another readable ticket", async () => {
	const m = await runtimeFixture();
	try {
		const client = (
			await createTicketService({
				runtime: m.runtime,
				namespace: "tickets",
				handlers,
				dispatcher: await dispatcher(m.runtime, true),
			})
		).connect(actor);
		const a = await client.submit({ requestId: "a", title: "A", body: "body", sources: [] });
		const b = await client.submit({ requestId: "b", title: "B", body: "body", sources: [] });
		const assigned = await client.assign({
			requestId: "assign",
			id: a.id,
			expectedVersion: 1,
			handlerId: "worker",
		});
		const receipt = await client.dispatch({
			requestId: "dispatch",
			id: a.id,
			expectedVersion: assigned.version,
		});
		await m.runtime.waitForIdle();
		await assert.rejects(client.refresh({ id: b.id, runId: receipt.runId! }), /Run not found/);
		assert.equal((await client.get(b.id)).ticket.version, 1);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await m.close();
	}
});
