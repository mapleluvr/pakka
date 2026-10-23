import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";

const catalog = { namespace: "model-selection", maxDeliveries: 16, maxPending: 8 };

// Ignoring an approved profile's model would make settings look changed while the provider still receives the original model.
test("WebUI model choices: an approved profile changes the real next provider request and survives normal reopen without refund", async () => {
	const m = await runtimeFixture({
		apiKey: "SYNTHETIC-MODEL-KEY-CANARY",
		profiles: [
			{ id: "alternate", model: "alternate-local-model", systemPrompt: "ALTERNATE-PROMPT" },
			{ id: "forbidden", model: "forbidden-local-model" },
		],
	});
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "model-people" });
		const session = await people.initializeOwner("Owner"),
			actor = await people.authenticate(session.token);
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog,
			profileCeiling: () => ["default", "alternate"],
		});
		const client = workspace.bind(actor),
			original = await client.create({ requestId: "main", name: "Main", profile: "default" });
		const first = await client.submit(original, {
			requestId: "first",
			text: "FIRST-MODEL-WORK",
			mode: "prompt",
		});
		assert.equal((await client.wait(first.id)).status, "done");
		assert.equal(m.f.requests[0]?.model, "local-model");
		await assert.rejects(client.configure(original, "forbidden"), /profile|ceiling|denied/i);
		const changed = await client.configure(original, "alternate");
		assert.equal(changed.conversationId, original.conversationId);
		assert.notEqual(changed.incarnation, original.incarnation);
		await assert.rejects(
			client.submit(original, { requestId: "stale", text: "STALE", mode: "prompt" }),
			/stale|denied|ref/i,
		);
		const second = await client.submit(changed, {
			requestId: "second",
			text: "SECOND-MODEL-WORK",
			mode: "prompt",
		});
		assert.equal((await client.wait(second.id)).status, "done");
		assert.equal(m.f.requests[1]?.model, "alternate-local-model");
		const snapshot = await client.read(changed);
		assert.equal(snapshot.usage.cost, null);
		assert.equal(JSON.stringify(snapshot).includes("SYNTHETIC-MODEL-KEY-CANARY"), false);
		assert.equal(m.runtime.view().budget.primaryAttempts, 2);
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		await assert.rejects(
			createRuntime({
				...m.config,
				reopenSessionFile: file,
				profiles: m.config.profiles!.map((profile) =>
					profile.id === "alternate" ? { ...profile, model: "changed-approved-model" } : profile,
				),
			}),
			/profile|reopen|changed/i,
		);
		assert.equal(
			m.f.requests.length,
			2,
			"a changed bootstrap model must not silently retarget recovered work",
		);
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		const restoredPeople = await createPocketPeople({ runtime: reopened, namespace: "model-people" });
		const restored = createPocketWorkspace({
			runtime: reopened,
			people: restoredPeople,
			catalog,
			profileCeiling: () => ["default", "alternate"],
		}).bind(await restoredPeople.authenticate(session.token));
		assert.deepEqual(await restored.list(), [changed]);
		assert.equal(reopened.view().budget.primaryAttempts, 2);
		const again = await restored.submit(changed, {
			requestId: "second",
			text: "SECOND-MODEL-WORK",
			mode: "prompt",
		});
		assert.equal(again.id, second.id);
		assert.equal(m.f.requests.length, 2);
		const third = await restored.submit(changed, {
			requestId: "third",
			text: "AFTER-REOPEN",
			mode: "prompt",
		});
		assert.equal((await restored.wait(third.id)).status, "done");
		assert.equal(m.f.requests[2]?.model, "alternate-local-model");
		assert.equal(reopened.view().budget.primaryAttempts, 3);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

// A malformed bootstrap model choice must fail before creating storage, rather than being ignored or normalized into another model.
test("WebUI model choices: invalid approved model identifiers reject before storage or provider effects", async () => {
	const m = await runtimeFixture();
	try {
		for (const [index, model] of ["", " whitespace-model ", "x".repeat(257), null, 42, false].entries()) {
			const dataDir = join(m.f.root, "invalid-model-" + index);
			let unexpected: Awaited<ReturnType<typeof createRuntime>> | undefined;
			try {
				await assert.rejects(async () => {
					unexpected = await Reflect.apply(createRuntime, undefined, [
						{ ...m.config, dataDir, profiles: [{ id: "invalid", model }] },
					]);
				}, /model|profile/i);
			} finally {
				await unexpected?.close();
			}
			await assert.rejects(access(dataDir));
		}
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
