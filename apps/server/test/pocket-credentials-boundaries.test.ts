import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { Runtime, RuntimeStore } from "@pakka/agent";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketCredentials } from "../src/pocket-credentials.ts";

function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test(
	"WebUI private configuration: revoke while waiting at the real CAS boundary prevents the late replacement",
	{ timeout: 10000 },
	async () => {
		const m = await runtimeFixture(),
			entered = gate(),
			resume = gate();
		try {
			const people = await createPocketPeople({
					runtime: m.runtime,
					namespace: "credential-boundary-people",
				}),
				ownerSession = await people.initializeOwner("Owner"),
				owner = await people.authenticate(ownerSession.token);
			const invite = await people.invite(owner, {
				requestId: "admin",
				role: "admin",
				resources: "*",
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const otherSession = await people.redeem(invite.token, "Other admin"),
				other = await people.authenticate(otherSession.token);
			const wrapped: Runtime = {
				...m.runtime,
				store: (options) => {
					const store = m.runtime.store(options);
					const compareAndSet: RuntimeStore["compareAndSet"] = async (expected, data, check) => {
						entered.release();
						await resume.promise;
						return store.compareAndSet(expected, data, check);
					};
					return Object.freeze({ ...store, compareAndSet });
				},
			};
			const credentials = await createPocketCredentials({
				runtime: wrapped,
				people,
				namespace: "credential-boundary",
				bootstrap: () => "SYNTHETIC-BASE",
			});
			const result = credentials
				.bind(other)
				.replace({ requestId: "held", expectedVersion: 0, secret: "SYNTHETIC-LATE" });
			await entered.promise;
			await people.revokePerson(owner, other.person.id);
			resume.release();
			await assert.rejects(result, /denied/i);
			assert.deepEqual(await credentials.bind(owner).status(), { version: 0, configured: true });
			assert.equal(await credentials.resolve(), "SYNTHETIC-BASE");
			assert.equal(m.f.requests.length, 0);
		} finally {
			resume.release();
			await m.close();
		}
	},
);

test(
	"WebUI private configuration: clearing while the preserved bootstrap callback is awaited rejects its late old key",
	{ timeout: 10000 },
	async () => {
		const m = await runtimeFixture(),
			entered = gate(),
			resume = gate();
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "credential-source-people" }),
				session = await people.initializeOwner("Owner"),
				actor = await people.authenticate(session.token);
			let calls = 0;
			const credentials = await createPocketCredentials({
				runtime: m.runtime,
				people,
				namespace: "credential-source",
				bootstrap: async () => {
					calls++;
					entered.release();
					await resume.promise;
					return "SYNTHETIC-OLD-KEY";
				},
			});
			const resolving = credentials.resolve();
			await entered.promise;
			await credentials.bind(actor).clear({ requestId: "clear", expectedVersion: 0 });
			resume.release();
			await assert.rejects(resolving, /changed|unavailable/i);
			await assert.rejects(credentials.resolve(), /configured/i);
			assert.equal(calls, 1, "a clear cannot fall back to an existing source callback");
			assert.equal(m.f.requests.length, 0);
		} finally {
			resume.release();
			await m.close();
		}
	},
);

test("WebUI private configuration: nonzero empty storage is corruption and never reinitializes a secret source", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({
			runtime: m.runtime,
			namespace: "credential-corruption-people",
		});
		const store = m.runtime.store({ namespace: "credential-corruption", maxBytes: 262144 });
		await store.compareAndSet(0, {}, () => {});
		let fallback = 0;
		await assert.rejects(
			createPocketCredentials({
				runtime: m.runtime,
				people,
				namespace: "credential-corruption",
				bootstrap: () => {
					fallback++;
					return "SYNTHETIC-MUST-NOT-READ";
				},
			}),
			/persistence/i,
		);
		assert.equal(fallback, 0);
		assert.equal((await store.snapshot()).version, 1);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("WebUI private configuration: a failing host resolver cannot publish its secret error message or send HTTP", async () => {
	const m = await runtimeFixture({
		resolveApiKey: async () => {
			throw Error("SYNTHETIC-RESOLVER-PRIVATE-ERROR");
		},
	});
	try {
		const host = m.runtime.root(),
			client = host.connect("operator", ["input.submit"]);
		await client.submit({ key: "error", text: "RESOLVER-ERROR-WORK" });
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 0);
		assert.equal(m.runtime.view().budget.primaryAttempts, 1);
		const ref = m.runtime.view().conversations[0]!;
		assert.doesNotMatch(
			JSON.stringify([host.view(), await m.runtime.readConversation(ref, () => {})]),
			/SYNTHETIC-RESOLVER-PRIVATE-ERROR/,
		);
	} finally {
		await m.close();
	}
});
