import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas } from "../src/index.ts";
import type { MasClient, Member } from "../src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { text } from "../../agent/test/fixture.ts";

// Removing the owner checks or native atomic ref/config updates would fail these real HTTP cases.
test("M2 MAS: configure selects approved profile, revokes old ref and forks retain bounded history", async () => {
	const m = await runtimeFixture({ profiles: [{ id: "quiet", systemPrompt: "QUIET-PROFILE", tools: [] }] });
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "control",
			maxDeliveries: 16,
			maxPending: 3,
		});
		await mas.bootstrap([{ key: "a", owner: "operator" }]);
		await mas.activate();
		const original = (await mas.view()).members[0]!;
		const admin = mas.connect({
			principal: "operator",
			source: null,
			grants: ["configure", "fork", "send", "observe", "retire"],
		});
		const outsider = mas.connect({
			principal: "outsider",
			source: null,
			grants: ["configure", "fork", "send"],
		});
		assert.equal(typeof admin.configure, "function", "approved-profile control is required");
		await assert.rejects(outsider.configure(original.ref, "quiet"), /owner/);
		await assert.rejects(admin.configure(original.ref, "unapproved"), /profile/);
		const configured = await admin.configure(original.ref, "quiet");
		assert.notEqual(configured.ref.incarnation, original.ref.incarnation);
		await assert.rejects(
			admin.send(original.ref, { requestId: "stale", text: "OLD-PROFILE-REF" }),
			/reference/,
		);
		const first = await admin.send(configured.ref, { requestId: "seed", text: "FORK-HISTORY" });
		await admin.wait(first.id);
		assert.match(text(m.f.requests[0]!), /QUIET-PROFILE/);
		const cutoff = (await m.runtime.conversation(configured.ref))
			.view()
			.entries.find((e) => e.role === "user")!.id;
		await assert.rejects(outsider.fork(configured.ref, { key: "denied", entryId: cutoff }), /owner/);
		const child = await admin.fork(configured.ref, { key: "fork", entryId: cutoff });
		assert.notEqual(child.ref.conversationId, configured.ref.conversationId);
		const sent = await admin.send(child.ref, { requestId: "child", text: "AFTER-FORK" });
		await admin.wait(sent.id);
		assert.match(text(m.f.requests[1]!), /FORK-HISTORY/);
		assert.match(text(m.f.requests[1]!), /AFTER-FORK/);
		assert.equal(m.f.requests.length, 2);
		await admin.retire(child.ref);
		assert.equal((await admin.inspect(child.ref)).phase, "retired");
		await assert.rejects(admin.send(child.ref, { requestId: "retired", text: "DENIED" }), /retired|inactive/);
		assert.equal(m.f.requests.length, 2);
	} finally {
		await m.close();
	}
});

// Removing tombstone precedence would report ended after the actual owner/anchor stops.
for (const lifetime of ["task-bound", "background"] as const)
	test(`M2 MAS: retired ${lifetime} member keeps its tombstone in inspect`, async () => {
		let source!: MasClient, child!: Member;
		const m = await runtimeFixture(
			{
				tools: [
					{
						name: "spawn_member",
						description: "create native owned member",
						parameters: { type: "object", properties: {} },
						execute: async (_args, _signal, scope) => {
							child = await source.forInvocation(scope).spawn({ key: "child", lifetime });
							return "SPAWNED";
						},
					},
				],
			},
			undefined,
			(payload) =>
				payload.messages.some((message) => message.role === "tool")
					? { text: "finished" }
					: { tool: "spawn_member" },
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "retire-" + lifetime,
				maxDeliveries: 8,
				maxPending: 2,
			});
			await mas.bootstrap([{ key: "parent", owner: "operator" }]);
			await mas.activate();
			const parent = (await mas.view()).members[0]!;
			source = mas.connect({ principal: "operator", source: parent.ref, grants: ["spawn"] });
			const admin = mas.connect({
				principal: "operator",
				source: null,
				grants: ["send", "retire", "observe"],
			});
			await admin.wait((await admin.send(parent.ref, { requestId: "spawn", text: "SPAWN" })).id);
			assert.ok(
				(
					await m.runtime
						.catalog({ namespace: "retire-" + lifetime, maxDeliveries: 8, maxPending: 2 })
						.snapshot()
				).members.find((entry) => entry.key === "child")!.ownerTaskId,
			);
			await admin.retire(child.ref);
			assert.equal((await admin.inspect(child.ref)).phase, "retired");
			assert.equal((await mas.view()).members.find((entry) => entry.key === "child")!.phase, "retired");
			await assert.rejects(
				admin.send(child.ref, { requestId: "denied", text: "DENIED" }),
				/retired|inactive/,
			);
			assert.equal(m.f.requests.length, 2);
		} finally {
			await m.close();
		}
	});

test("M2 MAS: readiness recovery removes stale diagnostic reason", async () => {
	const m = await runtimeFixture();
	try {
		const config = { namespace: "readiness-reason", maxDeliveries: 8, maxPending: 2 };
		const catalog = m.runtime.catalog(config);
		await catalog.enroll(
			[{ key: "a", data: { owner: "operator", phase: "preparing", reason: "old-readiness-failure" } }],
			() => {},
		);
		const mas = await createMas({ runtime: m.runtime, ...config });
		await mas.bootstrap([{ key: "a", owner: "operator" }]);
		await mas.activate();
		assert.equal((await mas.view()).members[0]!.phase, "active");
		assert.equal((await mas.view()).members[0]!.reason, undefined);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
