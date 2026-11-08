import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodeValue } from "@pakka/webui/extension";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService, TicketError } from "../src/index.ts";
import { resultSchema } from "../src/browser/contract.ts";

test("ticket history stays readable through the real WebUI decoder when long revisions exhaust capacity", async () => {
	const m = await runtimeFixture();
	try {
		const service = await createTicketService({ runtime: m.runtime, namespace: "bounded" });
		const author = service.connect({ id: "author", role: () => "submitter", check() {} });
		const created = await author.submit({
			requestId: "first",
			title: "Long investigation",
			body: "证".repeat(12000),
			sources: [],
		});
		let current = created,
			exhausted = false;
		for (let i = 0; i < 20; i++) {
			try {
				current = await author.edit({
					requestId: "edit-" + i,
					id: current.id,
					expectedVersion: current.version,
					title: "Revision " + i,
					body: "据".repeat(12000),
					sources: [],
				});
			} catch (error) {
				assert.ok(error instanceof TicketError && error.code === "capacity");
				exhausted = true;
				break;
			}
			const view = await author.get(current.id);
			assert.doesNotThrow(
				() => decodeValue(resultSchema("get"), { status: "ok", value: view }),
				"a successfully stored ticket must remain transport-readable",
			);
		}
		assert.equal(exhausted, true);
		assert.equal((await author.get(current.id)).ticket.version, current.version);
	} finally {
		await m.close();
	}
});
