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
		const link = await people.invite(admin, input);
		assert.ok(link.token);
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
		const invite = await people.invite(admin, {
			requestId: "reopen",
			role: "driver",
			resources: [root.conversationId],
			ttlMs: 60_000,
		});
		assert.ok(invite.token);
		const user = await people.redeem(invite.token, "Driver");
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		people = await createPocketPeople({ runtime: reopened, namespace: "test-people" });
		admin = await people.authenticate(owner.token);
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
