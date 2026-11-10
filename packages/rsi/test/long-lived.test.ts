import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";

const actor = { id: "author", role: () => "manager" as const, check() {} };
const request = (requestId: string) => ({
	requestId,
	title: "Long task",
	body: "Retained evidence",
	sources: [],
});

test("tickets: accumulated tickets and mutation receipts no longer set the space lifetime", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const client = (await createTicketService({ runtime: m.runtime, namespace: "long-tickets" })).connect(
			actor,
		);
		const first = await client.submit(request("first"));
		for (let i = 0; i < 260; i++) await client.submit(request(`later-${i}`));
		assert.deepEqual(await client.lookup("first"), first);
		let cursor: string | undefined,
			count = 0;
		do {
			const page = await client.list({ limit: 50, ...(cursor ? { cursor } : {}) });
			count += page.items.length;
			cursor = page.cursor ?? undefined;
		} while (cursor);
		assert.equal(count, 261);
		const sessionFile = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: sessionFile });
		const restored = (await createTicketService({ runtime: reopened, namespace: "long-tickets" })).connect(
			actor,
		);
		assert.deepEqual(await restored.submit(request("first")), first);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("tickets: one long ticket keeps old revisions reachable through bounded detail and history pages", async () => {
	const m = await runtimeFixture();
	try {
		const client = (await createTicketService({ runtime: m.runtime, namespace: "long-history" })).connect(
			actor,
		);
		let receipt = await client.submit(request("first"));
		for (let i = 0; i < 140; i++)
			receipt = await client.edit({
				requestId: `edit-${i}`,
				id: receipt.id,
				expectedVersion: receipt.version,
				title: `Revision ${i}`,
				body: "x".repeat(2000),
				sources: [],
			});
		const view = await client.get(receipt.id);
		assert.equal(view.ticket.contentRevision, 141);
		assert.ok(view.ticket.revisions.length <= 32);
		assert.ok(view.cursors.revisions);
		const revisions = view.ticket.revisions.map((v) => v.revision);
		let cursor: string | null = view.cursors.revisions;
		while (cursor) {
			const page = await client.history({ id: receipt.id, kind: "revisions", cursor, limit: 32 });
			assert.equal(page.kind, "revisions");
			if (page.kind === "revisions") revisions.push(...page.items.map((v) => v.revision));
			cursor = page.cursor;
		}
		assert.deepEqual(
			revisions.sort((a, b) => a - b),
			Array.from({ length: 141 }, (_, i) => i + 1),
		);
		assert.deepEqual(await client.lookup("first"), {
			requestId: "first",
			id: receipt.id,
			version: 1,
			contentRevision: 1,
			state: "open",
			runId: null,
		});
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
