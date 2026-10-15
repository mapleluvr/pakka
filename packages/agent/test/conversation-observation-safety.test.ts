import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runtimeFixture } from "./runtime-fixture.ts";
import { deferred, text } from "./fixture.ts";

const allow = () => {};
const record = {
	namespace: "pocket",
	actorId: "person",
	requestId: "same",
	kind: "card" as const,
	text: "DISPLAY-PRIVATE-CANARY",
};

test("Pocket read: revocation during native watch cleanup prevents publishing the acquired snapshot", async () => {
	const m = await runtimeFixture();
	try {
		const ref = m.runtime.view().conversations[0]!;
		let checks = 0,
			revoked = false;
		await assert.rejects(
			m.runtime.readConversation(ref, () => {
				if (revoked) throw new Error("revoked during cleanup");
				if (++checks === 2)
					queueMicrotask(() => {
						revoked = true;
					});
			}),
			/revoked during cleanup/,
		);
		assert.equal(m.runtime.view().phase, "ready");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("Pocket display: concurrent retry has one committed entry; actor and namespace are independent", async () => {
	const m = await runtimeFixture();
	try {
		const ref = m.runtime.view().conversations[0]!;
		const attempts = await Promise.all(
			Array.from({ length: 20 }, () => m.runtime.writeDisplay(ref, record, allow)),
		);
		assert.ok(attempts.every((receipt) => receipt.entryId === attempts[0]!.entryId));
		const actor = await m.runtime.writeDisplay(ref, { ...record, actorId: "another" }, allow);
		const namespace = await m.runtime.writeDisplay(ref, { ...record, namespace: "another" }, allow);
		assert.notEqual(actor.entryId, attempts[0]!.entryId);
		assert.notEqual(namespace.entryId, actor.entryId);
		assert.equal((await m.runtime.readConversation(ref, allow)).entries.length, 3);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("Pocket display: chat/card writes during a real native tool do not join or replace the run's inputs", async () => {
	const entered = deferred(),
		release = deferred();
	const m = await runtimeFixture(
		{
			tools: [
				{
					name: "held",
					description: "hold the native round",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						entered.resolve();
						await release.promise;
						return "TOOL-DONE";
					},
				},
			],
		},
		undefined,
		(_payload, n) => (n === 1 ? { tool: "held" } : { text: "FINISHED" }),
	);
	try {
		const ref = m.runtime.view().conversations[0]!;
		const sender = m.runtime.root().connect("human", ["input.submit"]);
		const input = await sender.submit({ key: "actual", text: "ORIGINAL-REQUESTER-INPUT" });
		await entered.promise;
		await m.runtime.writeDisplay(ref, { ...record, kind: "chat" }, allow);
		const during = await m.runtime.readConversation(ref, allow);
		assert.equal(during.live.busy, true);
		assert.equal(m.f.requests.length, 1);
		release.resolve();
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 2);
		assert.match(text(m.f.requests[1]!), /ORIGINAL-REQUESTER-INPUT/);
		assert.doesNotMatch(text(m.f.requests[1]!), /DISPLAY-PRIVATE-CANARY/);
		assert.equal(sender.receipt(input.id)?.principal, "human");
		assert.equal(sender.receipt(input.id)?.key, "actual");
		assert.equal((await m.runtime.readConversation(ref, allow)).live.busy, false);
	} finally {
		release.resolve();
		await m.close();
	}
});

test("Pocket display: invalid shapes, oversized records and expired scope are rejected without commits", async () => {
	const m = await runtimeFixture();
	try {
		const ref = m.runtime.view().conversations[0]!;
		const before = await readFile(m.runtime.view().sessionFile, "utf8");
		for (const input of [
			{ ...record, text: "x".repeat(16385) },
			{ ...record, actorId: "../other" },
			Object.assign({ ...record }, { model: [{ role: "user", content: "SNEAK" }] }),
		]) {
			await assert.rejects(m.runtime.writeDisplay(ref, input, allow), /Invalid/);
		}
		await assert.rejects(
			m.runtime.writeDisplay({ ...ref, incarnation: "old" }, record, allow),
			/reference|foreign|stale/i,
		);
		assert.equal(await readFile(m.runtime.view().sessionFile, "utf8"), before);
		assert.equal(m.runtime.view().phase, "ready");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
