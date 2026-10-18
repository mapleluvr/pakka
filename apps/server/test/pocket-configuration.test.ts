import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";

// A settings page that displays raw bootstrap configuration would leak credentials or profiles outside the person's ceiling.
test("Pocket configuration: passive frozen choices and scoped usage hide secrets, peer totals and forbidden profiles", async () => {
	const m = await runtimeFixture({
		apiKey: "PRIVATE-SETTINGS-KEY",
		profiles: [
			{ id: "alternate", model: "alternate-model", cwd: process.cwd() },
			{ id: "secret-profile", model: "PRIVATE-MODEL-CANARY" },
		],
	});
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "settings-people" });
		const session = await people.initializeOwner("Owner"),
			actor = await people.authenticate(session.token);
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog: { namespace: "settings-workspace", maxDeliveries: 8, maxPending: 2 },
			profileCeiling: () => ["default", "alternate"],
		});
		const client = workspace.bind(actor),
			ref = await client.create({ requestId: "main", name: "Main", profile: "default" });
		const owner = await client.configuration(ref);
		assert.ok(Object.isFrozen(owner) && Object.isFrozen(owner.choices));
		assert.deepEqual(owner.choices, [
			{ id: "default", model: "local-model", cwd: m.f.cwd },
			{ id: "alternate", model: "alternate-model", cwd: process.cwd() },
		]);
		assert.equal(owner.canConfigure, true);
		assert.deepEqual(owner.session?.budget, { primaryAttempts: 0, auxiliaryAttempts: 0 });
		const invite = await people.invite(actor, {
			requestId: "viewer",
			role: "viewer",
			resources: [ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const viewerSession = await people.redeem(invite.token, "Viewer"),
			viewer = await people.authenticate(viewerSession.token);
		const limited = await workspace.bind(viewer).configuration(ref);
		assert.equal(limited.canConfigure, false);
		assert.equal(limited.session, null);
		assert.equal(limited.usage.cost, null);
		assert.doesNotMatch(
			JSON.stringify([owner, limited]),
			/PRIVATE-SETTINGS-KEY|PRIVATE-MODEL-CANARY|secret-profile|endpoint|apiKey/,
		);
		const foreign = await client.create({ requestId: "foreign", name: "Private", profile: "default" });
		await assert.rejects(workspace.bind(viewer).configuration(foreign), /denied/i);
		await assert.rejects(workspace.bind(viewer).configure(ref, "alternate"), /denied/i);
		assert.equal(m.f.requests.length, 0);
		await people.revokePerson(actor, viewer.person.id);
		await assert.rejects(async () => workspace.bind(viewer).configuration(ref), /denied/i);
	} finally {
		await m.close();
	}
});
