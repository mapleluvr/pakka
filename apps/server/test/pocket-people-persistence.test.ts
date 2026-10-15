import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";

// Session rotation must not leave the previous bearer/CSRF usable or duplicate the person.
test("Pocket people: session rotation is one-time, persists and replaces both bearer and CSRF", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const original = await people.initializeOwner("Owner"),
			actor = await people.authenticate(original.token);
		const rotations = await Promise.allSettled([people.rotate(actor), people.rotate(actor)]);
		assert.equal(rotations.filter((r) => r.status === "fulfilled").length, 1);
		const winner = rotations.find((r) => r.status === "fulfilled");
		assert.ok(winner?.status === "fulfilled");
		const next = winner.value;
		assert.equal(next.person.id, original.person.id);
		assert.notEqual(next.token, original.token);
		assert.notEqual(next.csrf, original.csrf);
		await assert.rejects(people.authenticate(original.token), /denied/i);
		assert.throws(() => actor.verifyCsrf(original.csrf), /denied/i);
		const current = await people.authenticate(next.token);
		current.verifyCsrf(next.csrf);
		assert.throws(() => current.verifyCsrf(original.csrf), /denied/i);
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		const restored = await createPocketPeople({ runtime: reopened, namespace: "test-people" });
		await assert.rejects(restored.authenticate(original.token), /denied/i);
		const restoredActor = await restored.authenticate(next.token);
		assert.equal((await restored.list(restoredActor)).people.length, 1);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

// Decoding only the outer JSON would turn a malformed saved identity into grants or a new bootstrap owner.
test("Pocket people: malformed nested persisted identity seals the service without rewriting it", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "test-people" });
		const original = await people.initializeOwner("Owner"),
			actor = await people.authenticate(original.token);
		const store = m.runtime.store({ namespace: "test-people", maxBytes: 262144 });
		const before = await store.snapshot();
		await store.compareAndSet(
			before.version,
			{ ...before.data, sessions: [{ personId: "forged" }] },
			() => {},
		);
		const corrupted = await store.snapshot();
		await assert.rejects(people.authenticate(original.token), /Invalid persisted/);
		assert.throws(() => actor.check("extensions.install"), /denied/i);
		await assert.rejects(people.initializeOwner("Replacement"));
		assert.deepEqual(await store.snapshot(), corrupted, "invalid metadata is not repaired by allocation");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
