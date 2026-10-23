import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fixture } from "./fixture.ts";

// This would fail if WebUI cookie auth were translated into unscoped v1 privileges or display became model input.
test(
	"WebUI HTTP: real cookie workbench negotiates v2, records human card, admits native work and recovers its receipt",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const hello = await m.rpc({ op: "hello" });
			assert.ok("result" in hello.decoded && hello.decoded.result.kind === "hello");
			const list = await m.rpc({ op: "list" });
			assert.ok("result" in list.decoded && list.decoded.result.kind === "list");
			assert.deepEqual(list.decoded.result.conversations, [m.ref]);
			await m.rpc({
				op: "display",
				target: m.ref,
				requestId: "card",
				kind: "card",
				text: "HUMAN-CARD-EXCLUDED",
			});
			const input = {
				op: "submit",
				target: m.ref,
				input: { requestId: "stable", text: "REAL-WEB-WORK", mode: "prompt" },
			};
			const first = await m.rpc(input);
			assert.ok("result" in first.decoded && first.decoded.result.kind === "receipt");
			const done = await m.rpc({ op: "wait", id: first.decoded.result.receipt.id });
			assert.ok("result" in done.decoded && done.decoded.result.kind === "receipt");
			assert.equal(done.decoded.result.receipt.status, "done");
			const second = await m.rpc(input);
			assert.ok("result" in second.decoded && second.decoded.result.kind === "receipt");
			assert.equal(second.decoded.result.receipt.id, first.decoded.result.receipt.id);
			const read = await m.rpc({ op: "read", target: m.ref });
			assert.ok("result" in read.decoded && read.decoded.result.kind === "conversation");
			assert.ok(read.decoded.result.snapshot.entries.some((e) => e.display?.text === "HUMAN-CARD-EXCLUDED"));
			assert.equal(m.f.requests.length, 1);
			assert.equal(JSON.stringify(m.f.requests).includes("HUMAN-CARD-EXCLUDED"), false);
			const rotate = await m.rpc({ op: "session.rotate" });
			assert.equal(rotate.response.status, 200);
			assert.equal((await m.rpc({ op: "list" })).response.status, 401);
		} finally {
			await m.close();
		}
	},
);

// Foreign Origin, missing CSRF and browser-supplied identity must be refused before either UI state or model effects.
test(
	"WebUI HTTP: authentication, host/origin/CSRF and finite envelopes fence the real native effects",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const invalidHeaders: Record<string, string>[] = [
				{ Origin: "https://foreign.invalid", Cookie: m.admin.cookies, "X-Pakka-CSRF": m.admin.csrf },
				{ Origin: m.http.origin, Cookie: m.admin.cookies },
				{ Origin: m.http.origin, "X-Pakka-CSRF": m.admin.csrf },
			];
			for (const headers of invalidHeaders) {
				const response = await fetch(m.http.origin + "/pocket/rpc", {
					method: "POST",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify({
						version: 2,
						requestId: "bad",
						command: {
							op: "submit",
							target: m.ref,
							input: { requestId: "bad", text: "FORBIDDEN", mode: "prompt" },
						},
					}),
				});
				assert.ok([401, 403].includes(response.status));
			}
			const forged = await fetch(m.http.origin + "/pocket/rpc", {
				method: "POST",
				headers: {
					Origin: m.http.origin,
					Cookie: m.admin.cookies,
					"X-Pakka-CSRF": m.admin.csrf,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					version: 2,
					requestId: "bad",
					command: { op: "list", actorId: m.actor.person.id },
				}),
			});
			assert.equal(forged.status, 400);
			const forwarded = await fetch(m.http.origin + "/pocket/rpc", {
				method: "POST",
				headers: {
					Origin: m.http.origin,
					Cookie: m.admin.cookies,
					"X-Pakka-CSRF": m.admin.csrf,
					"X-Forwarded-Host": "evil.invalid",
					"X-Forwarded-Proto": "https",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ version: 2, requestId: "bad", command: { op: "list" } }),
			});
			assert.equal(forwarded.status, 403);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);

// Filtering after sending data to the browser would leak the private card even if the navigation hid it.
test(
	"WebUI HTTP: one-time invited viewer receives only its authorized resource and cannot drive or retain revoked access",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const other = await m.client.create({ requestId: "private", name: "Private", profile: "default" });
			await m.client.display(other, { requestId: "canary", kind: "card", text: "PRIVATE-RESOURCE-CANARY" });
			const invite = await m.people.invite(m.actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [m.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const results = await Promise.all([
				m.exchange(invite.token, "invite", "Visitor"),
				m.exchange(invite.token, "invite", "Visitor"),
			]);
			assert.deepEqual(results.map((r) => r.response.status).sort(), [200, 401]);
			const viewer = results.find((r) => r.response.status === 200)!;
			const list = await m.rpc({ op: "list" }, viewer);
			assert.ok("result" in list.decoded && list.decoded.result.kind === "list");
			assert.deepEqual(list.decoded.result.conversations, [m.ref]);
			const privateRead = await m.rpc({ op: "read", target: other }, viewer);
			assert.equal(privateRead.response.status, 403);
			assert.equal(JSON.stringify(privateRead.decoded).includes("PRIVATE-RESOURCE-CANARY"), false);
			const denied = await m.rpc(
				{ op: "submit", target: m.ref, input: { requestId: "forbidden", text: "Forbidden", mode: "prompt" } },
				viewer,
			);
			assert.equal(denied.response.status, 403);
			const actor = await m.people.authenticate(/pakka_pocket=([^;]+)/.exec(viewer.cookies)![1]!);
			await m.people.revokePerson(m.actor, actor.person.id);
			assert.equal((await m.rpc({ op: "list" }, viewer)).response.status, 401);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
