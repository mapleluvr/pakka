import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createBroker, inProcessPlacement } from "../src/index.ts";
import type { SessionPlacement } from "../src/broker-types.ts";
import { createRuntime } from "../../agent/src/index.ts";
import { deferred, text } from "../../agent/test/fixture.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

function factories() {
	return { createBroker, placement: inProcessPlacement };
}
const plan = [
	{ key: "a", placement: "one", owner: "operator" },
	{ key: "b", placement: "two", owner: "operator" },
];

// A new transport identity on retry would produce a second target HTTP after the lost native receipt.
test("M3 broker: lost admission receipt survives coordinator reopen without duplicate target effects", async () => {
	const c = await runtimeFixture(),
		a = await runtimeFixture(),
		b = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const f = factories();
		const one = f.placement({ runtime: a.runtime, namespace: "agents", maxDeliveries: 16, maxPending: 2 });
		const two = f.placement({ runtime: b.runtime, namespace: "agents", maxDeliveries: 16, maxPending: 2 });
		let loseReceipt = true;
		const transport: SessionPlacement = {
			open: async (expected) => {
				const endpoint = await two.open(expected);
				return {
					...endpoint,
					deliver: async (envelope, signal) => {
						const native = await endpoint.deliver(envelope, signal);
						await endpoint.wait(envelope, native.id);
						if (loseReceipt) {
							loseReceipt = false;
							throw new Error("lost transport response after native admission");
						}
						return native;
					},
				};
			},
		};
		const options = { namespace: "crew", maxMembers: 4, maxMessages: 8, placements: { one, two: transport } };
		const broker = await f.createBroker({
			...options,
			store: c.runtime.store({ namespace: "crew", maxBytes: 65536 }),
		});
		await broker.bootstrap(plan);
		const refs = (await broker.view()).members.map((m) => m.ref!);
		const sender = broker.connect({ principal: "a", source: refs[0]!, grants: ["send"] });
		await assert.rejects(
			sender.send(refs[1]!, { requestId: "early", text: "BEFORE-ACTIVATION" }),
			/active|ready/,
		);
		assert.equal(b.f.requests.length, 0);
		await broker.activate();
		const input = { requestId: "stable", text: "CROSS-SESSION-A-TO-B" };
		const uncertain = await sender.send(refs[1]!, input);
		assert.equal(uncertain.status, "unknown");
		assert.equal(b.f.requests.length, 1);
		const file = c.runtime.view().sessionFile;
		await c.runtime.close();
		reopened = await createRuntime({ ...c.config, reopenSessionFile: file });
		const restored = await f.createBroker({
			...options,
			store: reopened.store({ namespace: "crew", maxBytes: 65536 }),
		});
		const fresh = restored.connect({ principal: "a", source: refs[0]!, grants: ["send"] });
		const retried = await fresh.send(refs[1]!, input);
		assert.equal(retried.id, uncertain.id);
		assert.equal((await fresh.wait(retried.id)).status, "done");
		assert.equal(b.f.requests.length, 1);
		await assert.rejects(fresh.send(refs[1]!, { ...input, text: "CONFLICT" }), /conflict/);
		await assert.rejects(
			sender.send(refs[1]!, { requestId: "old", text: "OLD-AUTHORITY" }),
			/closed|Runtime/,
		);
		const responder = restored.connect({ principal: "b", source: refs[1]!, grants: ["reply"] });
		const reply = await responder.reply(retried.id, { requestId: "reply", text: "CROSS-SESSION-B-TO-A" });
		await responder.wait(reply.id);
		assert.equal(a.f.requests.length, 1);
		assert.match(text(a.f.requests[0]!), /CROSS-SESSION-B-TO-A/);
		assert.doesNotMatch(text(a.f.requests[0]!), /CROSS-SESSION-A-TO-B/);
		assert.equal(c.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await c.close();
		await a.close();
		await b.close();
	}
});

test("M3 broker: interrupted preparation reconciles the exact roster and never allocates replacements", async () => {
	const c = await runtimeFixture(),
		a = await runtimeFixture(),
		b = await runtimeFixture();
	try {
		const f = factories(),
			one = f.placement({ runtime: a.runtime, namespace: "agents", maxDeliveries: 8, maxPending: 2 });
		const two = f.placement({ runtime: b.runtime, namespace: "agents", maxDeliveries: 8, maxPending: 2 });
		let drop = true;
		const broker = await f.createBroker({
			namespace: "crew",
			store: c.runtime.store({ namespace: "crew", maxBytes: 65536 }),
			maxMembers: 4,
			maxMessages: 8,
			placements: {
				one,
				two: {
					open: async (expected) => {
						const endpoint = await two.open(expected);
						return {
							...endpoint,
							prepare: async (members) => {
								const result = await endpoint.prepare(members);
								if (drop) {
									drop = false;
									throw new Error("lost readiness response");
								}
								return result;
							},
						};
					},
				},
			},
		});
		assert.equal((await broker.bootstrap(plan)).phase, "unknown");
		await assert.rejects(broker.activate(), /ready|prepared|unknown/);
		const before = b.runtime.view().conversations;
		assert.equal((await broker.bootstrap(plan)).phase, "ready");
		assert.deepEqual(b.runtime.view().conversations, before);
		assert.equal((await broker.activate()).phase, "active");
		assert.equal(c.f.requests.length + a.f.requests.length + b.f.requests.length, 0);
	} finally {
		await c.close();
		await a.close();
		await b.close();
	}
});

test("M3 broker: revocation during routing and forged Session addresses cause zero target effects", async () => {
	const c = await runtimeFixture(),
		a = await runtimeFixture(),
		b = await runtimeFixture();
	const arrived = deferred(),
		release = deferred();
	try {
		const f = factories(),
			one = f.placement({ runtime: a.runtime, namespace: "agents", maxDeliveries: 8, maxPending: 2 });
		const two = f.placement({ runtime: b.runtime, namespace: "agents", maxDeliveries: 8, maxPending: 2 });
		let hold = false;
		const broker = await f.createBroker({
			namespace: "crew",
			store: c.runtime.store({ namespace: "crew", maxBytes: 65536 }),
			maxMembers: 4,
			maxMessages: 1,
			placements: {
				one,
				two: {
					open: async (expected) => {
						if (hold) {
							arrived.resolve();
							await release.promise;
						}
						return two.open(expected);
					},
				},
			},
		});
		await broker.bootstrap(plan);
		await broker.activate();
		const [ra, rb] = (await broker.view()).members.map((m) => m.ref!);
		const sender = broker.connect({ principal: "a", source: ra!, grants: ["send"] });
		await assert.rejects(
			sender.send({ ...rb!, sessionId: ra!.sessionId }, { requestId: "forged", text: "FORGED" }),
			/reference|foreign|identity/,
		);
		hold = true;
		const pending = sender.send(rb!, { requestId: "late", text: "LATE-REVOKED" });
		await arrived.promise;
		broker.revoke("a");
		release.resolve();
		await assert.rejects(pending, /revoked/);
		assert.equal(b.f.requests.length, 0);
		const fresh = broker.connect({ principal: "a", source: ra!, grants: ["send"] });
		await assert.rejects(fresh.send(rb!, { requestId: "new", text: "CAPACITY-MUST-NOT-RESET" }), /capacity/);
		assert.equal(b.f.requests.length, 0);
	} finally {
		release.resolve();
		await c.close();
		await a.close();
		await b.close();
	}
});

// Removing fresh send/reply authorization from unknown-outbox replay would create a real target request through wait().
test("M3 broker: observing an unknown receipt cannot replay it under missing send authority", async () => {
	const c = await runtimeFixture(),
		a = await runtimeFixture(),
		b = await runtimeFixture();
	try {
		const one = inProcessPlacement({
			runtime: a.runtime,
			namespace: "agents",
			maxDeliveries: 8,
			maxPending: 2,
		});
		const two = inProcessPlacement({
			runtime: b.runtime,
			namespace: "agents",
			maxDeliveries: 8,
			maxPending: 2,
		});
		let failBeforeAdmission = true;
		const broker = await createBroker({
			namespace: "crew",
			store: c.runtime.store({ namespace: "crew", maxBytes: 65536 }),
			maxMembers: 4,
			maxMessages: 8,
			placements: {
				one,
				two: {
					open: async (expected) => {
						const endpoint = await two.open(expected);
						return {
							...endpoint,
							deliver: async (envelope, signal) => {
								if (failBeforeAdmission) {
									failBeforeAdmission = false;
									throw new Error("lost connection before admission");
								}
								return endpoint.deliver(envelope, signal);
							},
						};
					},
				},
			},
		});
		await broker.bootstrap(plan);
		await broker.activate();
		const [ra, rb] = (await broker.view()).members.map((member) => member.ref!);
		const sender = broker.connect({ principal: "a", source: ra!, grants: ["send"] });
		const unknown = await sender.send(rb!, { requestId: "pending", text: "REAL-RETRY" });
		assert.equal(unknown.status, "unknown");
		const observer = broker.connect({ principal: "a", source: ra!, grants: [] });
		assert.equal((await observer.receipt(unknown.id)).status, "unknown");
		await assert.rejects(observer.wait(unknown.id), /grant/);
		assert.equal(b.f.requests.length, 0);
		const done = await sender.wait(unknown.id);
		assert.equal(done.status, "done");
		assert.equal(b.f.requests.length, 1);
	} finally {
		await c.close();
		await a.close();
		await b.close();
	}
});
