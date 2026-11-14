import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createRuntime } from "../../agent/src/index.ts";
import { createMas } from "../../mas/src/index.ts";
import { createTicketService } from "../src/index.ts";
import * as adapters from "../src/mas.ts";

const managerActor = { id: "operator", role: () => "manager" as const, check() {} };

// Break caught: publication depends on notification, or lost delivery results
// trigger a second send instead of reconciling the original fixed message.
test("report notifications: saved H report reaches J by exact MAS identity and lost response survives passive original Runtime reopen", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		assert.equal(
			typeof adapters.createMasReportNotifier,
			"function",
			"Optional saved-report notifier is missing",
		);
		const mas = await createMas({ runtime: m.runtime, namespace: "report-mas", maxPending: 8 });
		await mas.bootstrap([
			{ key: "H", owner: "operator" },
			{ key: "J", owner: "operator" },
		]);
		await mas.activate();
		const members = (await mas.view()).members,
			Href = members.find((member) => member.key === "H")!.ref,
			Jref = members.find((member) => member.key === "J")!.ref;
		const handlers = [
			{ id: "H", label: "H", actorId: "H" },
			{ id: "J", label: "J", actorId: "J" },
		];
		const service = await createTicketService({
			runtime: m.runtime,
			namespace: "notified-tickets",
			handlers,
		});
		const manager = service.connect(managerActor),
			H = service.connect({ id: "H", role: () => "handler", check() {} });
		const ticket = await manager.submit({
			requestId: "ticket",
			title: "Parser",
			body: "Fixed work",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "H",
			id: ticket.id,
			expectedVersion: 1,
			handlerId: "H",
		});
		const work = await manager.registerWork({
			requestId: "H-work",
			id: ticket.id,
			expectedVersion: assigned.version,
			handlerId: "H",
			contentRevision: 1,
			conversation: Href,
		});
		const transferred = await manager.assign({
			requestId: "J",
			id: ticket.id,
			expectedVersion: assigned.version,
			handlerId: "J",
		});
		const saved = await H.report({
			requestId: "H-report",
			id: ticket.id,
			workId: work.workId,
			text: "Result saved before any notification",
			links: [],
		});
		assert.equal(m.f.requests.length, 0);
		const originalSender = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
		let sends = 0;
		const lostSender = {
			...originalSender,
			withAuthority(check: () => void) {
				const bound = originalSender.withAuthority(check);
				return {
					...bound,
					async send(...args: Parameters<typeof bound.send>) {
						sends++;
						await bound.send(...args);
						throw Error("Lost committed MAS response");
					},
				};
			},
		};
		const notifier = await adapters.createMasReportNotifier({
			runtime: m.runtime,
			namespace: "report-outbox",
			tickets: manager,
			routes: [{ handlerId: "J", target: Jref, client: lostSender }],
			check() {},
		});
		await assert.rejects(
			notifier.notify({
				requestId: "not-saved",
				id: ticket.id,
				reportId: "made-up",
				reportVersion: 1,
				handlerId: "J",
			}),
		);
		assert.equal(sends, 0);
		const input = {
			requestId: "notify-H-report",
			id: ticket.id,
			reportId: saved.reportId,
			reportVersion: 1,
			handlerId: "J",
		};
		const unknown = await notifier.notify(input);
		assert.equal(unknown.stage, "unknown");
		assert.equal(sends, 1);
		await m.runtime.waitForIdle();
		assert.equal((await manager.get(ticket.id)).ticket.version, transferred.version);
		assert.equal(
			(await H.readReport({ id: ticket.id, reportId: saved.reportId })).text,
			"Result saved before any notification",
		);
		await H.reviseReport({
			requestId: "correct",
			id: ticket.id,
			reportId: saved.reportId,
			expectedVersion: 1,
			text: "Later correction",
			links: [],
		});
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		const restoredMas = await createMas({ runtime: reopened, namespace: "report-mas", maxPending: 8 });
		const restoredTickets = (
			await createTicketService({ runtime: reopened, namespace: "notified-tickets", handlers })
		).connect(managerActor);
		const restored = await adapters.createMasReportNotifier({
			runtime: reopened,
			namespace: "report-outbox",
			tickets: restoredTickets,
			routes: [
				{
					handlerId: "J",
					target: Jref,
					client: restoredMas.connect({ principal: "operator", source: null, grants: ["send", "observe"] }),
				},
			],
			check() {},
		});
		assert.equal(m.f.requests.length, 1, "construction/reopen must not send or execute");
		const reconciled = await restored.reconcile(input.requestId);
		assert.ok(reconciled?.delivery?.id);
		assert.equal(reconciled.stage, "accepted");
		assert.equal(reconciled.reportVersion, 1, "later report correction must not alter the sent reference");
		assert.deepEqual(await restored.notify(input), reconciled);
		await assert.rejects(restored.notify({ ...input, reportVersion: 2 }), { code: "conflict" });
		assert.equal(m.f.requests.length, 1);
		assert.equal(
			(await restoredTickets.readReport({ id: ticket.id, reportId: saved.reportId, version: 1 })).text,
			"Result saved before any notification",
		);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

// Break caught: a claimed but unconfirmed send is treated as unsent and
// automatically replayed; original reports must stay readable without MAS.
test("report notifications: unconfirmed unsent checkpoint stays unknown and never replays; contributions do not require MAS", async () => {
	const m = await runtimeFixture();
	try {
		assert.equal(typeof adapters.createMasReportNotifier, "function");
		const mas = await createMas({ runtime: m.runtime, namespace: "unknown-report-mas", maxPending: 4 });
		await mas.bootstrap([{ key: "J", owner: "operator" }]);
		await mas.activate();
		const target = (await mas.view()).members[0]!.ref;
		const tickets = (
			await createTicketService({
				runtime: m.runtime,
				namespace: "unknown-tickets",
				handlers: [{ id: "H", label: "H", actorId: "H" }],
			})
		).connect(managerActor);
		const conversation = await m.runtime.createConversation({ key: "H-original" });
		const ticket = await tickets.submit({
			requestId: "ticket",
			title: "Passive",
			body: "Original",
			sources: [],
		});
		const assignment = await tickets.assign({
			requestId: "assign",
			id: ticket.id,
			expectedVersion: 1,
			handlerId: "H",
		});
		const work = await tickets.registerWork({
			requestId: "work",
			id: ticket.id,
			expectedVersion: assignment.version,
			handlerId: "H",
			contentRevision: 1,
			conversation,
		});
		const report = await tickets.report({
			requestId: "saved",
			id: ticket.id,
			workId: work.workId,
			text: "Always preserved",
			links: [],
		});
		const client = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
		let attempts = 0;
		const offline = {
			...client,
			withAuthority(check: () => void) {
				const bound = client.withAuthority(check);
				return {
					...bound,
					async send() {
						attempts++;
						throw Error("Offline before MAS admission");
					},
				};
			},
		};
		const options = {
			runtime: m.runtime,
			namespace: "unknown-outbox",
			tickets,
			routes: [{ handlerId: "J", target, client: offline }],
			check() {},
		};
		const notifier = await adapters.createMasReportNotifier(options);
		const input = {
			requestId: "notice",
			id: ticket.id,
			reportId: report.reportId,
			reportVersion: 1,
			handlerId: "J",
		};
		assert.equal((await notifier.notify(input)).stage, "unknown");
		const another = await adapters.createMasReportNotifier(options);
		assert.equal((await another.notify(input)).stage, "unknown");
		assert.equal((await another.reconcile(input.requestId))?.stage, "unknown");
		assert.equal(attempts, 1);
		const a = await adapters.createMasReportNotifier({ ...options, namespace: "race-outbox" });
		const b = await adapters.createMasReportNotifier({ ...options, namespace: "race-outbox" });
		const raced = await Promise.all([a.notify(input), b.notify(input)]);
		assert.ok(raced.every((value) => value.stage === "unknown"));
		assert.equal(
			attempts,
			2,
			"two notifier instances must win only one send claim for a fresh business request",
		);
		assert.equal(
			(await tickets.readReport({ id: ticket.id, reportId: report.reportId })).text,
			"Always preserved",
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
