import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodeValue } from "@pakka/webui/extension";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService } from "../src/index.ts";
import { resultSchema } from "../src/browser/contract.ts";

test("ticket detail and revision pages remain transport-readable as full-size Unicode history grows", async () => {
	const m = await runtimeFixture();
	try {
		const author = (await createTicketService({ runtime: m.runtime, namespace: "bounded" })).connect({
			id: "author",
			role: () => "manager",
			check() {},
		});
		let current = await author.submit({
			requestId: "first",
			title: "Long investigation",
			body: "证".repeat(12000),
			sources: [],
		});
		for (let i = 0; i < 20; i++)
			current = await author.edit({
				requestId: "edit-" + i,
				id: current.id,
				expectedVersion: current.version,
				title: "Revision " + i,
				body: "据".repeat(12000),
				sources: [],
			});
		for (let i = 0; i < 8; i++)
			current = await author.report({
				requestId: "report-" + i,
				id: current.id,
				expectedVersion: current.version,
				state: "active",
				text: "文".repeat(12000),
				links: [],
			});
		const view = await author.get(current.id);
		assert.ok(
			Buffer.byteLength(JSON.stringify(view)) < 256 * 1024,
			"detail must budget decoded revision bodies",
		);
		assert.doesNotThrow(() => decodeValue(resultSchema("get"), { status: "ok", value: view }));
		const versions = view.ticket.revisions.map((r) => r.revision);
		let cursor = view.cursors.revisions;
		assert.ok(cursor, "the complete archive cannot fit in the detail response");
		while (cursor) {
			const page = await author.history({ id: current.id, kind: "revisions", cursor, limit: 32 });
			assert.ok(Buffer.byteLength(JSON.stringify(page)) < 192 * 1024);
			assert.doesNotThrow(() => decodeValue(resultSchema("history"), { status: "ok", value: page }));
			if (page.kind === "revisions") versions.push(...page.items.map((r) => r.revision));
			cursor = page.cursor;
		}
		assert.deepEqual(
			versions.sort((a, b) => a - b),
			Array.from({ length: 21 }, (_, i) => i + 1),
		);
	} finally {
		await m.close();
	}
});
