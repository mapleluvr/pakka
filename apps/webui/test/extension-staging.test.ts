import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile, access, symlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "./fixture.ts";
import { createExtensionHost } from "../src/extension-host.ts";
import { decodeExtensionResponse } from "../src/extension-rpc.ts";

const manifest = {
	api: 1,
	id: "staging",
	version: "1.0.0",
	title: "Staging example",
	facets: { backend: "backend.mjs", webui: { entry: "index.js", publicDir: "web" } },
	actions: [
		{
			id: "status",
			version: 1,
			scope: "app",
			permission: "read",
			effect: "read",
			timeoutMs: 1000,
			input: { type: "object", properties: {}, required: [] },
			output: { type: "string", maxLength: 80 },
		},
	],
	commands: [{ id: "status", title: "Staging status", slash: "staging", action: "status" }],
	interfaces: [],
};
async function source(root: string, backend: string) {
	await mkdir(join(root, "web"), { recursive: true });
	await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
	await writeFile(join(root, "backend.mjs"), backend);
	await writeFile(join(root, "web/index.js"), "export const ready=true;");
	return { root };
}
const backend = 'export const actions={status:()=>"known"};';

test(
	"Extension staging: a batch identity/command collision is rejected before any backend module effect",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const marker = join(m.f.root, "module-side-effect");
			const effect = `import {writeFileSync} from "node:fs";writeFileSync(new URL(${JSON.stringify(pathToFileURL(marker).href)}),"effect");${backend}`;
			const sources = [
				await source(join(m.f.root, "first"), effect),
				await source(join(m.f.root, "second"), effect),
			];
			await assert.rejects(
				createExtensionHost({ runtime: m.runtime, people: m.people, workspace: m.workspace, sources }),
				/conflict/i,
			);
			await assert.rejects(access(marker), { code: "ENOENT" });
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension staging: a failed backend import seals the registration as unknown until explicit successful reload",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const approved = await source(join(m.f.root, "reload"), backend);
			const host = await createExtensionHost({
					runtime: m.runtime,
					people: m.people,
					workspace: m.workspace,
					sources: [approved],
				}),
				registration = host.list(m.actor)[0]!;
			await writeFile(join(approved.root, "backend.mjs"), 'throw new Error("unconfirmed module effect");');
			await assert.rejects(host.reload(m.actor, "staging"));
			assert.equal(host.list(m.actor)[0]!.phase, "unknown");
			await assert.rejects(
				host.call(m.actor, {
					extension: "staging",
					generation: registration.generation,
					action: "status",
					requestId: "old",
					input: {},
				}),
			);
			await host.setEnabled(m.actor, "staging", false);
			await assert.rejects(host.setEnabled(m.actor, "staging", true));
			await writeFile(join(approved.root, "backend.mjs"), backend + "\n// confirmed revision");
			await host.reload(m.actor, "staging");
			await host.setEnabled(m.actor, "staging", true);
			const restored = host.list(m.actor)[0]!;
			assert.equal(restored.phase, "ready");
			assert.equal(
				(
					await host.call(m.actor, {
						extension: "staging",
						generation: restored.generation,
						action: "status",
						requestId: "new",
						input: {},
					})
				).value,
				"known",
			);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension staging: repeated enable/disable retains a finite discoverable generation and refuses public junctions",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const approved = await source(join(m.f.root, "bounds"), backend);
			const host = await createExtensionHost({
				runtime: m.runtime,
				people: m.people,
				workspace: m.workspace,
				sources: [approved],
			});
			for (let index = 0; index < 8; index++) {
				await host.setEnabled(m.actor, "staging", false);
				await host.setEnabled(m.actor, "staging", true);
			}
			assert.doesNotThrow(() =>
				decodeExtensionResponse(
					{
						version: 2,
						serverId: "server",
						requestId: "list",
						result: { kind: "registrations", registrations: host.list(m.actor) },
					},
					"list",
				),
			);
			const privateDir = join(m.f.root, "private");
			await mkdir(privateDir);
			await writeFile(join(privateDir, "private.js"), "PRIVATE-CANARY");
			await symlink(privateDir, join(approved.root, "web", "junction"), "junction");
			await assert.rejects(host.reload(m.actor, "staging"));
			assert.equal(host.list(m.actor)[0]!.phase, "ready");
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension facets: a client-only entry is served without loading backend or requiring a Web interface",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const approved = await source(join(m.f.root, "client-only"), backend);
			await writeFile(
				join(approved.root, "manifest.json"),
				JSON.stringify({ ...manifest, facets: { client: "client.js" }, actions: [], commands: [] }),
			);
			await writeFile(join(approved.root, "client.js"), "export const bind=client=>client;");
			const host = await createExtensionHost({
					runtime: m.runtime,
					people: m.people,
					workspace: m.workspace,
					sources: [approved],
				}),
				registration = host.list(m.actor)[0]!;
			const asset = await host.asset(m.actor, "staging", registration.generation, "client.js");
			assert.match(new TextDecoder().decode(asset.body), /export const bind/);
			assert.deepEqual(registration.facets, ["client"]);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension facets: persisted disable does not execute its backend on host reopen",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const approved = await source(join(m.f.root, "disabled"), backend),
				options = { runtime: m.runtime, people: m.people, workspace: m.workspace, sources: [approved] };
			const host = await createExtensionHost(options);
			await host.setEnabled(m.actor, "staging", false);
			await writeFile(join(approved.root, "backend.mjs"), 'throw new Error("backend must remain unloaded");');
			const next = await createExtensionHost(options);
			assert.equal(next.list(m.actor)[0]!.phase, "disabled");
			await assert.rejects(next.setEnabled(m.actor, "staging", true));
			assert.equal(next.list(m.actor)[0]!.phase, "unknown");
		} finally {
			await m.close();
		}
	},
);
