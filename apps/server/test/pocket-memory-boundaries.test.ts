import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import type { Runtime, RuntimeOptions } from "@pakka/agent";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketMemory } from "../src/pocket-memory.ts";

const options = {
	namespace: "memory.boundaries",
	profiles: ["default"],
	projects: [{ id: "all", name: "Approved project", resources: "*" as const }],
};
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
async function fixture(extra: Partial<RuntimeOptions> = {}) {
	const prepared = createPocketMemory(options),
		m = await runtimeFixture({ ...extra, contextSources: [prepared.source] });
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "memory.people" }),
			session = await people.initializeOwner("Owner"),
			owner = await people.authenticate(session.token);
		return { m, prepared, people, owner, target: m.runtime.view().conversations[0]! };
	} catch (error) {
		await m.close();
		throw error;
	}
}

for (const field of ["state", "scope"] as const) {
	test(
		"Pocket memory corruption: an array-coerced " + field + " cannot become a trusted restored mutation",
		{ timeout: 10000 },
		async () => {
			const f = await fixture();
			try {
				const service = await f.prepared.attach({ runtime: f.m.runtime, people: f.people });
				await service
					.bind(f.owner, f.target)
					.add({ requestId: "seed", scope: "project", text: "SAFE-APPROVED-LESSON" });
				const store = f.m.runtime.store({ namespace: options.namespace, maxBytes: 1048576 }),
					saved = await store.snapshot(),
					data = structuredClone(saved.data);
				const operations = data.operations;
				assert.ok(Array.isArray(operations));
				const operation = operations[0];
				assert.ok(record(operation));
				const result = operation.result;
				assert.ok(record(result));
				if (field === "state") Reflect.set(result, "state", ["done"]);
				else {
					const lesson = result.lesson;
					assert.ok(record(lesson));
					Reflect.set(lesson, "scope", ["project"]);
				}
				await store.compareAndSet(saved.version, data, () => {});
				await assert.rejects(service.bind(f.owner, f.target).read(), /memory records/i);
				assert.equal(f.m.f.requests.length, 0);
			} finally {
				await f.m.close();
			}
		},
	);
}

test(
	"Pocket memory shared namespace: a second approved binding cannot leave the first source's dispatch check stale",
	{ timeout: 10000 },
	async (t) => {
		const release = deferred();
		let resolving = false;
		const f = await fixture({
			resolveApiKey: async () => {
				resolving = true;
				await release.promise;
				return "SYNTHETIC-MEMORY-KEY";
			},
		});
		try {
			const one = await f.prepared.attach({ runtime: f.m.runtime, people: f.people });
			await one
				.bind(f.owner, f.target)
				.add({ requestId: "seed", scope: "project", text: "MUST-BE-FENCED-WHEN-DISABLED" });
			const second = createPocketMemory(options),
				two = await second.attach({ runtime: f.m.runtime, people: f.people });
			const host = f.m.runtime.root();
			await host
				.connect("operator", ["input.submit"])
				.submit({ key: "waiting", text: "DELAYED-MEMORY-DISPATCH" });
			await t.waitFor(() => assert.equal(resolving, true), { timeout: 2000 });
			await two
				.bind(f.owner, f.target)
				.setEnabled({ requestId: "disable-through-second-binding", enabled: false });
			release.resolve();
			await host.waitForIdle();
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 1);
		} finally {
			release.resolve();
			await f.m.close();
		}
	},
);

test(
	"Pocket memory effect boundary: revocation while the real CAS is waiting prevents a new lesson",
	{ timeout: 10000 },
	async (t) => {
		const f = await fixture(),
			arrived = deferred(),
			release = deferred();
		let waiting = false;
		const original = f.m.runtime.store.bind(f.m.runtime);
		const runtime: Runtime = Object.freeze({
			...f.m.runtime,
			store(input: Parameters<Runtime["store"]>[0]) {
				const port = original(input);
				if (input.namespace !== options.namespace) return port;
				return Object.freeze({
					...port,
					compareAndSet: async (...args: Parameters<typeof port.compareAndSet>) => {
						waiting = true;
						arrived.resolve();
						await release.promise;
						return port.compareAndSet(...args);
					},
				});
			},
		});
		try {
			const service = await f.prepared.attach({ runtime, people: f.people }),
				invitation = await f.people.invite(f.owner, {
					requestId: "sender",
					role: "sender",
					resources: [f.target.conversationId],
					ttlMs: 60000,
				});
			assert.ok(invitation.token);
			const session = await f.people.redeem(invitation.token, "Sender"),
				sender = await f.people.authenticate(session.token);
			const pending = service
				.bind(sender, f.target)
				.add({ requestId: "late", scope: "project", text: "MUST-NOT-COMMIT-AFTER-REVOCATION" });
			const denied = assert.rejects(pending, /denied|unconfirmed/i);
			await t.waitFor(() => assert.equal(waiting, true), { timeout: 2000 });
			await arrived.promise;
			await f.people.revokePerson(f.owner, sender.person.id);
			release.resolve();
			await denied;
			const saved = await original({ namespace: options.namespace, maxBytes: 1048576 }).snapshot();
			assert.equal(saved.version, 0);
			assert.deepEqual(saved.data, {});
			assert.equal(f.m.f.requests.length, 0);
		} finally {
			release.resolve();
			await f.m.close();
		}
	},
);

test(
	"Pocket memory confirmation: losing the real committed CAS result resolves the exact saved request without applying it again",
	{ timeout: 10000 },
	async () => {
		const f = await fixture(),
			original = f.m.runtime.store.bind(f.m.runtime);
		let commits = 0;
		const runtime: Runtime = Object.freeze({
			...f.m.runtime,
			store(input: Parameters<Runtime["store"]>[0]) {
				const port = original(input);
				if (input.namespace !== options.namespace) return port;
				return Object.freeze({
					...port,
					compareAndSet: async (...args: Parameters<typeof port.compareAndSet>) => {
						const result = await port.compareAndSet(...args);
						commits++;
						if (commits === 1) throw Error("TEST LOST COMMITTED MEMORY RESULT");
						return result;
					},
				});
			},
		});
		try {
			const service = await f.prepared.attach({ runtime, people: f.people }),
				client = service.bind(f.owner, f.target),
				input = { requestId: "once", scope: "project" as const, text: "ONE-REAL-MEMORY-COMMIT" };
			const first = await client.add(input);
			assert.equal(first.state, "done");
			assert.deepEqual(await client.add(input), first);
			assert.deepEqual(await client.operation(input.requestId), first);
			assert.equal(commits, 1);
			assert.equal((await client.read()).lessons.length, 1);
			assert.equal(f.m.f.requests.length, 0);
		} finally {
			await f.m.close();
		}
	},
);
