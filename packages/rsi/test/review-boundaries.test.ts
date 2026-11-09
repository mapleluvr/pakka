import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { deferred } from "../../agent/test/fixture.ts";
import { createTicketService } from "../src/index.ts";
import { createMas } from "../../mas/src/index.ts";
import { createMasTicketDispatcher } from "../src/mas.ts";
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

test("A-4: revocation inside postcommit publication returns unknown, preserves receipt", async () => {
	const m = await runtimeFixture();
	let revoked = false,
		intercept = false,
		count = 0;
	try {
		const runtime = {
			...m.runtime,
			records: (options: Parameters<typeof m.runtime.records>[0]) => {
				const native = m.runtime.records(options);
				return {
					...native,
					commit: async (...args: Parameters<typeof native.commit>) => {
						if (!intercept) return native.commit(...args);
						return native.commit(args[0], () => {
							if (++count === 4) revoked = true;
							args[1]();
						});
					},
				};
			},
		};
		const a = (await createTicketService({ runtime, namespace: "review-authority" })).connect({
			...actor,
			check() {
				if (revoked) throw Error("revoked");
			},
		});
		const t = await a.submit({ requestId: "first", title: "Title", body: "Body", sources: [] });
		intercept = true;
		const result = await a
			.edit({
				requestId: "edit",
				id: t.id,
				expectedVersion: 1,
				title: "Committed",
				body: "Body",
				sources: [],
			})
			.then(
				(value) => ({ value, code: "ok" }),
				(error) => ({ code: error.code, message: error.message }),
			);
		revoked = false;
		intercept = false;
		const receipt = await a.lookup("edit");
		assert.equal(m.runtime.view().phase, "ready");
		assert.equal(receipt?.version, 2);
		assert.equal(result.code, "unknown");
	} finally {
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
