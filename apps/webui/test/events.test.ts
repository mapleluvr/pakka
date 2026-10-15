import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { PocketEvent } from "@pakka/protocol/pocket";
import { stream } from "./events.ts";
import { fixture } from "./fixture.ts";

function conversation(event: PocketEvent | null) {
	assert.ok(event?.kind === "conversation");
	return event;
}

// A missing snapshot/subscribe handoff would omit the card; a global channel would leak the peer canary.
test(
	"Pocket SSE: initial scoped snapshot and subsequent committed update cross the same real authorization boundary",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		let channel: Awaited<ReturnType<typeof stream>> | undefined;
		try {
			const privateRef = await m.client.create({ requestId: "hidden", name: "Hidden", profile: "default" });
			await m.client.display(privateRef, { requestId: "private", kind: "card", text: "SSE-PRIVATE-CANARY" });
			const invite = await m.people.invite(m.actor, {
				requestId: "observer",
				role: "viewer",
				resources: [m.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const visitor = await m.exchange(invite.token, "invite", "Observer");
			channel = await stream(m.http.origin, m.ref.conversationId, visitor.cookies);
			const first = conversation(await channel.next());
			assert.equal(first.snapshot.ref.conversationId, m.ref.conversationId);
			await m.client.display(m.ref, { requestId: "during-stream", kind: "chat", text: "STREAM-UPDATE" });
			const second = conversation(await channel.next());
			assert.ok(second.sequence > first.sequence);
			assert.equal(second.streamId, first.streamId);
			assert.ok(second.snapshot.entries.some((entry) => entry.display?.text === "STREAM-UPDATE"));
			assert.equal(JSON.stringify(second).includes("SSE-PRIVATE-CANARY"), false);
			const actor = await m.people.authenticate(/pakka_pocket=([^;]+)/.exec(visitor.cookies)![1]!);
			await m.people.revokePerson(m.actor, actor.person.id);
			assert.equal(await channel.next(), null);
			const denied = await fetch(m.http.origin + "/pocket/events?conversationId=" + m.ref.conversationId, {
				headers: { Cookie: visitor.cookies },
			});
			assert.equal(denied.status, 401);
			assert.equal(m.f.requests.length, 0);
		} finally {
			channel?.close();
			await m.close();
		}
	},
);

// Reusing a cursor from any old/foreign incarnation must resnapshot, never replay a mutation or assume its authority.
test(
	"Pocket SSE: reconnect with stale cursor explicitly resnapshots current authorized state",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		let old: Awaited<ReturnType<typeof stream>> | undefined,
			fresh: Awaited<ReturnType<typeof stream>> | undefined;
		try {
			old = await stream(m.http.origin, m.ref.conversationId, m.admin.cookies);
			const first = conversation(await old.next());
			old.close();
			await m.client.display(m.ref, {
				requestId: "offline",
				kind: "card",
				text: "MISSED-WHILE-DISCONNECTED",
			});
			fresh = await stream(
				m.http.origin,
				m.ref.conversationId,
				m.admin.cookies,
				`${first.serverId}:${first.streamId}:${first.sequence}`,
			);
			assert.equal((await fresh.next())?.kind, "resnapshot");
			const current = conversation(await fresh.next());
			assert.notEqual(current.streamId, first.streamId);
			assert.ok(
				current.snapshot.entries.some((entry) => entry.display?.text === "MISSED-WHILE-DISCONNECTED"),
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			old?.close();
			fresh?.close();
			await m.close();
		}
	},
);
