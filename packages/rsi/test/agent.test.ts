import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ToolInvocationScope, HostOptions, ConversationRef } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createTicketService, type NativeTicketService } from "../src/index.ts";

async function toolsFactory() {
	const module = await import(new URL("../src/agent.ts", import.meta.url).href).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
			return {};
		},
	);
	assert.equal(typeof module.createTicketTools, "function", "Native ticket tools are missing");
	return module.createTicketTools as (options: {
		resolve(scope: ToolInvocationScope): ReturnType<NativeTicketService["connect"]>;
	}) => {
		tools: NonNullable<HostOptions["tools"]>;
		instructions: string;
		revoke(): void;
	};
}

test("ticket tools: a real native call submits, then edits and queries the same durable ticket", async () => {
	const create = await toolsFactory();
	let service!: NativeTicketService, source!: ConversationRef, captured!: ToolInvocationScope;
	const actor = { id: "im-bot", role: () => "submitter" as const, check() {} };
	const pack = create({
		resolve: (scope) => {
			captured = scope;
			return service.forInvocation({ actor, source }, scope);
		},
	});
	const m = await runtimeFixture(
		{ tools: pack.tools, systemPrompt: pack.instructions },
		undefined,
		(payload) => {
			const results = payload.messages.filter((r) => r.role === "tool");
			if (results.length === 0)
				return {
					tool: "ticket_submit",
					args: {
						requestId: "im:message",
						title: "Shared FS",
						body: "Original observation",
						sources: ["https://example.org/message"],
					},
				};
			const first = JSON.parse(String(results[0]!.content));
			if (results.length === 1)
				return {
					tool: "ticket_edit",
					args: {
						requestId: "im:edit",
						id: first.value.id,
						expectedVersion: 1,
						title: "Shared FS revised",
						body: "Follow-up observation",
						sources: [],
					},
				};
			if (results.length === 2) return { tool: "ticket_get", args: { id: first.value.id } };
			return { text: "Ticket saved; continuing IM work." };
		},
	);
	try {
		source = m.runtime.view().conversations[0]!;
		service = await createTicketService({ runtime: m.runtime, namespace: "tools" });
		const host = await m.runtime.conversation(source);
		await host.connect("operator", ["input.submit"]).submit({ key: "start", text: "Record the idea" });
		await m.runtime.waitForIdle();
		const page = await service.connect(actor).list();
		assert.equal(page.items.length, 1);
		const view = await service.connect(actor).get(page.items[0]!.id);
		assert.equal(view.ticket.body, "Follow-up observation");
		assert.equal(view.ticket.revisions.length, 2);
		assert.equal(view.ticket.runs.length, 0);
		assert.equal(m.f.requests.length, 4);
		assert.ok(JSON.stringify(m.f.requests[3]).includes("Shared FS revised"));
		assert.equal(m.f.errors.length, 0);
		await assert.rejects(service.forInvocation({ actor, source }, captured).list(), /denied/i);
		await assert.rejects(service.forInvocation({ actor, source }, { ...captured }).list(), /denied/i);
		const submit = pack.tools.find((r) => r.name === "ticket_submit")!;
		const output = await submit.execute(
			{ requestId: "forged", title: "x", body: "x", sources: [] },
			undefined,
			{ ...captured },
		);
		assert.equal(JSON.parse(output).status, "denied");
		assert.equal((await service.connect(actor).list()).items.length, 1);
	} finally {
		pack.revoke();
		await m.close();
	}
});

test("ticket tools: revoking contribution during resolution blocks the native write and yields a bounded denial", async () => {
	const create = await toolsFactory();
	let service!: NativeTicketService, source!: ConversationRef;
	const actor = { id: "im-bot", role: () => "submitter" as const, check() {} };
	const pack = create({
		resolve: (scope) => {
			pack.revoke();
			return service.forInvocation({ actor, source }, scope);
		},
	});
	const m = await runtimeFixture({ tools: pack.tools }, undefined, (payload) =>
		payload.messages.some((r) => r.role === "tool")
			? { text: "Denied" }
			: { tool: "ticket_submit", args: { requestId: "revoked", title: "x", body: "x", sources: [] } },
	);
	try {
		source = m.runtime.view().conversations[0]!;
		service = await createTicketService({ runtime: m.runtime, namespace: "tools" });
		await m.runtime.root().connect("operator", ["input.submit"]).submit({ key: "start", text: "Submit" });
		await m.runtime.waitForIdle();
		assert.equal((await service.connect(actor).list()).items.length, 0);
		assert.ok(JSON.stringify(m.f.requests.at(-1)).includes("denied"));
	} finally {
		await m.close();
	}
});
