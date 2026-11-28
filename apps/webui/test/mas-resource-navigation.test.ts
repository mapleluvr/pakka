import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve, join } from "node:path";
import { createMas, type Mas } from "@pakka/mas";
import { masWorkbenchService } from "../../../packages/mas-devpack/src/backend.ts";
import { masAgentPrincipal } from "../../../packages/mas-devpack/src/ownership.ts";
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
						.connect({ principal: masAgentPrincipal(parent.ref), source: parent.ref, grants: ["spawn"] })
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
			const original = { requestId: "human-input", text: "HUMAN-CONVERSATION", mode: "prompt" as const };
			assert.equal(await client.inputReceipt(child, original), null);
			assert.deepEqual((await client.inputHistory(child)).items, []);
			const sent = await client.submit(child, original);
			assert.equal((await client.wait(sent.id)).status, "done");
			assert.equal((await client.inputReceipt(child, original))?.id, sent.id);
			await assert.rejects(client.inputReceipt(child, { ...original, text: "DIFFERENT" }));
			const inputs = await client.inputHistory(child);
			assert.equal(inputs.items.length, 1);
			assert.equal(inputs.items[0]!.receipt.id, sent.id);
			assert.equal(inputs.items[0]!.preview, original.text);
			assert.equal(m.f.requests.length, 1);
			assert.ok((await client.read(child)).entries.length > 0);
			const config = await client.configurationOptions(child);
			assert.equal(config.configuration.canConfigure, true);
			assert.equal(config.supportsRequests, true);
			assert.ok(config.configuration.current);
			const configuration = {
				requestId: "member-model",
				target: child,
				selection: { kind: "agent" as const, change: { model: config.configuration.current.model } },
			};
			assert.equal(await client.configurationReceipt(configuration), null);
			const configured = await client.changeConfiguration(configuration);
			assert.equal(configured.actorId, actor.person.id);
			assert.equal(configured.ref.conversationId, child.conversationId);
			const later = await client.changeConfiguration({
				requestId: "member-preset",
				target: configured.ref,
				selection: { kind: "profile", profile: "other" },
			});
			assert.notEqual(later.ref.incarnation, configured.ref.incarnation);
			assert.deepEqual((await client.inputReceipt(child, original))?.target, sent.target);
			await assert.rejects(client.inputReceipt(later.ref, original));
			assert.deepEqual(await client.configurationReceipt(configuration), configured);
			await assert.rejects(
				client.configurationReceipt({ ...configuration, selection: { kind: "profile", profile: "other" } }),
			);
			const adminInvite = await app.people.invite(actor, {
				requestId: "other-admin",
				role: "admin",
				resources: "*",
				ttlMs: 60000,
			});
			assert.ok(adminInvite.token);
			const otherAdmin = app.workspace.bind(
				await app.people.authenticate((await app.people.redeem(adminInvite.token, "Other admin")).token),
			);
			assert.equal(
				(await otherAdmin.configuration(later.ref)).canConfigure,
				false,
				"People admin does not grant MAS ownership",
			);
			await assert.rejects(otherAdmin.configurationReceipt(configuration));
			await assert.rejects(
				otherAdmin.changeConfiguration({ ...configuration, target: later.ref, requestId: "not-owner" }),
			);
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
			await assert.rejects(readOnly.configurationReceipt(configuration));
			assert.equal(await readOnly.inputReceipt(current, original), null);
			assert.deepEqual((await readOnly.inputHistory(current)).items, []);
			await assert.rejects(
				readOnly.submit(current, { requestId: "viewer-send", text: "NO", mode: "prompt" }),
			);
			await assert.rejects(readOnly.abort(current));
			await app.people.revokePerson(actor, viewer.person.id);
			await assert.rejects(readOnly.navigation());
			await assert.rejects(async () => readOnly.inputHistory(current));
			await assert.rejects(async () => readOnly.inputReceipt(current, original));
			assert.equal(m.f.requests.length, 1);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await app?.close();
			await m.f.close();
		}
	},
);
