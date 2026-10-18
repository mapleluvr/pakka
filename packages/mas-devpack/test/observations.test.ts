import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas } from "@pakka/mas";
import { createPocketPeople, type PocketAuthority } from "@pakka/server/pocket";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMasWorkbench, type WorkbenchAuthority } from "../src/workbench.ts";
import { projectActivity } from "../src/activity.ts";
import type { ConversationSnapshot } from "@pakka/agent";

function snapshot(parts: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
	return {
		ref: { key: "x", sessionId: "s", conversationId: "1", profile: "default", incarnation: "i" },
		entries: [],
		entriesTruncated: false,
		live: { busy: false, tools: [] },
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: null },
		...parts,
	};
}
test("Board activity: projects waiting, public thinking, tool arguments by callId, reply and genuine errors", () => {
	assert.equal(
		projectActivity(snapshot()).state,
		"idle",
		"An available Conversation without live work is not waiting for a model reply",
	);
	assert.equal(projectActivity(snapshot({ live: { busy: true, tools: [] } })).state, "waiting");
	assert.equal(
		projectActivity(
			snapshot({
				live: {
					busy: true,
					tools: [],
					message: { role: "assistant", content: [{ type: "thinking", thinking: "PUBLIC-THINKING" }] },
				},
			}),
		).preview,
		"PUBLIC-THINKING",
	);
	for (const { content, want } of [
		{
			content: [
				{ type: "thinking" as const, thinking: "EARLIER-THINKING" },
				{ type: "text" as const, text: "CURRENT-REPLY" },
			],
			want: { state: "reply", preview: "CURRENT-REPLY" },
		},
		{
			content: [
				{ type: "text" as const, text: "EARLIER-REPLY" },
				{ type: "thinking" as const, thinking: "CURRENT-THINKING" },
			],
			want: { state: "thinking", preview: "CURRENT-THINKING" },
		},
	])
		assert.deepEqual(
			projectActivity(snapshot({ live: { busy: true, tools: [], message: { role: "assistant", content } } })),
			want,
			"Activity follows the latest nonempty native content part",
		);
	assert.equal(
		projectActivity(
			snapshot({
				live: {
					busy: true,
					tools: [],
					message: {
						role: "assistant",
						stopReason: "error",
						errorMessage: "ACTUAL-FAILURE",
						content: [{ type: "thinking", thinking: "EARLIER-THINKING" }],
					},
				},
			}),
		).state,
		"error",
		"A recorded terminal error wins over retained thinking during native cleanup",
	);
	const tooling = projectActivity(
		snapshot({
			live: {
				busy: true,
				tools: [{ callId: "second", name: "read", status: "running" }],
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "first", name: "wrong", arguments: { file: "WRONG" } },
						{ type: "toolCall", id: "second", name: "read", arguments: { file: "REAL-FILE" } },
					],
				},
			},
		}),
	);
	assert.equal(tooling.state, "tool");
	assert.equal(tooling.tool, "read");
	assert.match(tooling.preview, /REAL-FILE/);
	assert.doesNotMatch(tooling.preview, /WRONG/);
	const entry = {
		id: "1",
		conversationId: "1",
		kind: "test",
		messages: [{ role: "assistant" as const, content: [{ type: "text", text: "ACTUAL-REPLY" }] }],
	};
	assert.ok(
		projectActivity(
			snapshot({
				entries: [
					{
						...entry,
						messages: [
							{ role: "assistant", content: [], stopReason: "error", errorMessage: "x".repeat(9000) },
						],
					},
				],
			}),
		).detail!.length <= 244,
		"Activity details are bounded; the full error remains in the Conversation",
	);
	assert.equal(projectActivity(snapshot({ entries: [entry] })).preview, "ACTUAL-REPLY");
	const failed = projectActivity(
		snapshot({
			entries: [
				{
					...entry,
					messages: [
						{ role: "assistant", content: [], stopReason: "error", errorMessage: "429 Too Many Requests" },
					],
				},
			],
		}),
	);
	assert.equal(failed.code, undefined, "Unstructured provider text is not converted to a status code");
	assert.equal(failed.preview, "429 Too Many Requests");
	assert.equal(
		projectActivity(
			snapshot({
				entries: [
					{
						...entry,
						messages: [
							{ role: "assistant", content: [], stopReason: "error", errorMessage: "429 Too Many Requests" },
						],
					},
				],
			}),
			{ phase: "failed", reason: "Provider rejected request" },
		).state,
		"error",
		"A known HTTP failure remains distinct from a Conversation crash",
	);
	assert.equal(
		projectActivity(snapshot({ entries: [entry] }), { phase: "failed", reason: "Known native task fault" })
			.state,
		"crashed",
	);
	assert.equal(
		projectActivity(
			snapshot({
				entries: [
					{
						...entry,
						messages: [
							{ role: "assistant", content: [{ type: "text", text: "The file mentions HTTP 500" }] },
						],
					},
				],
			}),
		).state,
		"reply",
		"Arbitrary reply text is not an HTTP error",
	);
});

test("Board observations: read-only history filters both endpoints before search/pagination and redacts provenance", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "observation.people" }),
			session = await people.initializeOwner("Owner"),
			owner = await people.authenticate(session.token);
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "observation.mas",
			maxDeliveries: 24,
			maxPending: 4,
		});
		await mas.bootstrap([
			{ key: "a", owner: session.person.id },
			{ key: "PRIVATE-AGENT-CANARY", owner: session.person.id },
		]);
		await mas.activate();
		const [a, secret] = (await mas.view()).members;
		const creator = mas.connect({
			principal: "not-an-agent-owner-alias",
			source: secret!.ref,
			grants: ["spawn"],
		});
		const b = await creator.spawn({ key: "b" });
		const invite = await people.invite(owner, {
			requestId: "reader",
			role: "viewer",
			resources: [a!.ref.conversationId, b.ref.conversationId],
			ttlMs: 60000,
		});
		const reader = await people.authenticate((await people.redeem(invite.token!, "Viewer")).token);
		const authority = (actor: PocketAuthority): WorkbenchAuthority => ({
			id: people.current(actor).id,
			current: () => {
				people.current(actor);
			},
			check: (permission, ref) => people.check(actor, permission, ref?.conversationId),
		});
		const board = createMasWorkbench({ mas, runtime: m.runtime }),
			admin = board.bind(authority(owner)),
			viewer = board.bind(authority(reader));
		const peer = mas.connect({ principal: "peer-a", source: a!.ref, grants: ["send", "observe"] });
		const allowed = await peer.send(b.ref, { requestId: "visible", text: "VISIBLE-MESSAGE" });
		await peer.wait(allowed.id);
		const hidden = await peer.send(secret!.ref, { requestId: "hidden", text: "PRIVATE-BODY-CANARY" });
		await peer.wait(hidden.id);
		const readable = await viewer.history({ limit: 1 });
		assert.equal(readable.items.length, 1);
		assert.equal(readable.items[0]!.receipt.id, allowed.id);
		assert.equal(readable.nextCursor, undefined, "No hidden count/cursor is published");
		assert.doesNotMatch(JSON.stringify(readable), /PRIVATE-/);
		const view = await viewer.view();
		assert.doesNotMatch(JSON.stringify(view), /PRIVATE-/);
		assert.equal(view.members.find((row) => row.key === "b")!.creator, null);
		const adminView = await admin.view();
		assert.equal(
			adminView.members.find((row) => row.key === "b")!.creator,
			secret!.key,
			"Creation does not require owner-principal matching",
		);
		assert.ok(
			adminView.connections.some(
				(row) => row.kind === "communication" && row.from === "a" && row.to === "b" && row.count === 1,
			),
		);
		await assert.rejects(viewer.history({ from: secret!.key }));
		assert.equal((await viewer.history({ search: "PRIVATE-BODY-CANARY" })).items.length, 0);
		await assert.rejects(
			viewer.receipt(allowed.id),
			/authority|denied/i,
			"Observing a message does not grant sender receipt/wait authority",
		);
		const activities = await viewer.activities([a!.ref, b.ref]);
		assert.equal(activities.length, 2);
		assert.deepEqual(
			activities.map((row) => row.ref),
			[a!.ref, b.ref],
			"Activity results retain the MAS catalog aliases requested by the Board",
		);
		const humanReply = await admin.reply(b.ref, allowed.id, {
			requestId: "human-reply",
			text: "HUMAN-REPLY",
		});
		await peer.wait(humanReply.id);
		const unrelated = await peer.send(a!.ref, { requestId: "unrelated", text: "ROOT-ONLY" });
		await peer.wait(unrelated.id);
		const allHistory = await viewer.history({});
		assert.equal(allHistory.items.find((row) => row.receipt.id === humanReply.id)!.initiator, "human");
		assert.equal(allHistory.items.find((row) => row.receipt.id === humanReply.id)!.replyTo, allowed.id);
		assert.equal((await viewer.history({ member: "b" })).items.length, 2);
		assert.equal((await viewer.history({ initiator: "human" })).items.length, 1);
		assert.equal((await viewer.history({ mode: "steer" })).items.length, 0);
		assert.equal((await viewer.history({ status: "queued" })).items.length, 0);
		assert.deepEqual(
			(await viewer.history({ from: "a", to: "b", limit: 1 })).items.map((row) => row.receipt.id),
			[allowed.id],
		);
		const memberPage = await viewer.history({ member: "b", limit: 1 });
		assert.ok(memberPage.nextCursor);
		const olderMemberPage = await viewer.history({ member: "b", limit: 1, cursor: memberPage.nextCursor });
		assert.deepEqual(
			[...memberPage.items, ...olderMemberPage.items].map((row) => row.receipt.id),
			[humanReply.id, allowed.id],
		);
		assert.equal(olderMemberPage.nextCursor, undefined);
		let scopeRevoked = false;
		const lateRevocation = createMasWorkbench({
			runtime: m.runtime,
			mas: {
				...mas,
				history: async (...args) => {
					const page = await mas.history(...args);
					scopeRevoked = true;
					return page;
				},
			},
		}).bind({
			...authority(reader),
			check(permission, ref) {
				if (scopeRevoked && ref.conversationId === b.ref.conversationId) throw Error("ENDPOINT-REVOKED");
				people.check(reader, permission, ref.conversationId);
			},
		});
		await assert.rejects(lateRevocation.history({ from: "a", to: "b" }), /ENDPOINT-REVOKED/);
		const calls = m.f.requests.length;
		await viewer.history({});
		await viewer.view();
		await viewer.activities([a!.ref]);
		assert.equal(m.f.requests.length, calls);
		await people.revokePerson(owner, reader.person.id);
		await assert.rejects(viewer.history({}));
		await assert.rejects(viewer.activities([a!.ref]));
	} finally {
		await m.close();
	}
});
