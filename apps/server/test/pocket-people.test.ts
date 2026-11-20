import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";

// Removing persisted role/resource checks would let a guessed Conversation become a readable resource.
test("WebUI people: a redeemed viewer sees only its granted resources and never receives a write grant", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const owner = await people.initializeOwner("Owner");
		const admin = await people.authenticate(owner.token);
		const root = m.runtime.view().conversations[0]!;
		const peer = await m.runtime.createConversation({ key: "private-peer" });
		const link = await people.invite(admin, {
			requestId: "viewer-one",
			role: "viewer",
			resources: [root.conversationId],
			ttlMs: 60_000,
		});
		assert.ok(link.token);
		const viewer = await people.redeem(link.token, "Visitor");
		const auth = await people.authenticate(viewer.token);
		assert.equal(Object.isFrozen(auth.person), true);
		auth.check("read", root.conversationId);
		assert.throws(() => auth.check("read", peer.conversationId), /denied/i);
		assert.throws(() => auth.check("send", root.conversationId), /denied/i);
		assert.throws(() => auth.check("extensions.install"), /denied/i);
		assert.throws(() => auth.verifyCsrf("forged-csrf"), /denied/i);
		auth.verifyCsrf(viewer.csrf);
		await assert.rejects(
			people.invite(auth, { requestId: "escalate", role: "admin", resources: "*", ttlMs: 60_000 }),
			/denied/i,
		);
		await assert.rejects(
			people.invite({ ...admin }, { requestId: "copied", role: "admin", resources: "*", ttlMs: 60_000 }),
			/authority|denied/i,
		);
		const persisted = JSON.stringify(
			(await m.runtime.store({ namespace: "test-people", maxBytes: 262144 }).snapshot()).data,
		);
		for (const secret of [owner.token, owner.csrf, viewer.token, viewer.csrf, link.token])
			assert.equal(persisted.includes(secret), false);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// Non-atomic redemption would give both independent callers a valid session from one invitation.
test("WebUI people: concurrent one-time redemption grants exactly one session and retries do not mint invitations", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const owner = await people.initializeOwner("Owner");
		const admin = await people.authenticate(owner.token);
		const root = m.runtime.view().conversations[0]!;
		const input = {
			requestId: "single",
			role: "sender" as const,
			resources: [root.conversationId],
			ttlMs: 60_000,
		};
		const store = m.runtime.store({ namespace: "test-people", maxBytes: 262144 });
		const before = await store.snapshot();
		assert.equal(await people.lookupInvite(admin, input), null);
		assert.deepEqual(await store.snapshot(), before, "an absent lookup must not create an invitation");
		const link = await people.invite(admin, input);
		assert.ok(link.token);
		const created = await store.snapshot();
		assert.deepEqual(await people.lookupInvite(admin, input), link.invite);
		await assert.rejects(people.lookupInvite(admin, { ...input, ttlMs: 60_001 }), /conflict/i);
		assert.deepEqual(await store.snapshot(), created, "lookup must not write or retain a replayable secret");
		const repeat = await people.invite(admin, input);
		assert.equal(repeat.invite.id, link.invite.id);
		assert.equal(repeat.token, null, "a previously returned secret is not kept for replay");
		await assert.rejects(people.invite(admin, { ...input, role: "admin" }), /conflict/i);
		const race = await Promise.allSettled([
			people.redeem(link.token, "First"),
			people.redeem(link.token, "Second"),
		]);
		assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
		assert.equal(race.filter((r) => r.status === "rejected").length, 1);
		const issued = race.find((r) => r.status === "fulfilled");
		assert.ok(issued?.status === "fulfilled");
		const auth = await people.authenticate(issued.value.token);
		await assert.rejects(people.lookupInvite(auth, input), /denied/i);
		auth.check("send", root.conversationId);
		assert.throws(() => auth.check("steer", root.conversationId), /denied/i);
		assert.equal((await people.list(admin)).people.length, 2);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// Restoring an owner from bootstrap options or not persisting revocation would revive old authority on reopen.
test("WebUI people: normal writer reopen preserves identity and revocation while old bound checks fail", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		let people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const owner = await people.initializeOwner("Owner");
		let admin = await people.authenticate(owner.token);
		const root = m.runtime.view().conversations[0]!;
		const original = {
			requestId: "reopen",
			role: "driver" as const,
			resources: [root.conversationId],
			ttlMs: 60_000,
		};
		const invite = await people.invite(admin, original);
		assert.ok(invite.token);
		const user = await people.redeem(invite.token, "Driver");
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		people = await createPocketPeople({ runtime: reopened, namespace: "test-people" });
		admin = await people.authenticate(owner.token);
		assert.deepEqual(await people.lookupInvite(admin, original), { ...invite.invite, status: "redeemed" });
		const beforeRevoke = await people.authenticate(user.token);
		beforeRevoke.check("steer", root.conversationId);
		await assert.rejects(people.initializeOwner("Replacement"), /initialized|exists/i);
		await people.revokePerson(admin, beforeRevoke.person.id);
		assert.throws(() => beforeRevoke.check("read", root.conversationId), /denied/i);
		await assert.rejects(people.authenticate(user.token), /denied/i);
		await reopened.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		people = await createPocketPeople({ runtime: reopened, namespace: "test-people" });
		await assert.rejects(people.authenticate(user.token), /denied/i);
		assert.equal((await people.authenticate(owner.token)).person.id, admin.person.id);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

// Expiry must be checked at use as well as session creation; revoking pending invites must survive reuse.
test("WebUI people: expired authority and revoked invitations cannot regain scope", async () => {
	const m = await runtimeFixture();
	let now = Date.now();
	try {
		const people = await createPocketPeople({
			runtime: m.runtime,
			namespace: "test-people",
			now: () => now,
			sessionTtlMs: 1000,
		});
		const owner = await people.initializeOwner("Owner");
		const admin = await people.authenticate(owner.token);
		const invite = await people.invite(admin, {
			requestId: "cancelled",
			role: "viewer",
			resources: "*",
			ttlMs: 500,
		});
		assert.ok(invite.token);
		await people.revokeInvite(admin, invite.invite.id);
		await assert.rejects(people.redeem(invite.token, "Late"), /denied/i);
		const expired = await people.invite(admin, {
			requestId: "expired",
			role: "viewer",
			resources: "*",
			ttlMs: 500,
		});
		assert.ok(expired.token);
		now += 501;
		await assert.rejects(people.redeem(expired.token, "Late"), /denied/i);
		now += 500;
		assert.throws(() => admin.check("read", m.runtime.view().conversations[0]!.conversationId), /denied/i);
		await assert.rejects(people.authenticate(owner.token), /denied/i);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// Receipts must survive writer reopen, share the authority CAS, and never repeat a revocation on replay.
test("WebUI people: version-one state reads without migration and authority receipts recover exact intent", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		let people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const owner = await people.initializeOwner("Owner");
		let admin = await people.authenticate(owner.token);
		const invite = await people.invite(admin, {
			requestId: "receipt-person",
			role: "viewer",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const reader = await people.redeem(invite.token, "Reader");
		const root = m.runtime.view().conversations[0]!;
		const change = {
			requestId: "authority-original",
			action: {
				op: "person.set" as const,
				personId: reader.person.id,
				role: "sender" as const,
				resources: "*" as const,
			},
		};
		const store = m.runtime.store({ namespace: "test-people", maxBytes: 262144 });
		const modern = await store.snapshot();
		const { changes: _changes, ...legacy } = modern.data;
		await store.compareAndSet(modern.version, { ...legacy, schema: 1 }, () => {
			people.current(admin);
		});
		const before = await store.snapshot();
		assert.equal(await people.lookupChange(admin, change), null);
		assert.deepEqual(
			await store.snapshot(),
			before,
			"reading old schema must not migrate or create a receipt",
		);
		const oldAuthority = await people.authenticate(reader.token);
		const receipt = await people.change(admin, change);
		const committed = await store.snapshot();
		assert.equal(committed.version, before.version + 1, "authority and receipt share one CAS");
		assert.equal(committed.data.schema, 2);
		assert.deepEqual(committed.data.changes, [receipt]);
		assert.throws(() => oldAuthority.check("read", root.conversationId), /denied/i);
		assert.deepEqual(await people.lookupChange(admin, change), receipt);
		assert.deepEqual(await store.snapshot(), committed);
		const freshLink = await people.invite(admin, {
			requestId: "new-device",
			personId: reader.person.id,
			role: "sender",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(freshLink.token);
		const fresh = await people.redeem(freshLink.token, "Reader");
		const freshAuthority = await people.authenticate(fresh.token);
		const beforeReplay = await store.snapshot();
		assert.deepEqual(await people.change(admin, change), receipt);
		freshAuthority.check("send", root.conversationId);
		await assert.rejects(
			people.change(admin, { ...change, action: { ...change.action, role: "viewer" } }),
			/conflict/i,
		);
		assert.deepEqual(await store.snapshot(), beforeReplay, "a replay must not revoke a later login");
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		people = await createPocketPeople({ runtime: reopened, namespace: "test-people" });
		admin = await people.authenticate(owner.token);
		assert.deepEqual(await people.lookupChange(admin, change), receipt);
		const revoke = {
			requestId: "original-revoke",
			action: { op: "person.revoke" as const, id: reader.person.id },
		};
		const revoked = await people.change(admin, revoke);
		assert.deepEqual(await people.lookupChange(admin, revoke), revoked);
		await assert.rejects(people.authenticate(fresh.token), /denied/i);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});
