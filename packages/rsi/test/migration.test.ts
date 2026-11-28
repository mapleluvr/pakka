import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";

const route = {
	handlerId: "worker",
	target: {
		key: "target",
		sessionId: "session",
		conversationId: "conversation",
		incarnation: "incarnation",
		profile: "profile",
	},
	source: null,
	principal: "principal",
};

for (const interrupt of [false, true])
	test(`legacy schema 1 snapshot migrates identities and resumes interrupted publication (${interrupt})`, async () => {
		const m = await runtimeFixture();
		try {
			const at = Date.now(),
				revision = (n: number) => ({
					revision: n,
					actorId: "author",
					at: at + n,
					title: "Legacy " + n,
					body: "body " + n,
					sources: [] as string[],
				});
			const revisions = [revision(1), revision(2)];
			const run = {
				id: "run-legacy",
				route,
				handlerId: "worker",
				contentRevision: 2,
				actorId: "author",
				at: at + 3,
				requestId: "dispatch",
				state: "unknown" as const,
				receiptId: null,
			};
			const legacy = {
				schema: 1,
				sessionId: m.runtime.view().sessionId,
				tickets: [
					{
						id: "ticket-legacy",
						authorId: "author",
						version: 3,
						contentRevision: 2,
						state: "active" as const,
						handler: { id: "worker", label: "Worker", actorId: "worker" },
						createdAt: at,
						updatedAt: at + 4,
						title: "Legacy 2",
						body: "body 2",
						sources: [],
						revisions,
						events: [
							{
								version: 1,
								actorId: "author",
								at,
								kind: "submitted" as const,
								state: "open" as const,
								text: "Created",
								links: [],
							},
							{
								version: 2,
								actorId: "author",
								at: at + 3,
								kind: "dispatched" as const,
								state: "active" as const,
								text: "Dispatched",
								links: [],
							},
							{
								version: 3,
								actorId: "worker",
								at: at + 4,
								kind: "reported" as const,
								state: "active" as const,
								text: "Preserved old report observation",
								links: [],
							},
						],
						runs: [run],
					},
				],
				requests: [
					{
						actorId: "author",
						requestId: "dispatch",
						fingerprint: "a".repeat(64),
						receipt: {
							requestId: "dispatch",
							id: "ticket-legacy",
							version: 2,
							contentRevision: 2,
							state: "active" as const,
							runId: "run-legacy",
						},
					},
				],
			};
			const store = m.runtime.store({ namespace: "legacy", maxBytes: 4 * 1024 * 1024 });
			await store.compareAndSet(0, legacy, () => {});
			await assert.rejects(createTicketService({ runtime: m.runtime, namespace: "legacy" }), /migrateLegacy/);
			assert.equal((await m.runtime.records({ namespace: "legacy" }).get("layout", () => {})).data, null);
			if (interrupt) {
				let once = true;
				const runtime = {
					...m.runtime,
					records: (options: Parameters<typeof m.runtime.records>[0]) => {
						const records = m.runtime.records(options);
						return {
							...records,
							commit: async (...args: Parameters<typeof records.commit>) => {
								const result = await records.commit(...args);
								if (once && args[0].requestId.includes(":revision:")) {
									once = false;
									throw Error("lost migration commit response");
								}
								return result;
							},
						};
					},
				};
				await assert.rejects(
					createTicketService({ runtime, namespace: "legacy", migrateLegacy: true }),
					/lost migration/,
				);
				assert.equal(
					(await m.runtime.records({ namespace: "legacy" }).get("layout", () => {})).data?.schema,
					1,
				);
				await assert.rejects(
					store.compareAndSet(1, legacy, () => {}),
					/frozen/,
				);
			}
			const service = await createTicketService({
				runtime: m.runtime,
				namespace: "legacy",
				migrateLegacy: true,
				handlers: [{ id: "worker", label: "Worker", actorId: "worker" }],
			});
			const author = service.connect({ id: "author", role: () => "submitter" as const, check() {} });
			const view = await author.get("ticket-legacy");
			assert.deepEqual(
				view.ticket.revisions.map((item) => item.revision),
				[1, 2],
			);
			assert.equal(view.ticket.runs[0]?.state, "unknown");
			assert.deepEqual(view.ticket.events, legacy.tickets[0]!.events);
			assert.equal((await author.reports({ id: "ticket-legacy" })).items.length, 0);
			await assert.rejects(author.getWork({ id: "ticket-legacy", workId: "run-legacy" }), { code: "denied" });
			assert.deepEqual(await author.lookup("dispatch"), legacy.requests[0]!.receipt);
			const retry = await author.lookup("dispatch");
			assert.ok(retry && "runId" in retry);
			assert.equal(retry.runId, "run-legacy");
			assert.deepEqual((await store.snapshot()).data, legacy);
			const coldRuntime = {
				...m.runtime,
				store() {
					throw Error("Published layout must not read legacy snapshot");
				},
			};
			const reopened = (
				await createTicketService({
					runtime: coldRuntime,
					namespace: "legacy",
					handlers: [{ id: "worker", label: "Worker", actorId: "worker" }],
				})
			).connect({ id: "author", role: () => "submitter" as const, check() {} });
			assert.deepEqual((await reopened.get("ticket-legacy")).ticket.runs[0], view.ticket.runs[0]);
		} finally {
			await m.close();
		}
	});
