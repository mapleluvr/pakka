import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { createRuntime, openStorageMaintenance } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import * as auth from "../src/pocket-people.ts";

const token = "a".repeat(43);
test("offline recovery preserves original people and data, revokes owner logins and exchanges a token once", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	let maintenance: Awaited<ReturnType<typeof openStorageMaintenance>> | undefined;
	try {
		const people = await auth.createPocketPeople({ runtime: m.runtime, namespace: "pocket.people" });
		const owner = await people.initializeOwner("Original owner");
		const actor = await people.authenticate(owner.token);
		const invite = await people.invite(actor, {
			requestId: "viewer",
			role: "viewer",
			resources: "*",
			ttlMs: 60000,
		});
		const viewer = await people.redeem(invite.token!, "Existing viewer");
		await m.runtime
			.store({ namespace: "pocket.bootstrap", maxBytes: 65536 })
			.compareAndSet(0, { schema: 2, phase: "ready", ownerId: owner.person.id }, () => {});
		const view = m.runtime.view(),
			recoveryId = randomUUID();
		await m.runtime.close();
		assert.equal(typeof auth.recoverPocketOwner, "function", "trusted offline owner recovery must exist");
		maintenance = await openStorageMaintenance({
			storageDir: dirname(view.sessionFile),
			expectedSessionId: view.sessionId,
			stores: [
				{ namespace: "pocket.bootstrap", maxBytes: 65536 },
				{ namespace: "pocket.people", maxBytes: 262144 },
				{ namespace: "pocket.recovery." + recoveryId, maxBytes: 4096 },
			],
		});
		const issued = await auth.recoverPocketOwner(maintenance, { recoveryId, token });
		assert.equal(issued.ownerId, owner.person.id);
		assert.equal(issued.expiresAt - issued.issuedAt, 600000);
		assert.deepEqual(await auth.recoverPocketOwner(maintenance, { recoveryId, token }), issued);
		await assert.rejects(
			auth.recoverPocketOwner(maintenance, { recoveryId, token: "b".repeat(43) }),
			/conflict/i,
		);
		const saved = await maintenance.snapshot("pocket.people");
		assert.equal(JSON.stringify(saved).includes(token), false);
		await maintenance.close();
		maintenance = undefined;
		reopened = await createRuntime({ ...m.config, reopenSessionFile: view.sessionFile });
		const restored = await auth.createPocketPeople({ runtime: reopened, namespace: "pocket.people" });
		await assert.rejects(restored.authenticate(owner.token), /denied/i);
		assert.equal((await restored.authenticate(viewer.token)).person.id, viewer.person.id);
		const recovery = await restored.authenticate(token);
		assert.equal(recovery.person.id, owner.person.id);
		const browser = await restored.rotate(recovery);
		await assert.rejects(restored.authenticate(token), /denied/i);
		assert.equal((await restored.authenticate(browser.token)).person.id, owner.person.id);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await maintenance?.close();
		await reopened?.close();
		await m.close();
	}
});

test("owner recovery expires after ten minutes and rejects a demoted original owner", async () => {
	const m = await runtimeFixture();
	let maintenance: Awaited<ReturnType<typeof openStorageMaintenance>> | undefined;
	try {
		const people = await auth.createPocketPeople({
			runtime: m.runtime,
			namespace: "pocket.people",
			now: () => 1700000000000,
		});
		const owner = await people.initializeOwner("Original owner");
		await m.runtime
			.store({ namespace: "pocket.bootstrap", maxBytes: 65536 })
			.compareAndSet(0, { schema: 2, phase: "ready", ownerId: owner.person.id }, () => {});
		const view = m.runtime.view(),
			recoveryId = randomUUID();
		await m.runtime.close();
		assert.equal(typeof auth.recoverPocketOwner, "function");
		maintenance = await openStorageMaintenance({
			storageDir: dirname(view.sessionFile),
			expectedSessionId: view.sessionId,
			stores: [
				{ namespace: "pocket.bootstrap", maxBytes: 65536 },
				{ namespace: "pocket.people", maxBytes: 262144 },
				{ namespace: "pocket.recovery." + recoveryId, maxBytes: 4096 },
			],
		});
		const result = await auth.recoverPocketOwner(maintenance, { recoveryId, token, now: 1700000000000 });
		assert.equal(result.expiresAt, 1700000600000);
		const snapshot = await maintenance.snapshot("pocket.people");
		assert.equal((snapshot.data.sessions as { expiresAt: number }[]).at(-1)?.expiresAt, 1700000600000);
		// A later request cannot extend an already issued token's deadline.
		assert.equal(
			(await auth.recoverPocketOwner(maintenance, { recoveryId, token, now: 1700001200000 })).expiresAt,
			1700000600000,
		);
		const bootstrap = await maintenance.snapshot("pocket.bootstrap");
		await maintenance.commit([
			{
				namespace: "pocket.bootstrap",
				expectedVersion: bootstrap.version,
				data: { ...bootstrap.data, ownerId: "missing-owner" },
			},
		]);
		await assert.rejects(auth.recoverPocketOwner(maintenance, { recoveryId, token }), /owner|admin/i);
	} finally {
		await maintenance?.close();
		await m.close();
	}
});
