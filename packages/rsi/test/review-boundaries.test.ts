import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { deferred } from "../../agent/test/fixture.ts";
import { createTicketService } from "../src/index.ts";
import { createMas } from "../../mas/src/index.ts";
import { createMasTicketDispatcher } from "../src/mas.ts";
import type { TicketDispatcher, TicketRole } from "../src/types.ts";
const actor = { id: "owner", role: () => "manager" as const, check() {} };
const handlers = [{ id: "worker", label: "Worker", actorId: "worker" }];
async function bounded<T>(work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(Error("Race checkpoint not reached")), 5000);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

test("A-5: accepted escaped event must remain readable", async () => {
	const m = await runtimeFixture();
	try {
		const a = (await createTicketService({ runtime: m.runtime, namespace: "review-byte" })).connect(actor);
		const t = await a.submit({ requestId: "new", title: "Byte test", body: "Body", sources: [] });
		const u = "\ud800";
		const report = {
			requestId: "report",
			id: t.id,
			expectedVersion: 1,
			state: "active" as const,
			text: u.repeat(12000),
			links: Array(8).fill(u.repeat(2048)),
			results: Array.from({ length: 8 }, () => ({ uri: u.repeat(1024) })),
		};
		await assert.rejects(a.report(report), { code: "capacity" });
		assert.equal(await a.lookup("report"), null);
		assert.equal((await a.get(t.id)).ticket.version, 1);
		const accepted = { ...report, requestId: "bounded", links: [], results: [] };
		await a.report(accepted);
		const view = await a.get(t.id);
		const page = await a.history({ id: t.id, kind: "events" });
		assert.ok(Buffer.byteLength(JSON.stringify(view)) < 256 * 1024);
		assert.ok(Buffer.byteLength(JSON.stringify(page)) < 192 * 1024);
		if (page.kind === "events") assert.equal(page.items.at(-1)?.text, accepted.text);
	} finally {
		await m.close();
	}
});

test("RSI final mutation publication preserves committed receipts as unknown after outer-boundary revocation", async () => {
	const m = await runtimeFixture();
	let revoked = false,
		armed = false,
		delay = 0;
	try {
		const runtime = {
			...m.runtime,
			records(options: Parameters<typeof m.runtime.records>[0]) {
				const native = m.runtime.records(options);
				return {
					...native,
					async commit(...args: Parameters<typeof native.commit>) {
						const result = await native.commit(...args);
						if (armed) {
							const tick = (remaining: number) => {
								if (!remaining) revoked = true;
								else queueMicrotask(() => tick(remaining - 1));
							};
							tick(delay);
						}
						return result;
					},
				};
			},
		};
		const client = (await createTicketService({ runtime, namespace: "publication-rsi" })).connect({
			id: "owner",
			role: () => "manager",
			check() {
				if (revoked) throw Error("Revoked");
			},
		});
		const first = await client.submit({ requestId: "create", title: "Initial", body: "Body", sources: [] });
		for (const timing of [
			{ requestId: "inner", delay: 0, version: 1 },
			{ requestId: "outer", delay: 2, version: 2 },
		]) {
			armed = true;
			delay = timing.delay;
			const result = await client
				.edit({
					requestId: timing.requestId,
					id: first.id,
					expectedVersion: timing.version,
					title: "Committed",
					body: "Body",
					sources: [],
				})
				.then(
					() => "ok",
					(error) => error.code,
				);
			assert.equal(revoked, true);
			armed = false;
			revoked = false;
			const receipt = await client.lookup(timing.requestId);
			assert.equal(receipt?.version, timing.version + 1);
			assert.equal((await client.get(first.id)).ticket.version, timing.version + 1);
			assert.equal(m.runtime.view().phase, "ready");
			assert.equal(result, "unknown", timing.requestId);
		}
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// Omitting concrete receipt read authority leaks foreign results after a legal-role downgrade.
test("RSI receipt publication checks the ticket read right, not the former execution role", async () => {
	const m = await runtimeFixture();
	let role: TicketRole = "manager",
		armed = false;
	try {
		const runtime = {
			...m.runtime,
			records(options: Parameters<typeof m.runtime.records>[0]) {
				const native = m.runtime.records(options);
				return {
					...native,
					async commit(...args: Parameters<typeof native.commit>) {
						const result = await native.commit(...args);
						if (armed) {
							const tick = (remaining: number) => {
								if (!remaining) role = "reader";
								else queueMicrotask(() => tick(remaining - 1));
							};
							tick(2); // Original fixed outer-publication oracle; not adapted to check counts.
						}
						return result;
					},
				};
			},
		};
		const service = await createTicketService({ runtime, namespace: "receipt-object-authority" });
		const manager = service.connect({ id: "operator", role: () => role, check() {} });
		const author = service.connect({ id: "alice", role: () => "submitter", check() {} });
		const foreign = await author.submit({
			requestId: "foreign",
			title: "Foreign",
			body: "Body",
			sources: [],
		});
		const own = await manager.submit({ requestId: "own", title: "Own", body: "Body", sources: [] });
		const outcomes = [];
		for (const row of [foreign, own]) {
			const input = {
				requestId: "edit-" + row.requestId,
				id: row.id,
				expectedVersion: 1,
				title: "Committed",
				body: "Body",
				sources: [],
			};
			armed = true;
			outcomes.push(
				await manager.edit(input).then(
					() => "ok",
					(error) => error.code,
				),
			);
			armed = false;
			assert.equal(role, "reader");
			if (row.id === foreign.id) await assert.rejects(manager.lookup(input.requestId), { code: "denied" });
			else assert.equal((await manager.lookup(input.requestId))?.version, 2);
			role = "manager";
			const receipt = await manager.lookup(input.requestId);
			assert.equal(receipt?.version, 2);
			assert.equal((await manager.get(row.id)).ticket.contentRevision, 2);
			assert.deepEqual(await manager.edit(input), receipt);
			assert.equal((await manager.get(row.id)).ticket.version, 2);
			assert.equal(m.runtime.view().phase, "ready");
		}
		assert.equal(m.f.requests.length, 0);
		assert.deepEqual(outcomes, ["unknown", "ok"]);
	} finally {
		await m.close();
	}
});

// Losing the post-commit continuation error mapping falsely claims refusal of real MAS effects.
for (const operation of ["dispatch", "recover"] as const) {
	test(
		"RSI " + operation + " distinguishes pre-commit refusal from post-commit unknown",
		{ timeout: 20000 },
		async () => {
			const m = await runtimeFixture();
			let role: TicketRole = "manager",
				revoked = false,
				armed = false,
				loseAck = operation === "recover",
				sends = 0,
				acceptedId = "";
			try {
				const mas = await createMas({
					runtime: m.runtime,
					namespace: "publication-mas-" + operation,
					maxPending: 4,
				});
				await mas.bootstrap([{ key: "worker", owner: "operator" }]);
				await mas.activate();
				const target = (await mas.view()).members[0]!.ref;
				const delegate = createMasTicketDispatcher({
					routes: [
						{
							handlerId: "worker",
							target,
							client: mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] }),
						},
					],
				});
				const dispatcher: TicketDispatcher = {
					...delegate,
					async send(...args) {
						const delivery = await delegate.send(...args);
						sends++;
						acceptedId = delivery.id;
						if (loseAck) throw Error("Controlled lost delivery response");
						if (armed) revoked = true;
						return delivery;
					},
					async lookup(...args) {
						const delivery = await delegate.lookup(...args);
						if (armed) revoked = true;
						return delivery;
					},
				};
				const client = (
					await createTicketService({
						runtime: m.runtime,
						namespace: "post-commit-" + operation,
						handlers,
						dispatcher,
					})
				).connect({
					id: "operator",
					role: () => role,
					check() {
						if (revoked) throw Error("Revoked");
					},
				});
				const ticket = await client.submit({
					requestId: "submit",
					title: "Title",
					body: "Body",
					sources: [],
				});
				await client.assign({ requestId: "assign", id: ticket.id, expectedVersion: 1, handlerId: "worker" });
				const dispatchInput = { requestId: "dispatch", id: ticket.id, expectedVersion: 2 };
				if (operation === "recover") {
					await client.dispatch(dispatchInput); // Original real delivery accepted; only its response is lost.
					loseAck = false;
				}
				const before = await client.get(ticket.id);
				const recoveryInput = {
					requestId: "recover",
					id: ticket.id,
					expectedVersion: before.ticket.version,
					runId: before.ticket.runs[0]?.id ?? "",
				};
				if (operation === "recover") assert.ok(recoveryInput.runId);
				const input = operation === "dispatch" ? dispatchInput : recoveryInput;
				const perform = () =>
					operation === "dispatch" ? client.dispatch(dispatchInput) : client.recover(recoveryInput);
				role = "reader";
				await assert.rejects(perform(), { code: "denied" });
				role = "manager";
				assert.equal(await client.lookup(input.requestId), null);
				assert.equal((await client.get(ticket.id)).ticket.version, before.ticket.version);
				assert.equal(sends, operation === "recover" ? 1 : 0);
				armed = true;
				const result = await perform().then(
					() => "ok",
					(error) => error.code,
				);
				assert.equal(revoked, true);
				armed = false;
				revoked = false;
				const receipt = await client.lookup(input.requestId);
				assert.ok(receipt?.runId);
				assert.equal(sends, 1);
				assert.deepEqual(await perform(), receipt);
				assert.equal(sends, 1);
				const refreshed = await client.refresh({ id: ticket.id, runId: receipt.runId });
				assert.equal(refreshed.ticket.runs[0]?.receiptId, acceptedId);
				await m.runtime.waitForIdle();
				assert.equal(m.f.requests.length, 1);
				assert.equal(m.runtime.view().phase, "ready");
				assert.equal(result, "unknown");
			} finally {
				await m.close();
			}
		},
	);
}

// A stale post-commit head must not keep a former handler's read right alive.
test("RSI post-commit receipt cannot publish a head snapshot after assignment revocation", async () => {
	const m = await runtimeFixture();
	let armed = false,
		committed = false,
		held = false;
	let paused = deferred(),
		released = deferred();
	try {
		const runtime = {
			...m.runtime,
			records(options: Parameters<typeof m.runtime.records>[0]) {
				const native = m.runtime.records(options);
				return {
					...native,
					async commit(...args: Parameters<typeof native.commit>) {
						const result = await native.commit(...args);
						if (armed && args[0].append.some((item) => item.data.kind === "reported")) committed = true;
						return result;
					},
					async get(...args: Parameters<typeof native.get>) {
						const result = await native.get(...args);
						if (armed && committed && !held && args[0].startsWith("ticket:")) {
							held = true;
							paused.resolve();
							await released.promise; // Pause only after obtaining the real immutable head.
						}
						return result;
					},
				};
			},
		};
		const namespace = "receipt-head-snapshot";
		const manager = (await createTicketService({ runtime: m.runtime, namespace, handlers })).connect(actor);
		const worker = (await createTicketService({ runtime, namespace, handlers })).connect({
			id: "worker",
			role: () => "handler",
			check() {},
		});
		const target = await manager.submit({ requestId: "target", title: "Target", body: "Body", sources: [] });
		await manager.assign({
			requestId: "assign-target",
			id: target.id,
			expectedVersion: 1,
			handlerId: "worker",
		});
		const other = await manager.submit({ requestId: "other", title: "Other", body: "Body", sources: [] });
		await manager.assign({
			requestId: "assign-other",
			id: other.id,
			expectedVersion: 1,
			handlerId: "worker",
		});
		const own = await worker.submit({ requestId: "own", title: "Own", body: "Body", sources: [] });
		await manager.assign({ requestId: "assign-own", id: own.id, expectedVersion: 1, handlerId: "worker" });
		const outcomes = [];
		for (const scenario of [
			{
				requestId: "report-revoked",
				reportId: target.id,
				targetVersion: 2,
				revokeId: target.id,
				revokeVersion: 3,
				want: "unknown",
			},
			{
				requestId: "report-unrelated",
				reportId: target.id,
				targetVersion: 5,
				revokeId: other.id,
				revokeVersion: 2,
				want: "ok",
			},
			{
				requestId: "report-own",
				reportId: own.id,
				targetVersion: 2,
				revokeId: own.id,
				revokeVersion: 3,
				want: "ok",
			},
		]) {
			paused = deferred();
			released = deferred();
			held = false;
			committed = false;
			armed = true;
			const input = {
				requestId: scenario.requestId,
				id: scenario.reportId,
				expectedVersion: scenario.targetVersion,
				state: "active" as const,
				text: scenario.requestId,
				links: [],
			};
			const reporting = worker.report(input).then(
				() => "ok",
				(error) => error.code,
			);
			await bounded(paused.promise);
			await manager.assign({
				requestId: "revoke-" + scenario.requestId,
				id: scenario.revokeId,
				expectedVersion: scenario.revokeVersion,
				handlerId: null,
			});
			released.resolve();
			outcomes.push(await reporting);
			armed = false;
			if (scenario.want === "unknown") {
				await assert.rejects(worker.lookup(input.requestId), { code: "denied" });
				await manager.assign({
					requestId: "restore-target",
					id: target.id,
					expectedVersion: 4,
					handlerId: "worker",
				});
			}
			const receipt = await worker.lookup(input.requestId);
			assert.deepEqual(receipt, {
				requestId: input.requestId,
				id: scenario.reportId,
				version: scenario.targetVersion + 1,
				contentRevision: 1,
				state: "active",
				runId: null,
			});
			const before = await manager.get(scenario.reportId);
			assert.equal(
				before.ticket.events.filter((event) => event.kind === "reported" && event.text === input.requestId)
					.length,
				1,
			);
			assert.deepEqual(await worker.report(input), receipt);
			assert.equal((await manager.get(scenario.reportId)).ticket.version, before.ticket.version);
			assert.equal(m.runtime.view().phase, "ready");
		}
		assert.equal(m.f.requests.length, 0);
		assert.deepEqual(outcomes, ["unknown", "ok", "ok"]);
	} finally {
		released.resolve();
		await m.close();
	}
});

test("A-6: assignment revoked during later list item cannot publish first summary", async () => {
	const m = await runtimeFixture();
	let intercept = false,
		firstSeen = false,
		secondId = "";
	const paused = deferred(),
		released = deferred();
	try {
		const runtime = {
			...m.runtime,
			records: (options: Parameters<typeof m.runtime.records>[0]) => {
				const native = m.runtime.records(options);
				return {
					...native,
					get: async (...args: Parameters<typeof native.get>) => {
						if (intercept && args[0] === "ticket:" + secondId && !firstSeen) {
							firstSeen = true;
							paused.resolve();
							await released.promise;
						}
						return native.get(...args);
					},
				};
			},
		};
		const manager = (
			await createTicketService({ runtime: m.runtime, namespace: "review-list", handlers })
		).connect(actor);
		const reader = (await createTicketService({ runtime, namespace: "review-list", handlers })).connect({
			id: "worker",
			role: () => "handler",
			check() {},
		});
		const older = await manager.submit({ requestId: "older", title: "Older", body: "Body", sources: [] });
		secondId = older.id;
		const first = await manager.submit({
			requestId: "newer",
			title: "PRIVATE-TITLE",
			body: "Body",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "assign",
			id: first.id,
			expectedVersion: 1,
			handlerId: "worker",
		});
		intercept = true;
		const listing = reader.list();
		await bounded(paused.promise);
		await manager.assign({
			requestId: "revoke",
			id: first.id,
			expectedVersion: assigned.version,
			handlerId: null,
		});
		released.resolve();
		const page = await listing;
		assert.equal(
			page.items.some((x) => x.id === first.id),
			false,
		);
	} finally {
		released.resolve();
		await m.close();
	}
});

test("A-2: same clock and duplicate recovery must enter admission once", { timeout: 15000 }, async () => {
	const m = await runtimeFixture();
	const savedNow = Date.now;
	let blockInitial = true,
		compete = false,
		admissions = 0;
	const gates = new Map<
		string,
		{ n: number; ready: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }
	>();
	for (const key of ["recover", "dispatching"])
		gates.set(key, { n: 0, ready: deferred(), release: deferred() });
	try {
		const runtime = {
			...m.runtime,
			records: (options: Parameters<typeof m.runtime.records>[0]) => {
				const native = m.runtime.records(options);
				return {
					...native,
					commit: async (...args: Parameters<typeof native.commit>) => {
						const sending = args[0].writes.some((w) => w.data.stage === "dispatching");
						if (blockInitial && sending) {
							blockInitial = false;
							throw Error("stop before send checkpoint");
						}
						const recovery = args[0].append.some((w) => w.data.text === "Explicit run recovery requested");
						const gate = compete ? gates.get(sending ? "dispatching" : recovery ? "recover" : "") : undefined;
						if (gate) {
							if (++gate.n === 2) gate.ready.resolve();
							await gate.release.promise;
						}
						return native.commit(...args);
					},
				};
			},
		};
		const mas = await createMas({ runtime: m.runtime, namespace: "review-mas", maxPending: 4 });
		await mas.bootstrap([{ key: "worker", owner: "operator" }]);
		await mas.activate();
		mas.setAdmission(() => {
			admissions++;
			return true;
		});
		const target = (await mas.view()).members[0]!.ref;
		const dispatcher = createMasTicketDispatcher({
			routes: [
				{
					handlerId: "worker",
					target,
					client: mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] }),
				},
			],
		});
		const options = { runtime, namespace: "review-run", handlers, dispatcher };
		const initial = (await createTicketService(options)).connect(actor);
		const t = await initial.submit({ requestId: "submit", title: "Title", body: "Body", sources: [] });
		await initial.assign({ requestId: "assign", id: t.id, expectedVersion: 1, handlerId: "worker" });
		await assert.rejects(initial.dispatch({ requestId: "dispatch", id: t.id, expectedVersion: 2 }));
		const a = (await createTicketService(options)).connect(actor),
			b = (await createTicketService(options)).connect(actor);
		const before = await a.get(t.id);
		const run = before.ticket.runs[0]!;
		const input = { requestId: "recover", id: t.id, runId: run.id, expectedVersion: before.ticket.version };
		const fixed = savedNow();
		Date.now = () => fixed;
		compete = true;
		const result = Promise.allSettled([a.recover(input), b.recover(input)]);
		for (const key of ["recover", "dispatching"]) {
			const gate = gates.get(key)!;
			await bounded(gate.ready.promise);
			gate.release.resolve();
		}
		const settled = await result;
		Date.now = savedNow;
		await m.runtime.waitForIdle();
		assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
		assert.equal(admissions, 1);
		assert.equal(m.f.requests.length, 1);
		const original = await a.lookup("recover");
		assert.ok(original?.runId);
		await b.refresh({ id: t.id, runId: original.runId });
		assert.equal(admissions, 1);
	} finally {
		Date.now = savedNow;
		for (const g of gates.values()) g.release.resolve();
		await m.close();
	}
});
