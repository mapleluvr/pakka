import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fixture } from "./fixture.ts";

test(
	"WebUI HTTP preview: large display stays summarized and original ranges remain permission-bound without model work",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const body = "original-display-line\n".repeat(700);
			await m.client.display(m.ref, { requestId: "large-display", kind: "card", text: body });
			const reply = await m.rpc({ op: "preview", target: m.ref, page: { limit: 32, maxBytes: 16384 } });
			assert.equal(reply.response.status, 200);
			assert.ok("result" in reply.decoded && reply.decoded.result.kind === "conversation");
			const snapshot = reply.decoded.result.snapshot;
			assert.ok(Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= 16384);
			const display = snapshot.entries.find((entry) => entry.display?.requestId === "large-display")?.display;
			assert.ok(display?.contentReference);
			assert.ok(display.text.length < body.length);
			const reference = display.contentReference;
			const original = await m.rpc({
				op: "content.read",
				target: m.ref,
				reference,
				range: { offset: 0, length: 65536 },
			});
			assert.equal(original.response.status, 200);
			assert.ok("result" in original.decoded && original.decoded.result.kind === "content");
			assert.equal(original.decoded.result.chunk.text, body);
			assert.equal(original.decoded.result.chunk.complete, true);
			const other = await m.client.create({ requestId: "another", name: "Other", profile: "default" });
			const forged = await m.rpc({
				op: "content.read",
				target: other,
				reference,
				range: { offset: 0, length: 65536 },
			});
			assert.notEqual(forged.response.status, 200);
			assert.equal(JSON.stringify(forged.decoded).includes("original-display-line"), false);
			const oversized = await m.rpc({
				op: "content.read",
				target: m.ref,
				reference,
				range: { offset: 0, length: 65537 },
			});
			assert.equal(oversized.response.status, 400);
			const invitation = await m.people.invite(m.actor, {
				requestId: "content-viewer",
				role: "viewer",
				resources: [m.people.resourceId(m.ref)],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewer = await m.exchange(invitation.token, "invite", "Reader");
			assert.equal(viewer.response.status, 200);
			const viewerActor = await m.people.authenticate(/pakka_pocket=([^;]+)/.exec(viewer.cookies)![1]!);
			const readable = await m.rpc(
				{ op: "content.read", target: m.ref, reference, range: { offset: 0, length: 65536 } },
				viewer,
			);
			assert.equal(readable.response.status, 200);
			await m.people.revokePerson(m.actor, viewerActor.person.id);
			const revoked = await m.rpc(
				{ op: "content.read", target: m.ref, reference, range: { offset: 0, length: 65536 } },
				viewer,
			);
			assert.equal(revoked.response.status, 401);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
