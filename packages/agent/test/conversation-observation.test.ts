import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRuntime, type Runtime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { deferred, text } from "./fixture.ts";

const allow = () => {};
const card = {
	namespace: "pocket-example",
	actorId: "person-a",
	requestId: "card-1",
	kind: "card" as const,
	text: "DISPLAY-ONLY-CANARY",
};

test("Pocket port: committed transcript is scoped, frozen, sanitized and passive", async () => {
	const m = await runtimeFixture({ apiKey: "PRIVATE-CREDENTIAL-CANARY" });
	try {
		assert.equal(typeof m.runtime.readConversation, "function", "controlled observation port is required");
		const a = await m.runtime.createConversation({ key: "a" });
		const b = await m.runtime.createConversation({ key: "b" });
		const ah = await m.runtime.conversation(a),
			bh = await m.runtime.conversation(b);
		await ah.connect("operator", ["input.submit"]).submit({ key: "a-1", text: "A-ONLY" });
		await bh.connect("operator", ["input.submit"]).submit({ key: "b-1", text: "B-PRIVATE" });
		await m.runtime.waitForIdle();
		const before = await readFile(m.runtime.view().sessionFile, "utf8");
		const snapshot = await m.runtime.readConversation(a, allow);
		assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.entries));
		assert.equal(snapshot.ref.conversationId, a.conversationId);
		assert.match(JSON.stringify(snapshot), /A-ONLY/);
		assert.match(JSON.stringify(snapshot), /LOCAL-ANSWER/);
		assert.equal(snapshot.usage.cost, null, "default zero prices are not authoritative billing evidence");
		assert.doesNotMatch(
			JSON.stringify(snapshot),
			/B-PRIVATE|PRIVATE-CREDENTIAL-CANARY|PAKKA-SYSTEM|baseUrl|providerSessionId/,
		);
		assert.equal(snapshot.live.busy, false);
		assert.equal(m.f.requests.length, 2);
		assert.equal(
			await readFile(m.runtime.view().sessionFile, "utf8"),
			before,
			"read must not create tasks or commit data",
		);
		assert.throws(() => {
			(snapshot.entries as unknown as unknown[]).push({});
		});
		await assert.rejects(
			m.runtime.readConversation({ ...a, sessionId: "foreign" }, allow),
			/reference|scope|foreign/i,
		);
	} finally {
		await m.close();
	}
});

test("Pocket port: display records are idempotent after reopen and absent from real provider payloads", async () => {
	const m = await runtimeFixture();
	let reopened: Runtime | undefined;
	try {
		assert.equal(typeof m.runtime.writeDisplay, "function", "controlled passive entry port is required");
		const ref = await m.runtime.createConversation({ key: "display-owner" });
		const first = await m.runtime.writeDisplay(ref, card, allow);
		assert.deepEqual(await m.runtime.writeDisplay(ref, card, allow), first);
		assert.equal(m.f.requests.length, 0);
		assert.deepEqual(m.runtime.view().budget, { primaryAttempts: 0, auxiliaryAttempts: 0 });
		await assert.rejects(m.runtime.writeDisplay(ref, { ...card, text: "different" }, allow), /conflict/i);
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.deepEqual(await reopened.writeDisplay(ref, card, allow), first);
		const snapshot = await reopened.readConversation(ref, allow);
		const records = snapshot.entries.filter((entry) => entry.kind === "pakka.display");
		assert.equal(records.length, 1);
		assert.equal(records[0]!.display?.text, card.text);
		assert.deepEqual(records[0]!.messages, []);
		const host = await reopened.conversation(ref);
		await host
			.connect("operator", ["input.submit"])
			.submit({ key: "after-card", text: "ACTUAL-MODEL-INPUT" });
		await host.waitForIdle();
		assert.equal(m.f.requests.length, 1);
		assert.match(text(m.f.requests[0]!), /ACTUAL-MODEL-INPUT/);
		assert.doesNotMatch(text(m.f.requests[0]!), /DISPLAY-ONLY-CANARY|person-a|pocket-example/);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("Pocket port: read and passive write recheck authority at their publication/commit boundary", async () => {
	const m = await runtimeFixture();
	try {
		assert.equal(typeof m.runtime.readConversation, "function");
		const ref = await m.runtime.createConversation({ key: "revoked" });
		let checks = 0;
		await assert.rejects(
			m.runtime.readConversation(ref, () => {
				if (++checks > 1) throw new Error("revoked read");
			}),
			/revoked/,
		);
		assert.ok(checks > 1, "a check before awaiting native state alone is insufficient");
		checks = 0;
		const before = await readFile(m.runtime.view().sessionFile, "utf8");
		await assert.rejects(
			m.runtime.writeDisplay(ref, card, () => {
				if (++checks > 1) throw new Error("revoked write");
			}),
			/revoked/,
		);
		assert.equal(await readFile(m.runtime.view().sessionFile, "utf8"), before);
		assert.equal(m.f.requests.length, 0);
		assert.equal((await m.runtime.readConversation(ref, allow)).entries.length, 0);
		assert.equal(m.runtime.view().phase, "ready", "permission denial must not poison the Session");
	} finally {
		await m.close();
	}
});

test("Pocket port: a real native tool's live and committed activity is observable without new work", async () => {
	const entered = deferred(),
		finish = deferred();
	const m = await runtimeFixture(
		{
			tools: [
				{
					name: "held",
					description: "local deterministic tool",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						entered.resolve();
						await finish.promise;
						return "TOOL-RESULT-CANARY";
					},
				},
			],
		},
		undefined,
		(_payload, n) => (n === 1 ? { tool: "held" } : { text: "NATIVE-FINAL" }),
	);
	try {
		assert.equal(typeof m.runtime.readConversation, "function");
		const ref = m.runtime.view().conversations.find((item) => item.key === "root")!;
		assert.ok(ref);
		await m.runtime.root().connect("operator", ["input.submit"]).submit({ key: "tool-1", text: "RUN-HELD" });
		await entered.promise;
		const live = await m.runtime.readConversation(ref, allow);
		assert.equal(live.live.busy, true);
		assert.equal(live.live.tools[0]?.name, "held");
		assert.equal(live.live.tools[0]?.status, "running");
		assert.match(JSON.stringify(live.entries), /toolCall/);
		assert.equal(m.f.requests.length, 1);
		finish.resolve();
		await m.runtime.waitForIdle();
		const done = await m.runtime.readConversation(ref, allow);
		assert.equal(done.live.busy, false);
		assert.match(JSON.stringify(done.entries), /TOOL-RESULT-CANARY/);
		assert.match(JSON.stringify(done.entries), /NATIVE-FINAL/);
		assert.equal(m.f.requests.length, 2);
	} finally {
		finish.resolve();
		await m.close();
	}
});
