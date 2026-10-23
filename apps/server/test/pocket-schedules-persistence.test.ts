import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { Runtime, RuntimeStore } from "@pakka/agent";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketSchedules } from "../src/pocket-schedules.ts";

async function fixture(wrap: (runtime: Runtime) => Runtime) {
	const prepared = createPocketSchedules({ namespace: "schedule.persistence", maxSchedules: 8 });
	const m = await runtimeFixture({ jobs: [prepared.definition] });
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "schedule.people" }),
			session = await people.initializeOwner("Owner"),
			actor = await people.authenticate(session.token);
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog: { namespace: "schedule.workspace", maxDeliveries: 16, maxPending: 4 },
			profileCeiling: () => ["default"],
		});
		const target = await workspace
			.bind(actor)
			.create({ requestId: "project", name: "Project", profile: "default" });
		const schedules = await prepared.attach({ runtime: wrap(m.runtime), people, workspace });
		const jobs = m.runtime.jobs({ namespace: "schedule.persistence.jobs", maxJobs: 8, maxBytes: 1048576 });
		return { m, people, actor, target, schedules, jobs };
	} catch (error) {
		await m.close();
		throw error;
	}
}

// The native storage commit is real. Pausing its acknowledgement exposes stale in-memory cancellation state.
test(
	"WebUI schedule cancel boundary: a committed cancel intent fences due effects even while the CAS acknowledgement is held",
	{ timeout: 8000 },
	async (t) => {
		const entered = deferred(),
			release = deferred();
		let held = false;
		const f = await fixture((runtime) =>
			Object.freeze({
				...runtime,
				store: (options: Parameters<Runtime["store"]>[0]) => {
					const store = runtime.store(options);
					if (options.namespace !== "schedule.persistence") return store;
					const compareAndSet: RuntimeStore["compareAndSet"] = async (...args) => {
						const result = await store.compareAndSet(...args);
						const rows = args[1].rows;
						if (
							!held &&
							Array.isArray(rows) &&
							rows.some(
								(row) => row && typeof row === "object" && !Array.isArray(row) && row.cancelled === true,
							)
						) {
							held = true;
							entered.resolve();
							await release.promise;
						}
						return result;
					};
					return Object.freeze({ ...store, compareAndSet });
				},
			}),
		);
		let cancelling: Promise<unknown> | undefined;
		try {
			const row = await f.schedules.bind(f.actor).add(f.target, {
				requestId: "held-cancel",
				dueAt: Date.now() + 400,
				text: "NEVER-AFTER-CANCEL-INTENT",
			});
			await t.waitFor(
				async () => assert.equal((await f.jobs.receipt(row.jobId!, () => {})).checkpoint.waits, 1),
				{ timeout: 2000 },
			);
			cancelling = f.schedules.bind(f.actor).cancel(f.target, row.id);
			await entered.promise;
			const native = await f.jobs.wait(row.jobId!, () => {});
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 0, "native effect is fenced before acknowledgement is released");
			assert.equal(native.state, "unknown");
			release.resolve();
			await cancelling;
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 0);
		} finally {
			release.resolve();
			await cancelling?.catch(() => {});
			await f.m.close();
		}
	},
);

test(
	"WebUI schedule intent uncertainty: loss after the real intent commit never starts work on the original request retry",
	{ timeout: 8000 },
	async () => {
		let writes = 0;
		const f = await fixture((runtime) =>
			Object.freeze({
				...runtime,
				store: (options: Parameters<Runtime["store"]>[0]) => {
					const store = runtime.store(options);
					if (options.namespace !== "schedule.persistence") return store;
					const compareAndSet: RuntimeStore["compareAndSet"] = async (...args) => {
						await store.compareAndSet(...args);
						writes++;
						throw Error("TEST LOST COMMITTED INTENT ACKNOWLEDGEMENT");
					};
					return Object.freeze({ ...store, compareAndSet });
				},
			}),
		);
		try {
			const input = { requestId: "unconfirmed-intent", dueAt: Date.now() + 60000, text: "NO-INTENT-REPLAY" },
				client = f.schedules.bind(f.actor);
			await assert.rejects(client.add(f.target, input), /LOST COMMITTED/);
			const result = await client.add(f.target, input);
			assert.equal(result.state, "unknown");
			assert.equal(result.jobId, null);
			assert.equal(writes, 1);
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 0);
		} finally {
			await f.m.close();
		}
	},
);
