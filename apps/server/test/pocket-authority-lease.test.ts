import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { blockSqliteWrites } from "../../../packages/agent/test/native-storage.ts";
import { createPocketPeople } from "../src/pocket-people.ts";

// A pending native auth write must receive cancellation, not merely fail a later HTTP check.
for (const operation of ["role", "revoke", "logout", "rotate"] as const) {
	test(`WebUI authority lease: ${operation} cancels its live native operation without affecting another login`, async () => {
		const m = await runtimeFixture();
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "lease-people" });
			const owner = await people.initializeOwner("Owner");
			const admin = await people.authenticate(owner.token);
			const invite = await people.invite(admin, {
				requestId: "second-admin",
				role: "admin",
				resources: "*",
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const guest = await people.redeem(invite.token, "Second admin");
			const actor = await people.authenticate(guest.token);
			const lease = people.lease(actor, "extensions.install");
			const peer = people.lease(admin, "extensions.install");
			try {
				assert.equal(lease.signal.aborted, false);
				lease.check();
				if (operation === "role")
					await people.setPerson(admin, guest.person.id, { role: "viewer", resources: "*" });
				if (operation === "revoke") await people.revokePerson(admin, guest.person.id);
				if (operation === "logout") await people.logout(actor);
				if (operation === "rotate") await people.rotate(actor);
				assert.equal(lease.signal.aborted, true);
				assert.throws(() => lease.check());
				assert.equal(peer.signal.aborted, false);
				peer.check();
				assert.equal(m.f.requests.length, 0);
			} finally {
				lease.close();
				peer.close();
			}
		} finally {
			await m.close();
		}
	});
}

test("WebUI authority lease: expires without another request and cannot be forged or reused after release", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "lease-people" });
		const owner = await people.initializeOwner("Owner"),
			admin = await people.authenticate(owner.token);
		assert.throws(() => people.lease({ ...admin }, "extensions.install"));
		const lease = people.lease(admin, "extensions.install", { ttlMs: 40 });
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Authorization did not expire")), 2000);
			lease.signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timeout);
					resolve();
				},
				{ once: true },
			);
		});
		assert.throws(() => lease.check());
		lease.close();
		const next = people.lease(admin, "extensions.install");
		next.close();
		assert.equal(next.signal.aborted, true);
		assert.throws(() => next.check());
	} finally {
		await m.close();
	}
});

test("WebUI authority lease: unknown people persistence cancels pending credential authority", async () => {
	const m = await runtimeFixture();
	let unlock: (() => void) | undefined;
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "lease-people" });
		const owner = await people.initializeOwner("Owner"),
			admin = await people.authenticate(owner.token);
		const lease = people.lease(admin, "extensions.install");
		try {
			unlock = blockSqliteWrites(m.runtime.view().sessionFile);
			await assert.rejects(
				people.invite(admin, { requestId: "blocked", role: "viewer", resources: "*", ttlMs: 60000 }),
			);
			assert.equal(m.runtime.view().phase, "failed");
			assert.equal(lease.signal.aborted, true);
		} finally {
			lease.close();
		}
	} finally {
		unlock?.();
		await m.close();
	}
});
