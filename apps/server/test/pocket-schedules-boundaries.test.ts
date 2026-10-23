import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import {
	createPocketWorkspace,
	type PocketWorkspace,
	type PocketInputReceipt,
} from "../src/pocket-workspace.ts";
import { createPocketCollaboration } from "../src/pocket-collaboration.ts";
import { createPocketSchedules } from "../src/pocket-schedules.ts";

test(
	"WebUI schedules: the declared bounded text limit reaches the actual provider unchanged",
	{ timeout: 8000 },
	async () => {
		const f = await fixture();
		try {
			const client = f.schedules.bind(f.owner);
			await assert.rejects(
				client.add(f.target, { requestId: "oversized", dueAt: Date.now() + 100, text: "x".repeat(8193) }),
				/bounded/i,
			);
			const text = "EXACT-SCHEDULE-TEXT-LIMIT:".padEnd(8192, "x");
			const row = await client.add(f.target, { requestId: "limit", dueAt: Date.now() + 100, text });
			assert.equal((await f.jobs.wait(row.jobId!, () => {})).state, "done");
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.ok(JSON.stringify(f.m.f.requests[0]).includes(text));
		} finally {
			await f.m.close();
		}
	},
);

async function fixture(wrap: (workspace: PocketWorkspace) => PocketWorkspace = (workspace) => workspace) {
	const prepared = createPocketSchedules({ namespace: "schedules.boundaries", maxSchedules: 8 });
	const m = await runtimeFixture({ jobs: [prepared.definition] });
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "scheduled.people" });
		const session = await people.initializeOwner("Owner"),
			owner = await people.authenticate(session.token);
		const collaboration = await createPocketCollaboration({
			runtime: m.runtime,
			people,
			namespace: "scheduled.collaboration",
		});
		const workspace = wrap(
			createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog: { namespace: "scheduled.workspace", maxDeliveries: 16, maxPending: 4 },
				profileCeiling: () => ["default"],
				beforeInput: (actor, ref) => collaboration.checkInput(actor, ref),
				beforeScheduledInput: (actorId, ref) => collaboration.checkScheduledInput(actorId, ref),
			}),
		);
		const target = await workspace
			.bind(owner)
			.create({ requestId: "project", name: "Project", profile: "default" });
		const hidden = await workspace
			.bind(owner)
			.create({ requestId: "hidden", name: "Private", profile: "default" });
		const invitation = await people.invite(owner, {
			requestId: "driver",
			role: "driver",
			resources: [target.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const driverSession = await people.redeem(invitation.token, "Driver"),
			driver = await people.authenticate(driverSession.token);
		const schedules = await prepared.attach({ runtime: m.runtime, people, workspace });
		const jobs = m.runtime.jobs({ namespace: "schedules.boundaries.jobs", maxJobs: 8, maxBytes: 1048576 });
		return { m, people, owner, driverSession, driver, target, hidden, schedules, collaboration, jobs };
	} catch (error) {
		await m.close();
		throw error;
	}
}

test(
	"WebUI schedule authority: resource scopes and viewers cannot register native work or claim a different incarnation",
	{ timeout: 8000 },
	async () => {
		const f = await fixture();
		try {
			const input = { requestId: "no-effect", dueAt: Date.now() + 60000, text: "NO-EFFECT" };
			await assert.rejects(f.schedules.bind(f.driver).add(f.hidden, input), /denied|authority/i);
			await assert.rejects(
				f.schedules.bind(f.driver).list({ ...f.target, incarnation: "forged" }),
				/denied/i,
			);
			await f.people.setPerson(f.owner, f.driverSession.person.id, {
				role: "viewer",
				resources: [f.target.conversationId],
			});
			const session = await f.people.invite(f.owner, {
				requestId: "viewer-session",
				personId: f.driverSession.person.id,
				role: "viewer",
				resources: [f.target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(session.token);
			const current = await f.people.redeem(session.token, "Driver"),
				viewer = await f.people.authenticate(current.token);
			await assert.rejects(f.schedules.bind(viewer).add(f.target, input), /denied|authority/i);
			assert.deepEqual(await f.schedules.bind(viewer).list(f.target), []);
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 0);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"WebUI schedule authority: current driver handover fences a previously committed due input",
	{ timeout: 8000 },
	async (t) => {
		const f = await fixture();
		try {
			const row = await f.schedules
				.bind(f.owner)
				.add(f.target, { requestId: "handover", dueAt: Date.now() + 500, text: "NO-LATE-DRIVER-EFFECT" });
			await t.waitFor(
				async () => assert.equal((await f.jobs.receipt(row.jobId!, () => {})).checkpoint.waits, 1),
				{ timeout: 2000 },
			);
			await f.collaboration
				.bind(f.driver)
				.setDriver(f.target, { action: "claim", expectedVersion: 0, ttlMs: 60000 });
			const result = await f.jobs.wait(row.jobId!, () => {});
			assert.equal(result.state, "unknown");
			assert.equal(result.nativeTerminal, "completed");
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 0);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"WebUI schedule authority: a revoked creator cannot release the next scheduled native input",
	{ timeout: 8000 },
	async (t) => {
		const f = await fixture();
		try {
			const row = await f.schedules
				.bind(f.driver)
				.add(f.target, { requestId: "revocation", dueAt: Date.now() + 500, text: "NO-REVOKED-EFFECT" });
			await t.waitFor(
				async () => assert.equal((await f.jobs.receipt(row.jobId!, () => {})).checkpoint.waits, 1),
				{ timeout: 2000 },
			);
			await f.people.revokePerson(f.owner, f.driverSession.person.id);
			assert.equal((await f.jobs.wait(row.jobId!, () => {})).state, "unknown");
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 0);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"WebUI schedule uncertainty: losing a real native admission result cannot re-enter it on retry or receipt reads",
	{ timeout: 8000 },
	async (t) => {
		let admissions = 0;
		const f = await fixture((workspace) =>
			Object.freeze({
				...workspace,
				submitScheduled: async (...args: Parameters<PocketWorkspace["submitScheduled"]>) => {
					await workspace.submitScheduled(...args);
					admissions++;
					throw Error("TEST LOST REAL NATIVE ADMISSION RESULT");
				},
			}),
		);
		try {
			const client = f.schedules.bind(f.owner),
				input = { requestId: "lost-admission", dueAt: Date.now() + 200, text: "ONCE-AFTER-UNKNOWN" };
			const row = await client.add(f.target, input);
			const outcome = await f.jobs.wait(row.jobId!, () => {});
			assert.equal(outcome.state, "unknown");
			await t.waitFor(() => assert.equal(f.m.f.requests.length, 1), { timeout: 2000 });
			assert.equal((await client.add(f.target, input)).jobId, row.jobId);
			assert.equal((await client.list(f.target))[0]!.state, "unknown");
			assert.equal(admissions, 1);
			assert.equal(f.m.f.requests.length, 1);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 1);
		} finally {
			await f.m.close();
		}
	},
);

// Lose the confirmation view only after a real native admission; the actual provider effect is counted independently.
for (const maxRuns of [1, 2]) {
	test(
		`WebUI schedule uncertainty: an unknown native receipt stops ${maxRuns}-run scheduled work`,
		{ timeout: 8000 },
		async () => {
			const f = await fixture((workspace) =>
				Object.freeze({
					...workspace,
					submitScheduled: async (
						...args: Parameters<PocketWorkspace["submitScheduled"]>
					): Promise<PocketInputReceipt> => {
						const admitted = await workspace.submitScheduled(...args);
						return Object.freeze({ ...admitted, status: "unknown" });
					},
				}),
			);
			try {
				const client = f.schedules.bind(f.owner),
					input = {
						requestId: "unknown-admission",
						dueAt: Date.now() + 100,
						text: "REAL-EFFECT-WITH-UNKNOWN-ADMISSION",
						...(maxRuns > 1 ? { intervalMs: 1000, maxRuns } : {}),
					};
				const row = await client.add(f.target, input);
				const result = await f.jobs.wait(row.jobId!, () => {});
				await f.m.runtime.waitForIdle();
				assert.equal(f.m.f.requests.length, 1);
				assert.ok(JSON.stringify(f.m.f.requests[0]).includes(input.text));
				assert.equal(f.m.runtime.view().budget.primaryAttempts, 1);
				assert.equal(result.state, "unknown");
				assert.equal((await client.add(f.target, input)).state, "unknown");
				assert.equal((await client.list(f.target))[0]!.state, "unknown");
				assert.equal(f.m.f.requests.length, 1, "result reads never admit the input again");
			} finally {
				await f.m.close();
			}
		},
	);
}

test(
	"WebUI schedules: a finite recurring job uses separate native delivery identities and does not reset its consumed quota",
	{ timeout: 8000 },
	async (t) => {
		const f = await fixture();
		try {
			const input = {
				requestId: "recurring",
				dueAt: Date.now() + 200,
				text: "BOUNDED-RECURRING-INPUT",
				intervalMs: 1000,
				maxRuns: 2,
			};
			const client = f.schedules.bind(f.owner),
				row = await client.add(f.target, input);
			const native = await f.jobs.wait(row.jobId!, () => {});
			assert.equal(native.state, "done");
			assert.equal(native.result?.completed, 2);
			await t.waitFor(() => assert.equal(f.m.f.requests.length, 2), { timeout: 2000 });
			assert.equal((await client.list(f.target))[0]!.completed, 2);
			assert.equal((await client.add(f.target, input)).jobId, row.jobId);
			assert.equal(f.m.f.requests.length, 2);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 2);
		} finally {
			await f.m.close();
		}
	},
);
