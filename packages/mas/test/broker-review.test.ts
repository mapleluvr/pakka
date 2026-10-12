import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createBroker, inProcessPlacement } from "../src/index.ts";
import type { SessionEndpoint, SessionPlacement } from "../src/broker-types.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

async function crew(wrap: (endpoint: SessionEndpoint) => SessionEndpoint = (endpoint) => endpoint) {
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
		const real = inProcessPlacement({
			runtime: b.runtime,
			namespace: "agents",
			maxDeliveries: 8,
			maxPending: 2,
		});
		const two: SessionPlacement = { open: async (expected) => wrap(await real.open(expected)) };
		const broker = await createBroker({
			namespace: "crew",
			maxMembers: 4,
			maxMessages: 8,
			placements: { one, two },
			store: c.runtime.store({ namespace: "crew", maxBytes: 65536 }),
		});
		await broker.bootstrap([
			{ key: "a", placement: "one", owner: "operator" },
			{ key: "b", placement: "two", owner: "operator" },
		]);
		await broker.activate();
		const [from, to] = (await broker.view()).members.map((member) => member.ref!);
		return {
			c,
			a,
			b,
			broker,
			from: from!,
			to: to!,
			close: async () => {
				await c.close();
				await a.close();
				await b.close();
			},
		};
	} catch (error) {
		await c.close();
		await a.close();
		await b.close();
		throw error;
	}
}
test("M3 review: generation-blocked unanswered receipt survives target close without dispatch", async () => {
	const m = await crew();
	try {
		const target = await m.b.runtime.conversation(m.to.conversation);
		const owner = target.connect("blocker", ["real_context.write"]);
		owner.activateStrategy({ id: "blocker", hooks: ["real_context.write"] });
		owner
			.bindStrategy("blocker")
			.installProjector((frame) => ({ status: "blocked", basis: frame.basis, reason: "deterministic gate" }));
		const sender = m.broker.connect({ principal: "a", source: m.from, grants: ["send"] });
		const admitted = await sender.send(m.to, { requestId: "blocked", text: "NO-PROVIDER-DISPATCH" });
		assert.equal((await sender.wait(admitted.id)).status, "unanswered");
		await m.b.runtime.close();
		assert.equal((await sender.wait(admitted.id)).status, "unanswered");
		assert.equal((await sender.receipt(admitted.id)).status, "unanswered");
		assert.equal(m.b.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

// A late observation failure must not overwrite a terminal native receipt committed by a concurrent observer.
test(
	"M3 review: late failed wait cannot downgrade a concurrently committed terminal receipt",
	{ timeout: 15000 },
	async () => {
		const entered = barrier(),
			release = barrier();
		let first = true;
		const m = await crew((endpoint) => ({
			...endpoint,
			wait: async (envelope, id) => {
				if (first) {
					first = false;
					entered.resolve();
					await release.promise;
					throw new Error("lost wait response after native completion");
				}
				return endpoint.wait(envelope, id);
			},
		}));
		try {
			const sender = m.broker.connect({ principal: "a", source: m.from, grants: ["send"] });
			const admitted = await sender.send(m.to, { requestId: "stable", text: "TERMINAL-IS-MONOTONIC" });
			const late = sender.wait(admitted.id);
			await entered.promise;
			assert.equal((await sender.wait(admitted.id)).status, "done");
			release.resolve();
			assert.equal((await late).status, "done");
			assert.equal((await sender.receipt(admitted.id)).status, "done");
			assert.equal(m.b.f.requests.length, 1);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);

// Observation of an already-admitted native submission is allowed, but cannot create another target admission.
test("M3 review: addressed recipient without send grant may observe native completion with zero extra dispatch", async () => {
	const m = await crew();
	try {
		const sender = m.broker.connect({ principal: "a", source: m.from, grants: ["send"] });
		const admitted = await sender.send(m.to, { requestId: "observe", text: "ALREADY-ADMITTED-ONLY" });
		const recipient = m.broker.connect({ principal: "b", source: m.to, grants: [] });
		assert.equal((await recipient.wait(admitted.id)).status, "done");
		await assert.rejects(
			recipient.send(m.from, { requestId: "forbidden", text: "NO-SEND-AUTHORITY" }),
			/grant/,
		);
		assert.equal(m.a.f.requests.length, 0);
		assert.equal(m.b.f.requests.length, 1);
	} finally {
		await m.close();
	}
});

// A lost transmit response must return the already-proven outcome, not a contradictory local unknown.
test(
	"M3 review: concurrent terminal receipt survives a late lost admission response",
	{ timeout: 15000 },
	async () => {
		const entered = barrier(),
			release = barrier();
		let first = true;
		const m = await crew((endpoint) => ({
			...endpoint,
			deliver: async (envelope, signal) => {
				const native = await endpoint.deliver(envelope, signal);
				if (first) {
					first = false;
					entered.resolve();
					await release.promise;
					throw new Error("late lost admission response");
				}
				return native;
			},
		}));
		try {
			const sender = m.broker.connect({ principal: "a", source: m.from, grants: ["send"] });
			const input = { requestId: "parallel", text: "ONE-NATIVE-ADMISSION" };
			const late = sender.send(m.to, input);
			await entered.promise;
			const duplicate = await sender.send(m.to, input);
			assert.equal((await sender.wait(duplicate.id)).status, "done");
			release.resolve();
			const settled = await late;
			assert.equal(settled.status, "done");
			assert.equal(settled.id, duplicate.id);
			assert.equal((await sender.receipt(settled.id)).status, "done");
			assert.equal(m.b.f.requests.length, 1);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
