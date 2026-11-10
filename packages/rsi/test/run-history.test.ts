import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMas } from "../../mas/src/index.ts";
import { createTicketService } from "../src/index.ts";
import { createMasTicketDispatcher } from "../src/mas.ts";

test(
	"completed runs leave active capacity while their identities remain paged beyond 64 runs",
	{ timeout: 60000 },
	async () => {
		const m = await runtimeFixture(
			{},
			{ maxConversations: 8, maxPrimaryAttempts: 100, maxAuxiliaryAttempts: 4 },
		);
		try {
			const mas = await createMas({ runtime: m.runtime, namespace: "run-history", maxPending: 4 });
			await mas.bootstrap([{ key: "worker", owner: "owner" }]);
			await mas.activate();
			const target = (await mas.view()).members[0]!.ref;
			const dispatcher = createMasTicketDispatcher({
				routes: [
					{
						handlerId: "worker",
						target,
						client: mas.connect({ principal: "owner", source: null, grants: ["send", "observe"] }),
					},
				],
			});
			const client = (
				await createTicketService({
					runtime: m.runtime,
					namespace: "tickets",
					handlers: [{ id: "worker", label: "Worker", actorId: "worker" }],
					dispatcher,
				})
			).connect({ id: "owner", role: () => "manager", check() {} });
			const created = await client.submit({
				requestId: "submit",
				title: "Long research",
				body: "Each run remains separate",
				sources: [],
			});
			let current = await client.assign({
				requestId: "assign",
				id: created.id,
				expectedVersion: 1,
				handlerId: "worker",
			});
			const ids: string[] = [];
			for (let i = 0; i < 70; i++) {
				const sent = await client.dispatch({
					requestId: "run-" + i,
					id: created.id,
					expectedVersion: current.version,
				});
				assert.ok(sent.runId);
				ids.push(sent.runId);
				await m.runtime.waitForIdle();
				const view = await client.refresh({ id: created.id, runId: sent.runId });
				assert.equal(view.ticket.state, "active");
				current = { ...sent, version: view.ticket.version };
			}
			const first = await client.get(created.id);
			const seen = first.ticket.runs.map((run) => run.id);
			let cursor = first.cursors.runs;
			while (cursor) {
				const page = await client.history({ id: created.id, kind: "runs", cursor });
				if (page.kind === "runs") seen.push(...page.items.map((run) => run.id));
				cursor = page.cursor;
			}
			assert.deepEqual(seen.sort(), ids.sort());
			assert.equal(m.f.requests.length, 70);
			const original = await client.lookup("run-0");
			assert.ok(original?.runId);
			assert.equal(
				(await client.refresh({ id: created.id, runId: original.runId })).ticket.version,
				current.version,
			);
		} finally {
			await m.close();
		}
	},
);
