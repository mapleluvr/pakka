import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fixture } from "./fixture.ts";

const change = (
	target: unknown,
	requestId: string,
	expectedVersion: number,
	name: string,
	archived: boolean,
) => ({
	op: "conversation.set",
	target,
	input: { requestId, expectedVersion, name, archived },
});

test("Pocket navigation metadata: real HTTP CAS, original receipts, archive/restore and current role/resource boundaries", async () => {
	const m = await fixture();
	try {
		const initial = await m.rpc({ op: "list" });
		assert.ok("result" in initial.decoded && initial.decoded.result.kind === "list");
		const renamed = await m.rpc(change(m.ref, "rename", 0, "Renamed canary", false));
		assert.equal(renamed.response.status, 200);
		assert.ok("result" in renamed.decoded && renamed.decoded.result.kind === "metadata");
		assert.equal(renamed.decoded.result.metadata.name, "Renamed canary");
		assert.equal(renamed.decoded.result.metadata.version, 1);
		const stale = await m.rpc(change(m.ref, "stale", 0, "Overwrite", true));
		assert.equal(stale.response.status, 409);
		const archived = await m.rpc(change(m.ref, "archive", 1, "Renamed canary", true));
		assert.equal(archived.response.status, 200);
		const replay = await m.rpc(change(m.ref, "rename", 0, "Renamed canary", false));
		assert.deepEqual(
			replay.decoded && "result" in replay.decoded && replay.decoded.result,
			renamed.decoded.result,
			"original receipt survives later mutations; no old mutation is repeated",
		);
		assert.equal((await m.rpc(change(m.ref, "rename", 2, "Changed replay", false))).response.status, 409);
		const list = await m.rpc({ op: "list" });
		assert.ok("result" in list.decoded && list.decoded.result.kind === "list");
		assert.equal(list.decoded.result.states?.[m.ref.conversationId]?.archived, true);
		assert.equal(list.decoded.result.states?.[m.ref.conversationId]?.version, 2);
		assert.equal(
			(await m.rpc({ op: "read", target: m.ref })).response.status,
			200,
			"archive is metadata, not revocation or deletion",
		);
		const invite = await m.people.invite(m.actor, {
			requestId: "viewer",
			role: "viewer",
			resources: [m.ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const viewer = await m.exchange(invite.token, "invite", "Viewer");
		assert.equal(
			(await m.rpc(change(m.ref, "viewer-write", 2, "Forbidden", false), viewer)).response.status,
			403,
		);
		const privateRef = await m.client.create({
			requestId: "private",
			name: "PRIVATE-NAVIGATION-CANARY",
			profile: "default",
		});
		const scoped = await m.rpc({ op: "list" }, viewer);
		assert.ok(!JSON.stringify(scoped.decoded).includes("PRIVATE-NAVIGATION-CANARY"));
		assert.ok("result" in scoped.decoded && scoped.decoded.result.kind === "list");
		assert.ok(
			scoped.decoded.result.conversations.every((row) => row.conversationId !== privateRef.conversationId),
		);
		assert.equal(Object.hasOwn(scoped.decoded.result.titles ?? {}, privateRef.conversationId), false);
		assert.equal(Object.hasOwn(scoped.decoded.result.states ?? {}, privateRef.conversationId), false);
		assert.equal(
			(await m.rpc(change(privateRef, "foreign", 0, "Forbidden", false), viewer)).response.status,
			403,
		);
		assert.equal((await m.rpc(change(m.ref, "restore", 2, "Restored", false))).response.status, 200);
		const sent = await m.rpc({
			op: "submit",
			target: m.ref,
			input: { requestId: "explicit", text: "EXPLICIT-NATIVE-INPUT", mode: "prompt" },
		});
		assert.ok("result" in sent.decoded && sent.decoded.result.kind === "receipt");
		await m.rpc({ op: "wait", id: sent.decoded.result.receipt.id });
		assert.equal(m.f.requests.length, 1);
		assert.doesNotMatch(JSON.stringify(m.f.requests), /Renamed canary|Restored|PRIVATE-NAVIGATION-CANARY/);
	} finally {
		await m.close();
	}
});

test("Pocket navigation metadata: malformed fields, stale incarnation and revoked actors cannot mutate state", async () => {
	const m = await fixture();
	try {
		for (const command of [
			change(m.ref, "empty", 0, " ", false),
			change(m.ref, "control", 0, "bad\nname", false),
			change(m.ref, "long", 0, "x".repeat(81), false),
			change(m.ref, "negative", -1, "valid", false),
			{ ...change(m.ref, "extra", 0, "valid", false), sideEffect: true },
		])
			assert.equal((await m.rpc(command)).response.status, 400);
		const next = await m.client.configure(m.ref, "default");
		assert.notEqual(next.incarnation, m.ref.incarnation);
		assert.notEqual(
			(await m.rpc(change(m.ref, "stale-ref", 0, "Old incarnation", false))).response.status,
			200,
		);
		const driverInvite = await m.people.invite(m.actor, {
			requestId: "driver",
			role: "driver",
			resources: [next.conversationId],
			ttlMs: 60000,
		});
		assert.ok(driverInvite.token);
		const driver = await m.exchange(driverInvite.token, "invite", "Driver");
		assert.equal(
			(await m.rpc(change(next, "driver-change", 0, "Denied driver name", false), driver)).response.status,
			403,
			"driver has native steering, not manage authority",
		);
		const invite = await m.people.invite(m.actor, {
			requestId: "scoped-admin",
			role: "admin",
			resources: [next.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const scopedAdmin = await m.exchange(invite.token, "invite", "Scoped admin");
		assert.equal(
			(await m.rpc(change(next, "admin-change", 0, "Admin name", false), scopedAdmin)).response.status,
			200,
		);
		const people = await m.people.list(m.actor);
		await m.people.revokePerson(m.actor, people.people.find((p) => p.name === "Scoped admin")!.id);
		assert.equal(
			(await m.rpc(change(next, "revoked", 1, "Revoked", true), scopedAdmin)).response.status,
			401,
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
