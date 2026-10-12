import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

async function catalog(runtime: Awaited<ReturnType<typeof createRuntime>>) {
	assert.equal(
		typeof (runtime as unknown as { catalog?: unknown }).catalog,
		"function",
		"bootstrap catalog port is required for the MAS consumer",
	);
	return runtime.catalog({ namespace: "m2-test", maxDeliveries: 16, maxPending: 2 });
}
const allow = () => {};

test("M2: configuration and membership are atomic; rejected batch has no partial members", async () => {
	const m = await runtimeFixture();
	try {
		const c = await catalog(m.runtime);
		await assert.rejects(
			c.enroll(
				[
					{ key: "a", data: { owner: "admin" } },
					{ key: "b", profile: "missing", data: {} },
				],
				allow,
			),
			/profile/,
		);
		assert.equal((await c.snapshot()).members.length, 0);
		assert.equal(m.runtime.view().conversations.length, 1);
		const members = await c.enroll(
			[
				{ key: "a", data: { owner: "admin" } },
				{ key: "b", data: { owner: "a" } },
			],
			allow,
		);
		assert.equal(members.length, 2);
		assert.ok(Object.isFrozen(members[0]!.ref));
		const lines = (await readFile(m.runtime.view().sessionFile, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.ok(
			lines.some(
				(line) =>
					line.writes.filter((write: { type: string }) => write.type === "conversation").length === 2 &&
					line.writes.some(
						(write: { type: string; record?: { kind: string } }) =>
							write.type === "document.create" && write.record?.kind === "pakka.catalog",
					),
			),
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("M2: native admission shares fingerprint commit, retries conflict and reopen does not dispatch", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const c = await catalog(m.runtime);
		const [a, b] = await c.enroll(
			[
				{ key: "a", data: {} },
				{ key: "b", data: {} },
			],
			allow,
		);
		for (const member of [a!, b!])
			await c.update(member.key, { phase: "active" }, (await c.snapshot()).version, allow);
		const spec = {
			requestId: "r1",
			principal: "a",
			source: a!.ref,
			target: b!.ref,
			text: "M2-DELIVERY",
			mode: "prompt" as const,
		};
		const first = await c.deliver(spec, allow);
		assert.ok(["placed", "done"].includes(first.status));
		const retry = await c.deliver(spec, allow);
		assert.equal(first.id, retry.id);
		await assert.rejects(c.deliver({ ...spec, text: "CONFLICT" }, allow), /conflict/);
		const settled = await c.wait(first.id, allow);
		assert.equal(settled.status, "done");
		assert.equal(m.f.requests.length, 1);
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: m.runtime.view().sessionFile });
		const restored = await catalog(reopened);
		assert.equal((await restored.deliver(spec, allow)).id, first.id);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("M2: late revoked guard, forged reference and unproven task ownership reject with zero effects", async () => {
	const m = await runtimeFixture();
	try {
		const c = await catalog(m.runtime);
		let count = 0;
		await assert.rejects(
			c.enroll([{ key: "revoked", data: {} }], () => {
				if (++count >= 2) throw new Error("revoked");
			}),
			/revoked/,
		);
		assert.equal((await c.snapshot()).members.length, 0);
		await assert.rejects(c.enroll([{ key: "temp", lifetime: "task-bound", data: {} }], allow), /invocation/);
		const [b] = await c.enroll([{ key: "b", data: {} }], allow);
		await c.update("b", { phase: "active" }, (await c.snapshot()).version, allow);
		await assert.rejects(
			c.deliver(
				{
					requestId: "fake",
					principal: "admin",
					source: null,
					target: { ...b!.ref, incarnation: "fake" },
					text: "unauthorized",
					mode: "prompt",
				},
				allow,
			),
			/reference/,
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
