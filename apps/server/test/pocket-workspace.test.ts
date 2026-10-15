import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";

async function setup() {
	const m = await runtimeFixture({
		profiles: [
			{ id: "safe", systemPrompt: "SAFE-HUMAN-PROFILE" },
			{ id: "powerful", systemPrompt: "PRIVILEGED-PROFILE-CANARY" },
		],
	});
	const people = await createPocketPeople({ runtime: m.runtime, namespace: "people" });
	const session = await people.initializeOwner("Owner");
	const admin = await people.authenticate(session.token);
	return { m, people, admin };
}
const catalog = { namespace: "pocket-workbench", maxDeliveries: 32, maxPending: 8 };

// Runtime-approved profiles alone must not let a lower-ceiling person select stronger Agent authority.
test("Pocket workspace: human create/configure/fork stay inside the host-selected profile ceiling", async () => {
	const { m, people, admin } = await setup();
	try {
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog,
			profileCeiling: () => ["safe", "default"],
		});
		const client = workspace.bind(admin);
		await assert.rejects(
			client.create({ requestId: "forbidden", name: "Privileged", profile: "powerful" }),
			/profile|ceiling|denied/i,
		);
		const ref = await client.create({ requestId: "main", name: "Main", profile: "safe" });
		assert.equal(
			(await client.create({ requestId: "main", name: "Main", profile: "safe" })).conversationId,
			ref.conversationId,
		);
		await assert.rejects(client.create({ requestId: "main", name: "Changed", profile: "safe" }), /conflict/i);
		await assert.rejects(client.configure(ref, "powerful"), /profile|ceiling|denied/i);
		const admitted = await client.submit(ref, {
			requestId: "first",
			text: "SHARED-BEFORE-FORK",
			mode: "prompt",
		});
		assert.equal((await client.wait(admitted.id)).status, "done");
		const snapshot = await client.read(ref);
		const cutoff = snapshot.entries
			.filter((entry) => entry.messages.some((message) => message.role === "assistant"))
			.at(-1)?.id;
		assert.ok(cutoff);
		const count = m.runtime.view().conversations.length;
		await assert.rejects(
			client.fork(ref, {
				requestId: "fork-denied",
				entryId: cutoff,
				name: "Privileged fork",
				profile: "powerful",
			}),
			/profile|ceiling|denied/i,
		);
		assert.equal(m.runtime.view().conversations.length, count);
		const forked = await client.fork(ref, {
			requestId: "fork",
			entryId: cutoff,
			name: "Alternative",
			profile: "safe",
		});
		assert.notEqual(forked.conversationId, ref.conversationId);
		assert.ok(
			(await client.read(forked)).entries.some((entry) =>
				JSON.stringify(entry.messages).includes("SHARED-BEFORE-FORK"),
			),
		);
		const changed = await client.configure(forked, "default");
		assert.equal(changed.profile, "default");
		assert.notEqual(changed.incarnation, forked.incarnation);
		assert.equal(m.f.requests.length, 1);
		assert.equal(JSON.stringify(m.f.requests).includes("PRIVILEGED-PROFILE-CANARY"), false);
	} finally {
		await m.close();
	}
});

// A visibility filter in the browser or a copied authority object would expose a private Conversation.
test("Pocket workspace: views and actions bind to the real human identity and current resource scope", async () => {
	const { m, people, admin } = await setup();
	try {
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog,
			profileCeiling: () => ["safe"],
		});
		const owner = workspace.bind(admin),
			visible = await owner.create({ requestId: "visible", name: "Visible", profile: "safe" }),
			privateRef = await owner.create({ requestId: "private", name: "Private", profile: "safe" });
		await owner.display(privateRef, { requestId: "canary", kind: "chat", text: "OTHER-RESOURCE-CANARY" });
		const invite = await people.invite(admin, {
			requestId: "viewer",
			role: "viewer",
			resources: [visible.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const session = await people.redeem(invite.token, "Visitor"),
			actor = await people.authenticate(session.token),
			viewer = workspace.bind(actor);
		assert.deepEqual(await viewer.list(), [visible]);
		await assert.rejects(viewer.read(privateRef), /denied|scope/i);
		await assert.rejects(
			viewer.display(visible, { requestId: "write", kind: "chat", text: "Forbidden" }),
			/denied/i,
		);
		await assert.rejects(
			viewer.submit(visible, { requestId: "write", text: "Forbidden", mode: "prompt" }),
			/denied/i,
		);
		assert.throws(() => workspace.bind({ ...admin }), /authority|denied/i);
		assert.throws(
			() => workspace.bind({ person: admin.person, check: () => {}, verifyCsrf: () => {} }),
			/authority|denied/i,
		);
		await people.revokePerson(admin, actor.person.id);
		await assert.rejects(viewer.list(), /denied/i);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// Rechecking only before an awaited catalog read would admit a profile after the host removes it.
test("Pocket workspace: a removed profile ceiling during creation produces no native member", async () => {
	const { m, people, admin } = await setup();
	let allowed = true;
	try {
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog,
			profileCeiling: () => (allowed ? ["safe"] : []),
		});
		const before = m.runtime.view().conversations.length;
		const creating = workspace.bind(admin).create({ requestId: "late", name: "Late", profile: "safe" });
		allowed = false;
		await assert.rejects(creating, /ceiling|profile|denied/i);
		assert.equal(m.runtime.view().conversations.length, before);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
