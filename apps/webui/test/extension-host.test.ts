import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { createRuntime } from "@pakka/agent";
import { createPocketPeople, createPocketWorkspace } from "@pakka/server/pocket";
import { createExtensionHost } from "../src/extension-host.ts";
import { decodeManifest } from "../src/extension.ts";

const empty = { type: "object", properties: {}, required: [] };
const text = { type: "object", properties: { text: { type: "string", maxLength: 128 } }, required: ["text"] };
const policy = {
	version: 1,
	scope: "conversation",
	permission: "send",
	effect: "write",
	timeoutMs: 1000,
	input: empty,
	output: text,
};
const definition = {
	api: 1,
	id: "settings-example",
	version: "1.0.0",
	title: "Settings example",
	facets: { backend: "backend.mjs", webui: { entry: "index.js", publicDir: "web" } },
	services: ["gate"],
	actions: [
		{ ...policy, id: "set", input: text },
		{ ...policy, id: "read", effect: "read", permission: "read" },
		{ ...policy, id: "card" },
		{ ...policy, id: "uncertain", effect: "model" },
		{ ...policy, id: "delayed" },
	],
	commands: [{ id: "status", title: "Read setting", slash: "settings-status", action: "read" }],
	interfaces: [
		{
			id: "settings",
			title: "Settings",
			slot: "settings",
			scope: "conversation",
			export: "Settings",
			navigation: true,
		},
	],
};
async function fixture() {
	const m = await runtimeFixture(),
		root = join(m.f.root, "plugin"),
		entered = deferred(),
		release = deferred();
	await mkdir(join(root, "web"), { recursive: true });
	await writeFile(join(root, "manifest.json"), JSON.stringify(definition));
	await writeFile(join(root, "web/index.js"), 'export function Settings(){ return "Example settings"; }');
	await writeFile(
		join(root, "backend.mjs"),
		`export const actions = {
		set: async (ctx, input) => { const old = await ctx.settings.get("label"); await ctx.settings.compareAndSet("label", old.version, input); return input; },
		read: async ctx => { const old = await ctx.settings.get("label"); return old.value ?? {text:"empty"}; },
		card: async ctx => { await ctx.display("card", "SHARED-PLUGIN-CARD"); return {text:"card saved"}; },
		uncertain: async ctx => { await ctx.submit({text:"EXPLICIT-PLUGIN-WORK",mode:"prompt"}); throw new Error("result lost after native effect"); },
		delayed: async ctx => { await ctx.service("gate").wait(); await ctx.display("card", "LATE-UNAUTHORIZED-CARD"); return {text:"late"}; }
	};`,
	);
	const people = await createPocketPeople({ runtime: m.runtime, namespace: "ext.people" });
	const session = await people.initializeOwner("Owner"),
		actor = await people.authenticate(session.token);
	const workspace = createPocketWorkspace({
		runtime: m.runtime,
		people,
		catalog: { namespace: "ext.workspace", maxDeliveries: 32, maxPending: 8 },
		profileCeiling: () => ["default"],
	});
	const target = await workspace.bind(actor).create({ requestId: "one", name: "Work", profile: "default" });
	const services = {
		gate: {
			permission: "read" as const,
			bind: () =>
				Object.freeze({
					wait: async () => {
						entered.resolve();
						await release.promise;
					},
				}),
		},
	};
	const host = await createExtensionHost({
		runtime: m.runtime,
		people,
		workspace,
		sources: [{ root }],
		services,
	});
	const registration = host.list(actor, target)[0]!;
	return {
		...m,
		root,
		entered,
		release,
		services,
		people,
		actor,
		session,
		workspace,
		target,
		host,
		registration,
		call: (action: string, requestId: string, input = {}) =>
			host.call(actor, {
				extension: registration.manifest.id,
				generation: registration.generation,
				action,
				requestId,
				input,
				target,
			}),
	};
}

test(
	"Extension backend: actual scoped CAS setting and display-only card are reconciled; private user setting never becomes model input",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			assert.doesNotThrow(
				() => decodeManifest(m.registration.manifest),
				"a discovered declaration must remain usable through the public contract",
			);
			const result = await m.call("set", "setting", { text: "PRIVATE-SETTING-CANARY" });
			assert.equal(result.state, "done");
			assert.deepEqual((await m.call("read", "read")).value, { text: "PRIVATE-SETTING-CANARY" });
			assert.deepEqual(await m.call("set", "setting", { text: "PRIVATE-SETTING-CANARY" }), result);
			await assert.rejects(m.call("set", "setting", { text: "changed" }), /conflict/i);
			await m.call("card", "card");
			await m.call("card", "card");
			const client = m.workspace.bind(m.actor);
			assert.equal(
				(await client.read(m.target)).entries.filter((e) => e.display?.text === "SHARED-PLUGIN-CARD").length,
				1,
			);
			const sent = await client.submit(m.target, { requestId: "after", text: "AFTER-CARD", mode: "prompt" });
			assert.equal((await client.wait(sent.id)).status, "done");
			assert.equal(JSON.stringify(m.f.requests).includes("PRIVATE-SETTING-CANARY"), false);
			assert.equal(JSON.stringify(m.f.requests).includes("SHARED-PLUGIN-CARD"), false);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension backend: a real native effect then failure remains unknown and identical retry never re-enters the handler",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const unknown = await m.call("uncertain", "same");
			assert.equal(unknown.state, "unknown");
			await m.runtime.waitForIdle();
			assert.deepEqual(await m.call("uncertain", "same"), unknown);
			assert.deepEqual(await m.host.operation(m.actor, unknown.id), unknown);
			assert.equal(m.f.requests.length, 1);
			await m.host.setEnabled(m.actor, m.registration.manifest.id, false);
			await assert.rejects(m.call("uncertain", "late"));
			assert.equal(m.f.requests.length, 1);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension backend: viewer cannot mutate and stale generations or modified assets are refused",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const invite = await m.people.invite(m.actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [m.target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const viewer = await m.people.authenticate((await m.people.redeem(invite.token, "Viewer")).token);
			await assert.rejects(
				m.host.call(viewer, {
					extension: m.registration.manifest.id,
					generation: m.registration.generation,
					action: "set",
					requestId: "no",
					input: { text: "no" },
					target: m.target,
				}),
			);
			const asset = await m.host.asset(
				viewer,
				m.registration.manifest.id,
				m.registration.generation,
				"index.js",
				m.target,
			);
			assert.match(new TextDecoder().decode(asset.body), /Example settings/);
			await writeFile(join(m.root, "web/index.js"), "throw new Error('new unaccepted bytes')");
			await assert.rejects(
				m.host.asset(viewer, m.registration.manifest.id, m.registration.generation, "index.js", m.target),
			);
			await writeFile(join(m.root, "manifest.json"), '{"api":99}');
			await assert.rejects(m.host.reload(m.actor, m.registration.manifest.id));
			await assert.rejects(
				m.host.asset(viewer, m.registration.manifest.id, m.registration.generation, "index.js", m.target),
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension backend: normal writer reopen reconciles done/unknown records and user settings without re-executing native effects",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const saved = await m.call("set", "setting", { text: "PERSISTED-SETTING" }),
				uncertain = await m.call("uncertain", "uncertain");
			await m.runtime.waitForIdle();
			const file = m.runtime.view().sessionFile;
			await m.runtime.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			const people = await createPocketPeople({ runtime: reopened, namespace: "ext.people" }),
				actor = await people.authenticate(m.session.token);
			const workspace = createPocketWorkspace({
				runtime: reopened,
				people,
				catalog: { namespace: "ext.workspace", maxDeliveries: 32, maxPending: 8 },
				profileCeiling: () => ["default"],
			});
			const host = await createExtensionHost({
					runtime: reopened,
					people,
					workspace,
					sources: [{ root: m.root }],
					services: m.services,
				}),
				generation = host.list(actor, m.target)[0]!.generation;
			const call = (action: string, requestId: string, input = {}) =>
				host.call(actor, {
					extension: "settings-example",
					generation,
					action,
					requestId,
					input,
					target: m.target,
				});
			assert.deepEqual(await call("set", "setting", { text: "PERSISTED-SETTING" }), saved);
			assert.deepEqual(await call("uncertain", "uncertain"), uncertain);
			assert.deepEqual((await call("read", "new-read")).value, { text: "PERSISTED-SETTING" });
			assert.equal(m.f.requests.length, 1);
			await assert.rejects(m.call("read", "old-binding"));
		} finally {
			await reopened?.close();
			await m.close();
		}
	},
);

test(
	"Extension backend: revocation while a declared service awaits prevents the later controlled display effect",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const invitation = await m.people.invite(m.actor, {
				requestId: "sender",
				role: "sender",
				resources: [m.target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const guest = await m.people.authenticate((await m.people.redeem(invitation.token, "Guest")).token);
			const running = m.host.call(guest, {
				extension: "settings-example",
				generation: m.registration.generation,
				action: "delayed",
				requestId: "delay",
				input: {},
				target: m.target,
			});
			await m.entered.promise;
			await m.people.revokePerson(m.actor, guest.person.id);
			m.release.resolve();
			assert.equal((await running).state, "unknown");
			assert.equal(
				(await m.workspace.bind(m.actor).read(m.target)).entries.some(
					(entry) => entry.display?.text === "LATE-UNAUTHORIZED-CARD",
				),
				false,
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			m.release.resolve();
			await m.close();
		}
	},
);

test(
	"Extension backend: user settings and operation receipts cannot be read using another authorized person's session",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const saved = await m.call("set", "private", { text: "PRIVATE-OWNER-SETTING" });
			const invitation = await m.people.invite(m.actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [m.target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const guest = await m.people.authenticate((await m.people.redeem(invitation.token, "Viewer")).token);
			const read = await m.host.call(guest, {
				extension: "settings-example",
				generation: m.registration.generation,
				action: "read",
				requestId: "private",
				input: {},
				target: m.target,
			});
			assert.deepEqual(read.value, { text: "empty" });
			await assert.rejects(m.host.operation(guest, saved.id));
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
