import { test } from "node:test";
import { strict as assert } from "node:assert";
import { rename, mkdir, rm } from "node:fs/promises";
import { createRuntime } from "../src/index.ts";
import type { JsonObject } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

function store(runtime: Awaited<ReturnType<typeof createRuntime>>, maxBytes = 1024) {
	return runtime.store({ namespace: "broker-state", maxBytes });
}

// Removing durable CAS or reopening with a fresh store would permit two writers or forget committed outbox state.
test("M3 store: concurrent CAS, frozen state and restart preserve exact committed version", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const journal = store(m.runtime);
		assert.deepEqual(await journal.snapshot(), { version: 0, data: {} });
		const payload = { enrollment: { phase: "prepared", requestId: "stable" } };
		await journal.compareAndSet(0, payload, () => {});
		payload.enrollment.phase = "changed-outside";
		assert.equal(Object.isFrozen((await journal.snapshot()).data.enrollment), true);
		const updates = await Promise.allSettled([
			journal.compareAndSet(1, { winner: "a" }, () => {}),
			journal.compareAndSet(1, { winner: "b" }, () => {}),
		]);
		assert.equal(updates.filter((result) => result.status === "fulfilled").length, 1);
		assert.equal(updates.filter((result) => result.status === "rejected").length, 1);
		const state = await journal.snapshot(),
			file = m.runtime.view().sessionFile;
		assert.equal(state.version, 2);
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.deepEqual(await store(reopened).snapshot(), state);
		await assert.rejects(
			journal.compareAndSet(2, { old: true }, () => {}),
			/Runtime|closed/,
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("M3 store: non-JSON, capacity and revoked authority reject without advancing state", async () => {
	const m = await runtimeFixture();
	try {
		const journal = store(m.runtime, 128);
		await journal.compareAndSet(0, { valid: true }, () => {});
		for (const data of [
			{ oversized: "x".repeat(200) },
			{ number: NaN },
			{ omitted: undefined },
			{ callback: () => {} },
			[],
		])
			await assert.rejects(
				journal.compareAndSet(1, data as unknown as JsonObject, () => {}),
				/JSON|capacity|object/i,
			);
		await assert.rejects(
			journal.compareAndSet(1, { denied: true }, () => {
				throw new Error("revoked");
			}),
			/revoked/,
		);
		assert.deepEqual(await journal.snapshot(), { version: 1, data: { valid: true } });
		assert.equal(m.runtime.view().phase, "ready");
		await assert.rejects(store(m.runtime, 256).snapshot(), /options|capacity|conflict/i);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("M3 store: unknown physical commit seals only its owned Session", async () => {
	const m = await runtimeFixture(),
		peer = await runtimeFixture();
	let file: string | undefined;
	try {
		const journal = store(m.runtime);
		await journal.compareAndSet(0, { known: true }, () => {});
		file = m.runtime.view().sessionFile;
		await rename(file, file + ".saved");
		await mkdir(file);
		await assert.rejects(journal.compareAndSet(1, { uncertain: true }, () => {}));
		assert.equal(m.runtime.view().phase, "failed");
		assert.equal(peer.runtime.view().phase, "ready");
		await store(peer.runtime).compareAndSet(0, { independent: true }, () => {});
		assert.equal(m.f.requests.length + peer.f.requests.length, 0);
	} finally {
		if (file) {
			await rm(file, { recursive: true });
			await rename(file + ".saved", file);
		}
		await m.close();
		await peer.close();
	}
});

test("M3 runtime: explicit reserved storage identity is create-once and only reopens explicitly", async () => {
	const m = await runtimeFixture();
	let reserved: Awaited<ReturnType<typeof createRuntime>> | undefined, reopened: typeof reserved;
	const reservedSessionId = "c870ef1b-2b16-42da-9ff7-457219862c08";
	try {
		reserved = await createRuntime({ ...m.config, reservedSessionId });
		assert.equal(reserved.view().sessionId, reservedSessionId);
		const file = reserved.view().sessionFile;
		await assert.rejects(createRuntime({ ...m.config, reservedSessionId }), /exists|locked|reserved/i);
		await reserved.close();
		await assert.rejects(createRuntime({ ...m.config, reservedSessionId }), /exists|reserved/i);
		await assert.rejects(
			createRuntime({
				...m.config,
				reopenSessionFile: file,
				reservedSessionId: "b171585b-18a9-49d7-8d85-2193a7f6dfb0",
			}),
			/identity|reserved|provenance/i,
		);
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file, reservedSessionId });
		assert.equal(reopened.view().sessionId, reservedSessionId);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await reserved?.close();
		await m.close();
	}
});
