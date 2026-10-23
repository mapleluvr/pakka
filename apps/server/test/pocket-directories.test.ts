import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";

// A directory picker must read server folders, not files or symlink destinations outside authorized project trees.
test("WebUI directories: authorized browsing, independent changes and revocation use current resource authority", async () => {
	const m = await runtimeFixture({
		profiles: [{ id: "other-model", model: "alternate-model", systemPrompt: "DO-NOT-APPLY" }],
	});
	try {
		const child = join(m.f.cwd, "child"),
			outside = join(m.f.root, "outside");
		await mkdir(child);
		await mkdir(outside);
		await symlink(outside, join(m.f.cwd, "escape"), "dir");
		await writeFile(join(m.f.cwd, "not-folder"), "file");
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "directory-people" });
		const owner = await people.initializeOwner("Owner"),
			actor = await people.authenticate(owner.token);
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog: { namespace: "directories", maxDeliveries: 16, maxPending: 4 },
			profileCeiling: () => ["default", "other-model"],
		});
		const client = workspace.bind(actor);
		let ref = await client.create({ requestId: "main", name: "Project", profile: "default" });
		const view = await client.directories(ref, { places: [child, outside, join(m.f.cwd, "escape")] });
		assert.equal(view.path, m.f.cwd);
		assert.equal(view.parent, null);
		assert.deepEqual(view.roots, [m.f.cwd]);
		assert.deepEqual(view.directories, [child]);
		assert.deepEqual(view.places, [child]);
		await assert.rejects(client.directories(ref, { path: outside }), /denied|directory/i);
		await assert.rejects(client.directories(ref, { path: join(m.f.cwd, "escape") }), /denied|directory/i);
		ref = await client.configureAgent(ref, { model: "alternate-model" });
		assert.deepEqual((await client.configuration(ref)).current, { model: "alternate-model", cwd: m.f.cwd });
		ref = await client.configureAgent(ref, { cwd: child });
		assert.deepEqual((await client.configuration(ref)).current, { model: "alternate-model", cwd: child });
		const inherited = await client.create({
			requestId: "inherited",
			name: "Inherited",
			profile: "default",
			inherit: ref,
		});
		assert.deepEqual((await client.configuration(inherited)).current, {
			model: "alternate-model",
			cwd: child,
		});
		const invitation = await people.invite(actor, {
			requestId: "viewer",
			role: "viewer",
			resources: [ref.conversationId],
			ttlMs: 60000,
		});
		const joined = await people.redeem(invitation.token!, "Viewer"),
			viewer = await people.authenticate(joined.token),
			limited = workspace.bind(viewer);
		assert.equal((await limited.configuration(ref)).canConfigure, false);
		await assert.rejects(limited.directories(ref, {}), /denied/i);
		await assert.rejects(limited.configureAgent(ref, { cwd: m.f.cwd }), /denied/i);
		await people.revokePerson(actor, viewer.person.id);
		await assert.rejects(limited.configuration(ref), /denied/i);
		assert.equal(m.f.requests.length, 0);
		assert.equal(m.runtime.view().budget.primaryAttempts, 0);
	} finally {
		await m.close();
	}
});
