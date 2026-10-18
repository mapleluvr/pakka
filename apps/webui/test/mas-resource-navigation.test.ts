import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve, join } from "node:path";
import { createMas, type Mas } from "@pakka/mas";
import { masWorkbenchService } from "../../../packages/mas-devpack/src/backend.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";

test(
	"MAS resources: common Conversation navigation preserves MAS ownership, model admission and current read scope",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture({
			profiles: [
				{ id: "plain", tools: [] },
				{ id: "other", tools: [] },
			],
		});
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, mas: Mas | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "product") },
				owner: "Owner",
				profiles: ["plain", "other"],
				initial: [{ name: "Ordinary", profile: "plain" }],
				extensions: [{ root: resolve("packages/mas-devpack/dist") }],
				extensionServices: async (context) => {
					mas = await createMas({
						runtime: context.runtime,
						namespace: "navigation.team",
						maxDeliveries: 32,
						maxPending: 8,
					});
					await mas.bootstrap([{ key: "parent", owner: context.ownerId, profile: "plain" }]);
					await mas.activate();
					const parent = (await mas.view()).members[0]!;
					await mas
						.connect({ principal: context.ownerId, source: parent.ref, grants: ["spawn"] })
						.spawn({ key: "child", profile: "plain", lifetime: "persistent" });
					return { mas: masWorkbenchService({ ...context, mas }) };
				},
			});
			assert.ok(mas);
			assert.ok(app.initialOwner);
			const actor = await app.people.authenticate(app.initialOwner.token),
				client = app.workspace.bind(actor);
			const child = (await mas.view()).members.find((row) => row.key === "child")!.ref;
			const registration = app.extensions.list(actor).find((row) => row.manifest.id === "mas-devpack")!;
			const observed = await app.extensions.call(actor, {
				extension: "mas-devpack",
				generation: registration.generation,
				action: "activities",
				requestId: "activity-read",
				input: { refs: [{ ...child }] },
			});
			assert.equal(observed.state, "done", "The installed extension returns a decoded idle activity");
			assert.ok(Array.isArray(observed.value));
			assert.equal(observed.value[0]?.state, "idle");
			const rows = await client.navigation();
			assert.ok(
				rows.some((row) => row.ref.conversationId === child.conversationId),
				"A registered service exposes its readable Conversation to the shared workspace",
			);
			assert.equal(m.f.requests.length, 0);
			assert.equal((await client.read(child)).ref.conversationId, child.conversationId);
			const sent = await client.submit(child, {
				requestId: "human-input",
				text: "HUMAN-CONVERSATION",
				mode: "prompt",
			});
			assert.equal((await client.wait(sent.id)).status, "done");
			assert.equal(m.f.requests.length, 1);
			assert.ok((await client.read(child)).entries.length > 0);
			const config = await client.configuration(child);
			assert.equal(config.canConfigure, true);
			const changed = await client
				.configureAgent(child, { model: "other-model" })
				.catch(async () => client.configureAgent(child, { model: config.current.model }));
			assert.equal(changed.conversationId, child.conversationId);
			const invitation = await app.people.invite(actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [child.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewer = await app.people.redeem(invitation.token, "Viewer"),
				viewActor = await app.people.authenticate(viewer.token),
				readOnly = app.workspace.bind(viewActor);
			assert.deepEqual(
				(await readOnly.navigation()).map((row) => row.ref.conversationId),
				[child.conversationId],
			);
			const current = (await readOnly.navigation())[0]!.ref;
			assert.equal((await readOnly.read(current)).ref.conversationId, child.conversationId);
			assert.equal((await readOnly.configuration(current)).canConfigure, false);
			await assert.rejects(
				readOnly.submit(current, { requestId: "viewer-send", text: "NO", mode: "prompt" }),
			);
			await assert.rejects(readOnly.abort(current));
			await app.people.revokePerson(actor, viewer.person.id);
			await assert.rejects(readOnly.navigation());
			assert.equal(m.f.requests.length, 1);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await app?.close();
			await m.f.close();
		}
	},
);
