import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";

test(
	"WebUI observer scope: current cookie must match the expected public person/server before any shared-worker bytes",
	{ timeout: 10000 },
	async () => {
		const m = await fixture();
		try {
			const query = new URLSearchParams({
				mode: "preview",
				sessionId: m.ref.sessionId,
				conversationId: m.ref.conversationId,
				expectedPersonId: m.actor.person.id,
				expectedServerId: m.http.serverId,
			});
			const controller = new AbortController();
			const ok = await fetch(m.http.origin + "/pocket/events?" + query, {
				headers: { Origin: m.http.origin, Cookie: m.admin.cookies },
				signal: controller.signal,
			});
			assert.equal(ok.status, 200);
			controller.abort();
			const foreign = new URLSearchParams(query);
			foreign.set("expectedPersonId", "another-person");
			const denied = await fetch(m.http.origin + "/pocket/events?" + foreign, {
				headers: { Origin: m.http.origin, Cookie: m.admin.cookies },
			});
			assert.equal(denied.status, 403);
			assert.notEqual(denied.headers.get("content-type"), "text/event-stream; charset=utf-8");
			const old = new URLSearchParams(query);
			old.set("expectedServerId", "another-server");
			const stale = await fetch(m.http.origin + "/pocket/events?" + old, {
				headers: { Origin: m.http.origin, Cookie: m.admin.cookies },
			});
			assert.equal(stale.status, 403);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
