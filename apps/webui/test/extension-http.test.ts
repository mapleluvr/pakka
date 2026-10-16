import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./fixture.ts";
import { createPocketHttp } from "../src/http.ts";
import { createExtensionHost } from "../src/extension-host.ts";
import { createExtensionClient } from "../src/extension-client.ts";
import { decodeExtensionResponse } from "../src/extension-rpc.ts";

const empty = { type: "object", properties: {}, required: [] };
const manifest = {
	api: 1,
	id: "http-example",
	version: "1.0.0",
	title: "HTTP example",
	facets: { backend: "backend.mjs", webui: { publicDir: "web", entry: "index.js" } },
	actions: [
		{
			id: "card",
			version: 1,
			scope: "conversation",
			permission: "send",
			effect: "write",
			timeoutMs: 1000,
			input: empty,
			output: { type: "string", maxLength: 80 },
		},
		{
			id: "work",
			version: 1,
			scope: "conversation",
			permission: "send",
			effect: "model",
			timeoutMs: 1000,
			input: empty,
			output: { type: "null" },
		},
	],
	commands: [{ id: "card", title: "Save card", slash: "example-card", action: "card" }],
	interfaces: [
		{ id: "home", title: "Example", scope: "app", slot: "page", export: "Home", navigation: true },
	],
};
async function setup() {
	const m = await fixture(),
		root = join(m.f.root, "http-plugin");
	await mkdir(join(root, "web"), { recursive: true });
	await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
	await writeFile(join(root, "web/index.js"), 'export function Home(){return "PUBLIC-PLUGIN-CONTENT";}');
	await writeFile(join(root, "private.txt"), "PRIVATE-SERVER-FILE");
	await writeFile(
		join(root, "backend.mjs"),
		`export const actions={card:async c=>{await c.display("card","HTTP-PLUGIN-CARD");return "saved";},work:async c=>{await c.submit({text:"EXPLICIT-EXTENSION-WORK",mode:"prompt"});throw new Error("effect result lost");}};`,
	);
	const extensions = await createExtensionHost({
		runtime: m.runtime,
		people: m.people,
		workspace: m.workspace,
		sources: [{ root }],
	});
	const http = await createPocketHttp({
		runtime: m.runtime,
		people: m.people,
		workspace: m.workspace,
		extensions,
	});
	async function rpc(command: object, auth = m.admin, extra: Record<string, string> = {}) {
		const requestId = crypto.randomUUID(),
			response = await fetch(http.origin + "/pocket/extensions/rpc", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: http.origin,
					Cookie: auth.cookies,
					"X-Pakka-CSRF": auth.csrf,
					...extra,
				},
				body: JSON.stringify({ version: 2, requestId, command }),
			});
		return { response, decoded: decodeExtensionResponse(await response.json(), requestId) };
	}
	return {
		...m,
		root,
		extensions,
		pluginHttp: http,
		extensionRpc: rpc,
		close: async () => {
			await http.close();
			await m.close();
		},
	};
}

test(
	"Extension HTTP: current person/resource/CSRF bind calls and accepted assets; viewer and private paths have no effect",
	{ timeout: 15000 },
	async () => {
		const m = await setup();
		try {
			const listed = await m.extensionRpc({ op: "list", target: m.ref });
			assert.equal(listed.response.status, 200);
			assert.ok("result" in listed.decoded && listed.decoded.result.kind === "registrations");
			const registration = listed.decoded.result.registrations[0]!;
			const call = {
				extension: "http-example",
				generation: registration.generation,
				action: "card",
				requestId: "same-card",
				input: {},
				target: m.ref,
			};
			const saved = await m.extensionRpc({ op: "call", call });
			assert.ok("result" in saved.decoded && saved.decoded.result.kind === "operation");
			assert.equal(saved.decoded.result.operation.state, "done");
			const duplicate = await m.extensionRpc({ op: "call", call });
			assert.ok("result" in duplicate.decoded);
			assert.deepEqual(duplicate.decoded.result, saved.decoded.result);
			const lookup = {
				op: "operationByRequest",
				request: { extension: call.extension, requestId: call.requestId, target: m.ref },
			};
			const found = await m.extensionRpc(lookup);
			assert.equal(found.response.status, 200);
			assert.ok("result" in found.decoded);
			assert.deepEqual(found.decoded.result, saved.decoded.result);
			const wrongResource = await m.extensionRpc({
				...lookup,
				request: { ...lookup.request, target: { ...m.ref, profile: "foreign-profile" } },
			});
			assert.equal(wrongResource.response.status, 403);
			assert.ok("error" in wrongResource.decoded && wrongResource.decoded.error.outcome === "denied");
			const wrongIncarnation = await m.extensionRpc({
				...lookup,
				request: { ...lookup.request, target: { ...m.ref, incarnation: "stale-incarnation" } },
			});
			assert.equal(wrongIncarnation.response.status, 403);
			assert.ok("error" in wrongIncarnation.decoded && wrongIncarnation.decoded.error.outcome === "denied");
			const invitation = await m.people.invite(m.actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [m.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewer = await m.exchange(invitation.token, "invite", "Viewer");
			const otherActor = await m.extensionRpc(lookup, viewer);
			assert.equal(otherActor.response.status, 403);
			assert.ok("error" in otherActor.decoded && otherActor.decoded.error.outcome === "denied");
			const denied = await m.extensionRpc(
				{ op: "call", call: { ...call, requestId: "viewer-write" } },
				viewer,
			);
			assert.equal(denied.response.status, 403);
			assert.ok("error" in denied.decoded);
			assert.equal(denied.decoded.error.outcome, "denied");
			const csrf = await m.extensionRpc({ op: "call", call }, m.admin, { "X-Pakka-CSRF": "" });
			assert.equal(csrf.response.status, 403);
			const asset = `/pocket/extensions/assets/http-example/${registration.generation}/index.js?conversationId=${m.ref.conversationId}`;
			assert.equal((await fetch(m.pluginHttp.origin + asset)).status, 401);
			assert.match(
				await (await fetch(m.pluginHttp.origin + asset, { headers: { Cookie: viewer.cookies } })).text(),
				/PUBLIC-PLUGIN-CONTENT/,
			);
			assert.equal(
				(
					await fetch(m.pluginHttp.origin + asset.replace("index.js", "private.txt"), {
						headers: { Cookie: m.admin.cookies },
					})
				).status,
				403,
			);
			const snapshot = await m.client.read(m.ref);
			assert.equal(snapshot.entries.filter((e) => e.display?.text === "HTTP-PLUGIN-CARD").length, 1);
			assert.equal(m.f.requests.length, 0);
			const senderInvite = await m.people.invite(m.actor, {
				requestId: "lookup-sender",
				role: "sender",
				resources: [m.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(senderInvite.token);
			const sender = await m.exchange(senderInvite.token, "invite", "Lookup sender");
			const senderCall = { ...call, requestId: "sender-card" };
			assert.equal((await m.extensionRpc({ op: "call", call: senderCall }, sender)).response.status, 200);
			const senderLookup = {
				op: "operationByRequest",
				request: { extension: senderCall.extension, requestId: senderCall.requestId, target: m.ref },
			};
			assert.equal((await m.extensionRpc(senderLookup, sender)).response.status, 200);
			const person = (await m.people.list(m.actor)).people.find((row) => row.name === "Lookup sender");
			assert.ok(person);
			await m.people.revokePerson(m.actor, person.id);
			const revokedLookup = await m.extensionRpc(senderLookup, sender);
			assert.equal(revokedLookup.response.status, 401);
			assert.ok("error" in revokedLookup.decoded && revokedLookup.decoded.error.outcome === "denied");
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension HTTP: real effect with lost handler result stays unknown through public client; disable seals old generation",
	{ timeout: 15000 },
	async () => {
		const m = await setup();
		try {
			const headers = {
				Origin: m.pluginHttp.origin,
				Cookie: m.admin.cookies,
				"X-Pakka-CSRF": m.admin.csrf,
				"Content-Type": "application/json",
			};
			// Node has no cookie jar. The local forwarding server adds only this test's issued cookie/Origin.
			const { createServer } = await import("node:http");
			const proxy = createServer((req, res) => {
				void (async () => {
					const chunks: Buffer[] = [];
					for await (const chunk of req) chunks.push(Buffer.from(chunk));
					const response = await fetch(m.pluginHttp.origin + "/pocket/extensions/rpc", {
						method: "POST",
						headers,
						body: Buffer.concat(chunks),
					});
					res.writeHead(response.status, { "Content-Type": "application/json" });
					res.end(await response.text());
				})().catch(() => {
					res.writeHead(500);
					res.end();
				});
			});
			await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
			try {
				const address = proxy.address();
				assert.ok(address && typeof address !== "string");
				const client = createExtensionClient({
					endpoint: `http://127.0.0.1:${address.port}/pocket/extensions/rpc`,
					personId: () => m.actor.person.id,
				});
				const row = (await client.list(m.ref))[0]!,
					call = {
						extension: row.manifest.id,
						generation: row.generation,
						action: "work",
						requestId: "one-effect",
						input: {},
						target: m.ref,
					};
				const result = await client.call(call);
				assert.equal(result.state, "unknown");
				await m.runtime.waitForIdle();
				assert.deepEqual(await client.call(call), result);
				assert.deepEqual(await client.operation(result.id), result);
				assert.deepEqual(
					await client.operationByRequest({
						extension: call.extension,
						requestId: call.requestId,
						target: m.ref,
					}),
					result,
				);
				assert.equal(m.f.requests.length, 1);
				await client.control(row.manifest.id, "disable");
				await assert.rejects(
					client.call({ ...call, requestId: "stale" }),
					(error) => !!error && typeof error === "object" && "outcome" in error && error.outcome === "denied",
				);
				assert.equal(m.f.requests.length, 1);
			} finally {
				await new Promise<void>((resolve) => {
					proxy.close(() => resolve());
					proxy.closeAllConnections();
				});
			}
		} finally {
			await m.close();
		}
	},
);
