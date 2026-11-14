import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ConversationRef, ToolInvocationScope } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketTools } from "../src/agent.ts";
import { createTicketService, type NativeTicketService } from "../src/index.ts";

// Real native scopes, not a hand-built tool invocation: original H can save
// and read an original-work result after reassignment, but cannot read J's head.
test("work report tools: real H native calls read revision three, save and read a report after transfer, and deny future ticket access", async () => {
	let service!: NativeTicketService, source!: ConversationRef, captured!: ToolInvocationScope;
	let ticketId = "",
		workId = "";
	const H = { id: "H", role: () => "handler" as const, check() {} };
	const pack = createTicketTools({
		resolve(scope) {
			captured = scope;
			return service.forInvocation({ actor: H, source }, scope);
		},
	});
	const m = await runtimeFixture(
		{ tools: pack.tools, systemPrompt: pack.instructions },
		undefined,
		(payload) => {
			const results = payload.messages.filter((message) => message.role === "tool");
			if (results.length === 0) return { tool: "ticket_get_work", args: { id: ticketId, workId } };
			if (results.length === 1)
				return {
					tool: "ticket_report",
					args: {
						requestId: "native-report",
						id: ticketId,
						workId,
						text: "Native revision-three finding",
						links: [],
					},
				};
			if (results.length === 2) {
				const receipt = JSON.parse(String(results[1]!.content));
				if (!receipt.value?.reportId) return { text: "Original report was refused: " + receipt.status };
				return {
					tool: "ticket_read_report",
					args: { id: ticketId, reportId: receipt.value.reportId, version: 1 },
				};
			}
			if (results.length === 3) return { tool: "ticket_get", args: { id: ticketId } };
			return { text: "Original result saved; no access to the new ticket content assumed." };
		},
	);
	try {
		source = m.runtime.view().conversations[0]!;
		service = await createTicketService({
			runtime: m.runtime,
			namespace: "native-work-reports",
			handlers: [
				{ id: "H", label: "H", actorId: "H" },
				{ id: "J", label: "J", actorId: "J" },
			],
		});
		const manager = service.connect({ id: "operator", role: () => "manager" as const, check() {} });
		const submitted = await manager.submit({
			requestId: "ticket",
			title: "Native work",
			body: "Draft one",
			sources: [],
		});
		ticketId = submitted.id;
		await manager.edit({
			requestId: "draft-two",
			id: ticketId,
			expectedVersion: 1,
			title: "Native work",
			body: "Draft two",
			sources: [],
		});
		await manager.edit({
			requestId: "draft-three",
			id: ticketId,
			expectedVersion: 2,
			title: "Native work",
			body: "ORIGINAL-REVISION-THREE",
			sources: [],
		});
		await manager.assign({ requestId: "assign-H", id: ticketId, expectedVersion: 3, handlerId: "H" });
		workId = (
			await manager.registerWork({
				requestId: "original-H",
				id: ticketId,
				expectedVersion: 4,
				handlerId: "H",
				contentRevision: 3,
				conversation: source,
			})
		).workId;
		await manager.assign({ requestId: "assign-J", id: ticketId, expectedVersion: 4, handlerId: "J" });
		await manager.edit({
			requestId: "J-future",
			id: ticketId,
			expectedVersion: 5,
			title: "J work",
			body: "J-PRIVATE-FUTURE",
			sources: [],
		});
		const before = (await manager.get(ticketId)).ticket;
		await m.runtime
			.root()
			.connect("operator", ["input.submit"])
			.submit({ key: "report", text: "Read the authorized original work and preserve its result." });
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 5);
		const results = m.f.requests
			.at(-1)!
			.messages.filter((message) => message.role === "tool")
			.map((message) => JSON.parse(String(message.content)));
		assert.equal(results[0].status, "ok");
		assert.equal(results[0].value.content.revision, 3);
		assert.equal(results[0].value.content.body, "ORIGINAL-REVISION-THREE");
		assert.equal(results[1].status, "ok");
		assert.equal(results[1].value.kind, "report");
		assert.equal(results[2].status, "ok");
		assert.equal(results[2].value.actorId, "H");
		assert.equal(results[2].value.revisionActorId, "H");
		assert.equal(results[2].value.contentRevision, 3);
		assert.equal(results[3].status, "denied");
		assert.equal(JSON.stringify(m.f.requests.at(-1)).includes("J-PRIVATE-FUTURE"), false);
		assert.deepEqual((await manager.get(ticketId)).ticket, before);
		assert.equal((await service.connect(H).reports({ id: ticketId })).items.length, 1);
		assert.equal(m.f.errors.length, 0);
		await assert.rejects(
			service.forInvocation({ actor: H, source }, captured).getWork({ id: ticketId, workId }),
			/denied/i,
		);
	} finally {
		pack.revoke();
		await m.close();
	}
});
