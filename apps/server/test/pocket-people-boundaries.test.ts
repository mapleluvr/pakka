import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, rename, rm } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";

// A pre-queue check alone would redeem an invitation after expiry at the real commit boundary.
test("WebUI people: invitation expiry is rechecked after session preparation before native commit", async () => {
	const m = await runtimeFixture();
	const base = Date.now();
	let armed = false,
		reads = 0;
	try {
		const people = await createPocketPeople({
			runtime: m.runtime,
			namespace: "test-people",
			now: () => (armed && ++reads >= 2 ? base + 1000 : base),
		});
		const owner = await people.initializeOwner("Owner");
		const admin = await people.authenticate(owner.token);
		const link = await people.invite(admin, {
			requestId: "during-commit",
			role: "viewer",
			resources: "*",
			ttlMs: 500,
		});
		assert.ok(link.token);
		armed = true;
		await assert.rejects(people.redeem(link.token, "Too late"), /denied/i);
		assert.equal((await people.list(admin)).people.length, 1);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// Revocation must fence an already queued redemption rather than wait for a session to be minted.
test("WebUI people: pending redemption is fenced by invitation revocation before allocation commits", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const owner = await people.initializeOwner("Owner");
		const admin = await people.authenticate(owner.token);
		const link = await people.invite(admin, {
			requestId: "late-revoke",
			role: "viewer",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(link.token);
		const outcomes = await Promise.allSettled([
			people.redeem(link.token, "Pending"),
			people.revokeInvite(admin, link.invite.id),
		]);
		assert.equal(outcomes[0]!.status, "rejected");
		assert.equal(outcomes[1]!.status, "fulfilled");
		const records = await people.list(admin);
		assert.equal(records.people.length, 1);
		assert.equal(records.invites[0]!.status, "revoked");
	} finally {
		await m.close();
	}
});

// Reducing a role must invalidate current sessions; a new sign-in must retain the existing person.
test("WebUI people: role changes invalidate old checks and a targeted sign-in preserves the person", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const owner = await people.initializeOwner("Owner"),
			admin = await people.authenticate(owner.token);
		const root = m.runtime.view().conversations[0]!;
		const link = await people.invite(admin, {
			requestId: "driver",
			role: "driver",
			resources: [root.conversationId],
			ttlMs: 60000,
		});
		assert.ok(link.token);
		const driver = await people.redeem(link.token, "Original name"),
			bound = await people.authenticate(driver.token);
		await people.setPerson(admin, driver.person.id, { role: "viewer", resources: [root.conversationId] });
		assert.throws(() => bound.check("read", root.conversationId), /denied/i);
		await assert.rejects(people.authenticate(driver.token), /denied/i);
		const signIn = await people.invite(admin, {
			requestId: "signin",
			personId: driver.person.id,
			role: "viewer",
			resources: [root.conversationId],
			ttlMs: 60000,
		});
		assert.ok(signIn.token);
		const session = await people.redeem(signIn.token, "Cannot rename on login");
		assert.equal(session.person.id, driver.person.id);
		assert.equal(session.person.name, "Original name");
		const viewer = await people.authenticate(session.token);
		viewer.check("read", root.conversationId);
		assert.throws(() => viewer.check("steer", root.conversationId), /denied/i);
		await people.logout(viewer);
		assert.throws(() => viewer.verifyCsrf(session.csrf), /denied/i);
		assert.equal((await people.list(admin)).people.length, 2);
		await assert.rejects(
			people.setPerson(admin, admin.person.id, { role: "viewer", resources: [root.conversationId] }),
			/denied/i,
		);
	} finally {
		await m.close();
	}
});

// A failed native write must close old checks and must never restore a bootstrap owner.
test("WebUI people: uncertain native storage closes authority rather than restoring a bootstrap owner", async () => {
	const m = await runtimeFixture();
	const file = m.runtime.view().sessionFile;
	let moved = false;
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const owner = await people.initializeOwner("Owner"),
			admin = await people.authenticate(owner.token);
		await rename(file, file + ".saved");
		moved = true;
		await mkdir(file);
		await assert.rejects(
			people.invite(admin, { requestId: "uncertain", role: "viewer", resources: "*", ttlMs: 60000 }),
		);
		assert.equal(m.runtime.view().phase, "failed");
		assert.throws(() => admin.check("extensions.install"), /denied/i);
		await assert.rejects(people.initializeOwner("Replacement"));
		assert.equal(m.f.requests.length, 0);
	} finally {
		if (moved) {
			await rm(file, { recursive: true, force: true });
			await rename(file + ".saved", file);
		}
		await m.close();
	}
});
