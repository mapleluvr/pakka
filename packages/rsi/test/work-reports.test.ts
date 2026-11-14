import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";
import type { TicketActor, TicketRole } from "../src/types.ts";

const actor = (id: string, role: TicketRole): TicketActor => ({ id, role: () => role, check() {} });
const code = (value: string) => (error: unknown) =>
	!!error && typeof error === "object" && "code" in error && error.code === value;
const handlers = [
	{ id: "H", label: "Original contributor", actorId: "H" },
	{ id: "J", label: "Current contributor", actorId: "J" },
];

// Real Runtime/SQLite. The two Conversations are stable navigation evidence;
// registering, saving and reading work must not run either model.
async function setup() {
	const m = await runtimeFixture();
	try {
		const conversation = await m.runtime.createConversation({ key: "original-work" });
		const service = await createTicketService({ runtime: m.runtime, namespace: "work-reports", handlers });
		const manager = service.connect(actor("manager", "manager"));
		const H = service.connect(actor("H", "handler")),
			J = service.connect(actor("J", "handler"));
		const created = await manager.submit({
			requestId: "create",
			title: "Parser",
			body: "revision one",
			sources: [],
		});
		await manager.edit({
			requestId: "revision-two",
			id: created.id,
			expectedVersion: 1,
			title: "Parser",
			body: "revision two",
			sources: [],
		});
		const third = await manager.edit({
			requestId: "revision-three",
			id: created.id,
			expectedVersion: 2,
			title: "Parser",
			body: "ORIGINAL-REVISION-THREE",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "assign-H",
			id: created.id,
			expectedVersion: third.version,
			handlerId: "H",
		});
		assert.equal(
			typeof manager.registerWork,
			"function",
			"RSI must register a trusted fixed original work relation",
		);
		const work = await manager.registerWork({
			requestId: "work-H",
			id: created.id,
			expectedVersion: assigned.version,
			handlerId: "H",
			contentRevision: 3,
			conversation,
		});
		return { m, service, manager, H, J, id: created.id, assigned, work, conversation };
	} catch (error) {
		await m.close();
		throw error;
	}
}

// Break caught: report still follows the current handler or updates its state/head.
test("work reports: reassigned H saves two revision-3 reports without reading J's new content or changing the current state", async () => {
	const f = await setup();
	try {
		const transferred = await f.manager.assign({
			requestId: "assign-J",
			id: f.id,
			expectedVersion: f.assigned.version,
			handlerId: "J",
		});
		const fourth = await f.manager.edit({
			requestId: "revision-four",
			id: f.id,
			expectedVersion: transferred.version,
			title: "Parser next phase",
			body: "J-PRIVATE-FUTURE-REVISION-FOUR",
			sources: [],
		});
		await f.J.setState({
			requestId: "J-active",
			id: f.id,
			expectedVersion: fourth.version,
			state: "active",
			text: "J continues",
			links: [],
		});
		const before = (await f.manager.get(f.id)).ticket;
		await assert.rejects(f.H.get(f.id), code("denied"));
		const original = await f.H.getWork({ id: f.id, workId: f.work.workId });
		assert.equal(original.content.revision, 3);
		assert.equal(original.content.body, "ORIGINAL-REVISION-THREE");
		assert.deepEqual(original.work.conversation, f.conversation);
		const firstInput = {
			requestId: "H-first",
			id: f.id,
			workId: f.work.workId,
			text: "Grammar draft",
			links: [],
		};
		const first = await f.H.report(firstInput);
		const second = await f.H.report({
			requestId: "H-second",
			id: f.id,
			workId: f.work.workId,
			text: "Parser experiment after transfer",
			links: [],
			results: [{ uri: "artifact:parser-test", version: "run-3" }],
		});
		assert.notEqual(first.reportId, second.reportId);
		assert.deepEqual(await f.H.report(firstInput), first);
		assert.deepEqual(await f.H.lookup("H-first"), first);
		const published = await f.H.readReport({ id: f.id, reportId: second.reportId });
		assert.equal(published.actorId, "H");
		assert.equal(published.revisionActorId, "H");
		await f.manager.reviseReport({
			requestId: "manager-correction",
			id: f.id,
			reportId: second.reportId,
			expectedVersion: 1,
			text: "Manager correction",
			links: [],
		});
		const correction = await f.H.readReport({ id: f.id, reportId: second.reportId, version: 2 });
		assert.equal(correction.actorId, "H", "report ownership stays with its original author");
		assert.equal(
			correction.revisionActorId,
			"manager",
			"a manager revision must not be falsely attributed to H",
		);
		assert.equal(
			(await f.H.readReport({ id: f.id, reportId: second.reportId, version: 1 })).revisionActorId,
			"H",
		);
		assert.equal(published.contentRevision, 3);
		assert.equal(published.workId, f.work.workId);
		assert.deepEqual(published.conversation, f.conversation);
		assert.equal(JSON.stringify(published).includes("J-PRIVATE-FUTURE"), false);
		assert.deepEqual(
			(await f.manager.get(f.id)).ticket,
			before,
			"saving reports must leave the entire ticket head and its histories unchanged",
		);
		assert.equal((await f.J.reports({ id: f.id })).items.length, 2);
		const nextConversation = await f.m.runtime.createConversation({ key: "J-original-work" });
		const nextWork = await f.manager.registerWork({
			requestId: "work-J",
			id: f.id,
			expectedVersion: before.version,
			handlerId: "J",
			contentRevision: 4,
			conversation: nextConversation,
		});
		const nextReport = await f.J.report({
			requestId: "J-report",
			id: f.id,
			workId: nextWork.workId,
			text: "J's revision-four findings",
			links: [],
		});
		assert.equal((await f.J.readReport({ id: f.id, reportId: nextReport.reportId })).contentRevision, 4);
		assert.equal((await f.manager.get(f.id)).ticket.version, before.version);
		await assert.rejects(f.H.getWork({ id: f.id, workId: nextWork.workId }), code("denied"));
		await assert.rejects(f.H.readReport({ id: f.id, reportId: nextReport.reportId }), code("denied"));
		assert.equal((await f.H.reports({ id: f.id })).items.length, 2);
		assert.equal((await f.J.reports({ id: f.id })).items.length, 3);
		await f.J.setState({
			requestId: "J-decision",
			id: f.id,
			expectedVersion: before.version,
			state: "waiting",
			text: "Separate decision",
			links: [],
		});
		assert.equal((await f.manager.get(f.id)).ticket.state, "waiting");
		assert.equal((await f.H.getWork({ id: f.id, workId: f.work.workId })).content.revision, 3);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});

// Break caught: raw run/actor/revision fields self-grant contribution, or report
// revisions use the unrelated ticket version instead of their own CAS.
test("work reports: trusted ownership, independent report CAS and explicit contribution withdrawal protect the original work", async () => {
	const f = await setup();
	try {
		const input = {
			requestId: "report",
			id: f.id,
			workId: f.work.workId,
			text: "Measured result",
			links: [],
		};
		await assert.rejects(f.J.report(input), code("denied"));
		await assert.rejects(f.H.report({ ...input, actorId: "J" } as never), code("invalid"));
		await assert.rejects(f.H.report({ ...input, contentRevision: 4 } as never), code("invalid"));
		await assert.rejects(
			f.H.report({ ...input, state: "closed", expectedVersion: 4 } as never),
			code("invalid"),
		);
		await assert.rejects(f.H.report({ ...input, workId: "made-up-original-run" }), code("denied"));
		const saved = await f.H.report(input);
		await assert.rejects(f.H.report({ ...input, text: "Changed same request" }), code("conflict"));
		const revised = await f.H.reviseReport({
			requestId: "report-edit",
			id: f.id,
			reportId: saved.reportId,
			expectedVersion: 1,
			text: "Corrected measured result",
			links: [],
		});
		assert.equal(revised.reportVersion, 2);
		assert.equal(
			(await f.H.readReport({ id: f.id, reportId: saved.reportId, version: 1 })).text,
			"Measured result",
		);
		assert.equal(
			(await f.H.readReport({ id: f.id, reportId: saved.reportId })).text,
			"Corrected measured result",
		);
		await assert.rejects(
			f.H.reviseReport({
				requestId: "stale-edit",
				id: f.id,
				reportId: saved.reportId,
				expectedVersion: 1,
				text: "Lost update",
				links: [],
			}),
			code("conflict"),
		);
		const stopped = await f.manager.setWorkContribution({
			requestId: "stop-work-contribution",
			id: f.id,
			workId: f.work.workId,
			expectedVersion: 1,
			allowed: false,
		});
		assert.equal(stopped.workVersion, 2);
		const reader = f.service.connect(actor("manager", "reader"));
		assert.deepEqual(
			await reader.registerWork({
				requestId: "work-H",
				id: f.id,
				expectedVersion: f.assigned.version,
				handlerId: "H",
				contentRevision: 3,
				conversation: f.conversation,
			}),
			f.work,
			"replay only needs original-object read authority",
		);
		assert.deepEqual(
			await reader.setWorkContribution({
				requestId: "stop-work-contribution",
				id: f.id,
				workId: f.work.workId,
				expectedVersion: 1,
				allowed: false,
			}),
			stopped,
		);
		await assert.rejects(
			reader.registerWork({
				requestId: "new-reader-work",
				id: f.id,
				expectedVersion: f.assigned.version,
				handlerId: "H",
				contentRevision: 3,
				conversation: f.conversation,
			}),
			code("denied"),
		);
		await assert.rejects(
			reader.setWorkContribution({
				requestId: "new-reader-change",
				id: f.id,
				workId: f.work.workId,
				expectedVersion: 2,
				allowed: true,
			}),
			code("denied"),
		);
		assert.equal((await reader.getWork({ id: f.id, workId: f.work.workId })).work.allowed, false);
		await assert.rejects(f.H.report({ ...input, requestId: "after-withdrawal" }), code("denied"));
		assert.deepEqual(
			await f.H.lookup("report"),
			saved,
			"stopping future contribution does not erase an already saved report receipt",
		);
		const disabled = f.service.connect({ id: "H", role: () => null, check() {} });
		await assert.rejects(disabled.getWork({ id: f.id, workId: f.work.workId }), code("denied"));
		await assert.rejects(disabled.readReport({ id: f.id, reportId: saved.reportId }), code("denied"));
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});

// Break caught: a duplicate business request wins execution twice, or different
// report additions collide on the ticket head and overwrite another author.
test("work reports: two services preserve one original append receipt and resolve report edits with report-local CAS", async () => {
	const f = await setup();
	try {
		const other = (
			await createTicketService({ runtime: f.m.runtime, namespace: "work-reports", handlers })
		).connect(actor("H", "handler"));
		const input = {
			requestId: "concurrent-append",
			id: f.id,
			workId: f.work.workId,
			text: "Single original result",
			links: [],
		};
		const [left, right] = await Promise.all([f.H.report(input), other.report(input)]);
		assert.deepEqual(left, right);
		assert.equal((await f.manager.reports({ id: f.id })).items.length, 1);
		await Promise.all([
			f.H.report({ ...input, requestId: "independent-left", text: "First independent contribution" }),
			other.report({ ...input, requestId: "independent-right", text: "Second independent contribution" }),
		]);
		assert.equal((await f.manager.reports({ id: f.id })).items.length, 3);
		const edits = await Promise.allSettled([
			f.H.reviseReport({
				requestId: "edit-left",
				id: f.id,
				reportId: left.reportId,
				expectedVersion: 1,
				text: "Left correction",
				links: [],
			}),
			other.reviseReport({
				requestId: "edit-right",
				id: f.id,
				reportId: left.reportId,
				expectedVersion: 1,
				text: "Right correction",
				links: [],
			}),
		]);
		assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
		assert.equal(edits.filter((r) => r.status === "rejected" && code("conflict")(r.reason)).length, 1);
		assert.equal((await f.H.readReport({ id: f.id, reportId: left.reportId })).version, 2);
		assert.equal((await f.manager.get(f.id)).ticket.version, f.assigned.version);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});

// Break caught: a still-valid reader role alone publishes a committed foreign
// report receipt, instead of checking the original work object read right.
test("work reports: committed receipt uses original-work read authority, preserving owner downgrade and unknown foreign publication", async () => {
	const f = await setup();
	let role: TicketRole = "manager",
		armed = false;
	try {
		const runtime = {
			...f.m.runtime,
			records(options: Parameters<typeof f.m.runtime.records>[0]) {
				const native = f.m.runtime.records(options);
				return {
					...native,
					async commit(...args: Parameters<typeof native.commit>) {
						const result = await native.commit(...args);
						if (armed) role = "reader";
						return result;
					},
				};
			},
		};
		const service = await createTicketService({ runtime, namespace: "work-reports", handlers });
		const outcomes = [];
		for (const scenario of [
			{ actorId: "outsider", want: "unknown" },
			{ actorId: "H", want: "ok" },
		]) {
			const client = service.connect({ id: scenario.actorId, role: () => role, check() {} });
			const input = {
				requestId: "boundary-" + scenario.actorId,
				id: f.id,
				workId: f.work.workId,
				text: "Saved before downgrade",
				links: [],
			};
			role = "manager";
			armed = true;
			outcomes.push(
				await client.report(input).then(
					() => "ok",
					(error) => error.code,
				),
			);
			armed = false;
			assert.equal(role, "reader");
			if (scenario.want === "unknown") await assert.rejects(client.lookup(input.requestId), code("denied"));
			else assert.ok(await client.lookup(input.requestId));
			role = "manager";
			const original = await client.lookup(input.requestId);
			assert.ok(original && "reportId" in original);
			assert.deepEqual(await client.report(input), original);
			assert.equal(
				(await client.readReport({ id: f.id, reportId: original.reportId })).text,
				"Saved before downgrade",
			);
		}
		assert.deepEqual(outcomes, ["unknown", "ok"]);
		assert.equal((await f.manager.reports({ id: f.id })).items.length, 2);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});

// Break caught: the transaction checks generic work contribution but not the
// stricter authority needed to revise a report authored by somebody else.
test("work reports: report-author permission is checked at revision commit, not replaced by generic original-work permission", async () => {
	const f = await setup();
	let role: TicketRole = "manager",
		armed = false;
	try {
		const outside = f.service.connect({ id: "outside", role: () => "manager", check() {} });
		const original = await outside.report({
			requestId: "outside-report",
			id: f.id,
			workId: f.work.workId,
			text: "Outside author",
			links: [],
		});
		const runtime = {
			...f.m.runtime,
			records(options: Parameters<typeof f.m.runtime.records>[0]) {
				const native = f.m.runtime.records(options);
				return {
					...native,
					commit: (
						request: Parameters<typeof native.commit>[0],
						check: Parameters<typeof native.commit>[1],
					) =>
						native.commit(request, () => {
							if (armed) role = "handler";
							check();
						}),
				};
			},
		};
		const service = await createTicketService({ runtime, namespace: "work-reports", handlers });
		const H = service.connect({ id: "H", role: () => role, check() {} });
		armed = true;
		await assert.rejects(
			H.reviseReport({
				requestId: "foreign-revise",
				id: f.id,
				reportId: original.reportId,
				expectedVersion: 1,
				text: "Unauthorized overwrite",
				links: [],
			}),
			code("denied"),
		);
		armed = false;
		assert.equal(role, "handler");
		assert.equal((await H.readReport({ id: f.id, reportId: original.reportId })).text, "Outside author");
		assert.equal(await H.lookup("foreign-revise"), null);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});
