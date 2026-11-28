import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMas } from "../../mas/src/index.ts";
import { createTicketService } from "../src/index.ts";
import { createMasTicketDispatcher } from "../src/mas.ts";
test("B-1: serialized dispatch is refused before plan/admission", async () => {
	const m = await runtimeFixture();
	let admissions = 0;
	try {
		const mas = await createMas({ runtime: m.runtime, namespace: "review-input", maxPending: 4 });
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
		const a = (
			await createTicketService({
				runtime: m.runtime,
				namespace: "review-input",
				handlers: [{ id: "worker", label: "Worker", actorId: "worker" }],
				dispatcher,
			})
		).connect({ id: "owner", role: () => "manager", check() {} });
		const t = await a.submit({ requestId: "submit", title: "x", body: "\ud800".repeat(12000), sources: [] });
		await a.assign({ requestId: "assign", id: t.id, expectedVersion: 1, handlerId: "worker" });
		const sent = await a.dispatch({ requestId: "send", id: t.id, expectedVersion: 2 }).then(
			(v) => ({ status: "accepted", value: v }),
			(e) => ({ status: e.code }),
		);
		const after = await a.get(t.id);
		assert.equal(admissions, 0);
		assert.equal(m.f.requests.length, 0);
		assert.equal(after.ticket.runs.length, 0);
		assert.equal(sent.status, "capacity");
		assert.equal(after.ticket.version, 2);
		assert.equal(await a.lookup("send"), null);
	} finally {
		await m.close();
	}
});
