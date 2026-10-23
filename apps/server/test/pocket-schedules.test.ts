import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketSchedules } from "../src/pocket-schedules.ts";

const namespace = "scheduled-input-test";
async function fixture() {
	const prepared = createPocketSchedules({ namespace, maxSchedules: 16 });
	const m = await runtimeFixture({ jobs: [prepared.definition] });
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "pocket.people" });
		const owner = await people.initializeOwner("Owner");
		const actor = await people.authenticate(owner.token);
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog: { namespace: "pocket.workspace", maxDeliveries: 32, maxPending: 8 },
			profileCeiling: () => ["default"],
		});
		const ref = await workspace
			.bind(actor)
			.create({ requestId: "project", name: "Project", profile: "default" });
		const schedules = await prepared.attach({ runtime: m.runtime, people, workspace });
		return { m, people, owner, actor, workspace, ref, schedules };
	} catch (error) {
		await m.close();
		throw error;
	}
}

// Removing the native due-time wait or using a different admission identity would produce early/duplicate HTTP.
test(
	"WebUI schedules: a real due native job sends once and request reconciliation never re-enters work",
	{ timeout: 10000 },
	async (t) => {
		const f = await fixture();
		try {
			const client = f.schedules.bind(f.actor);
			const input = { requestId: "once", dueAt: Date.now() + 500, text: "NATIVE-SCHEDULED-WORK" };
			const row = await client.add(f.ref, input);
			assert.ok(row.jobId);
			assert.equal(f.m.f.requests.length, 0, "admission is not immediate delivery");
			await t.waitFor(async () => assert.equal((await client.list(f.ref))[0]!.state, "done"), {
				timeout: 4000,
			});
			await t.waitFor(() => assert.equal(f.m.f.requests.length, 1), { timeout: 3000 });
			assert.ok(JSON.stringify(f.m.f.requests[0]).includes("NATIVE-SCHEDULED-WORK"));
			const again = await client.add(f.ref, input);
			assert.equal(again.id, row.id);
			assert.equal(again.jobId, row.jobId);
			assert.equal(f.m.f.requests.length, 1);
			await assert.rejects(client.add(f.ref, { ...input, text: "CHANGED" }), /conflict/i);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 1);
		} finally {
			await f.m.close();
		}
	},
);

// Cancelling the actual queued job must fence admission; UI disappearance alone is not cancellation evidence.
test(
	"WebUI schedules: explicit cancel leaves a native terminal receipt and zero provider effects",
	{ timeout: 10000 },
	async (t) => {
		const f = await fixture();
		try {
			const client = f.schedules.bind(f.actor);
			const row = await client.add(f.ref, {
				requestId: "cancel",
				dueAt: Date.now() + 60000,
				text: "NEVER-ADMITTED",
			});
			await t.waitFor(
				async () => {
					const native = await f.m.runtime
						.jobs({ namespace: namespace + ".jobs", maxJobs: 16, maxBytes: 1048576 })
						.receipt(row.jobId!, () => {});
					assert.equal(native.state, "queued");
					assert.equal(native.checkpoint.waits, 1);
				},
				{ timeout: 2000 },
			);
			await client.cancel(f.ref, row.id);
			await t.waitFor(
				async () => {
					const actual = (await client.list(f.ref))[0]!;
					assert.equal(actual.state, "cancelled");
					assert.equal(actual.nativeTerminal, "aborted");
				},
				{ timeout: 3000 },
			);
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 0);
		} finally {
			await f.m.close();
		}
	},
);

// Restoring just a browser timer or rerunning a waiting handler without its committed checkpoint would lose/duplicate work.
test(
	"WebUI schedules recovery: a future checkpoint survives a normal writer reopen and keeps the original job and budget",
	{ timeout: 12000 },
	async (t) => {
		const f = await fixture();
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const input = { requestId: "reopen", dueAt: Date.now() + 1200, text: "SCHEDULED-AFTER-REOPEN" };
			const row = await f.schedules.bind(f.actor).add(f.ref, input);
			await t.waitFor(
				async () => {
					const actual = await f.m.runtime
						.jobs({ namespace: namespace + ".jobs", maxJobs: 16, maxBytes: 1048576 })
						.receipt(row.jobId!, () => {});
					assert.equal(actual.state, "queued");
					assert.equal(actual.checkpoint.completed, 0);
					assert.equal(actual.checkpoint.nextDueAt, input.dueAt);
					assert.equal(actual.checkpoint.waits, 1);
				},
				{ timeout: 2000 },
			);
			const file = f.m.runtime.view().sessionFile;
			await f.m.runtime.close();
			const prepared = createPocketSchedules({ namespace, maxSchedules: 16 });
			reopened = await createRuntime({ ...f.m.config, reopenSessionFile: file, jobs: [prepared.definition] });
			const people = await createPocketPeople({ runtime: reopened, namespace: "pocket.people" });
			const actor = await people.authenticate(f.owner.token);
			const workspace = createPocketWorkspace({
				runtime: reopened,
				people,
				catalog: { namespace: "pocket.workspace", maxDeliveries: 32, maxPending: 8 },
				profileCeiling: () => ["default"],
			});
			const schedules = await prepared.attach({ runtime: reopened, people, workspace });
			assert.equal(f.m.f.requests.length, 0);
			await t.waitFor(async () => assert.equal((await schedules.bind(actor).list(f.ref))[0]!.state, "done"), {
				timeout: 4000,
			});
			await t.waitFor(() => assert.equal(f.m.f.requests.length, 1), { timeout: 3000 });
			const actual = await schedules.bind(actor).add(f.ref, input);
			assert.equal(actual.id, row.id);
			assert.equal(actual.jobId, row.jobId);
			assert.equal(reopened.view().budget.primaryAttempts, 1);
		} finally {
			await reopened?.close();
			await f.m.close();
		}
	},
);
