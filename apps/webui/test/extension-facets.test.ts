import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { createAgentFacet, createRuntime, type Runtime } from "../../../packages/agent/src/index.ts";
import { createPocketPeople, createPocketWorkspace } from "@pakka/server/pocket";
import { decodeExtensionResponse, EXTENSION_VERSION } from "@pakka/protocol/extension-rpc";
import type {
	ExtensionFacet,
	ExtensionFacetControl,
	ExtensionRegistration,
} from "@pakka/protocol/extensions";
import { createExtensionHost, type ExtensionSource } from "../src/extension-host.ts";
import { createPocketHttp } from "../src/http.ts";

const schema = { type: "object", properties: {}, required: [] };
const definition = {
	api: 1,
	id: "four-facets",
	version: "1.0.0",
	title: "Four independent facets",
	facets: {
		backend: "backend.mjs",
		webui: { entry: "ui.js", publicDir: "public" },
		client: "client.js",
		agent: "agent.js",
	},
	actions: [
		{
			id: "status",
			version: 1,
			scope: "app",
			permission: "read",
			effect: "read",
			timeoutMs: 1000,
			input: schema,
			output: { type: "string", maxLength: 80 },
		},
		{
			id: "card",
			version: 1,
			scope: "conversation",
			permission: "send",
			effect: "write",
			timeoutMs: 1000,
			input: schema,
			output: { type: "string", maxLength: 80 },
		},
	],
	commands: [],
	interfaces: [{ id: "home", title: "Home", scope: "app", slot: "page", export: "Home", navigation: true }],
};
const backend =
	'export const actions={status:()=>"BACKEND-ONE",card:async c=>{await c.display("card","FACET-SAVED-CARD");return "saved";}};';
async function files(root: string) {
	await mkdir(join(root, "public"), { recursive: true });
	await writeFile(join(root, "manifest.json"), JSON.stringify(definition));
	await writeFile(join(root, "backend.mjs"), backend);
	await writeFile(join(root, "agent.js"), 'export const approval="trusted-composition";');
	await writeFile(join(root, "public/ui.js"), 'export const Home="UI-ONE";');
	await writeFile(join(root, "public/client.js"), 'export const client="CLIENT-ONE";');
}
async function services(runtime: Runtime) {
	const people = await createPocketPeople({ runtime, namespace: "facet-tests.people" });
	const workspace = createPocketWorkspace({
		runtime,
		people,
		catalog: { namespace: "facet-tests.workspace", maxPending: 8 },
		profileCeiling: () => ["default"],
	});
	return { people, workspace };
}
async function finite<T>(work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(Error("Facet observation deadline")), 3000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

// Necessary new boundary: real HTTP controls must affect the native Agent, not just four discovery labels.
test(
	"Facet HTTP: independent publications, historical control receipts, authority, and admitted native work",
	{ timeout: 25000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		const agent = createAgentFacet({
			id: definition.id,
			version: definition.version,
			profiles: ["default"],
			instructions: "FACET-INSTRUCTIONS",
			tools: [
				{
					name: "facet_wait",
					description: "Finish admitted work",
					parameters: { type: "object", properties: {}, additionalProperties: false },
					execute: async () => {
						entered.resolve();
						await release.promise;
						return "ADMITTED-NATIVE-WORK-FINISHED";
					},
				},
			],
		});
		const m = await runtimeFixture({ agentFacets: [agent] }, undefined, (payload) => {
			const last = [...payload.messages].reverse().find((message) => message.role !== "system");
			return last?.role === "user" && JSON.stringify(last.content).includes("WAIT-FOR-FACET")
				? { tool: "facet_wait" }
				: { text: "FINISHED" };
		});
		let host: Awaited<ReturnType<typeof createExtensionHost>> | undefined;
		let http: Awaited<ReturnType<typeof createPocketHttp>> | undefined;
		try {
			const root = join(m.f.root, "four-facets");
			await files(root);
			const { people, workspace } = await services(m.runtime),
				session = await people.initializeOwner("Owner");
			const actor = await people.authenticate(session.token);
			const target = await workspace
				.bind(actor)
				.create({ requestId: "work", name: "Work", profile: "default" });
			host = await createExtensionHost({ runtime: m.runtime, people, workspace, sources: [{ root, agent }] });
			http = await createPocketHttp({ runtime: m.runtime, people, workspace, extensions: host });
			const exchange = await fetch(http.origin + "/pakka-webui/exchange", {
				method: "POST",
				headers: { Origin: http.origin, "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "session", token: session.token }),
			});
			assert.equal(exchange.status, 200);
			const cookies = exchange.headers
				.getSetCookie()
				.map((value) => value.split(";")[0]!)
				.join("; ");
			const csrf = /pakka_csrf=([^;]+)/.exec(cookies)![1]!;
			const signedIn = await people.authenticate(/pakka_pocket=([^;]+)/.exec(cookies)![1]!);
			async function rpc(command: object, extra: Record<string, string> = {}, version = EXTENSION_VERSION) {
				const requestId = crypto.randomUUID();
				const response = await fetch(http!.origin + "/pakka-webui/extensions/rpc", {
					method: "POST",
					headers: {
						Origin: http!.origin,
						Cookie: cookies,
						"Content-Type": "application/json",
						"X-Pakka-CSRF": csrf,
						"X-Pakka-Person": session.person.id,
						"X-Pakka-Server": http!.serverId,
						...extra,
					},
					body: JSON.stringify({ version, requestId, command }),
				});
				return { response, body: decodeExtensionResponse(await response.json(), requestId) };
			}
			async function list() {
				const { response, body } = await rpc({ op: "list", target });
				assert.equal(response.status, 200);
				assert.ok("result" in body && body.result.kind === "registrations");
				return body.result.registrations;
			}
			const row = (rows: readonly ExtensionRegistration[], facet: ExtensionFacet) =>
				rows.find((entry) => entry.facet === facet)!;
			async function control(
				facet: ExtensionFacet,
				action: ExtensionFacetControl["action"],
				requestId: string = crypto.randomUUID(),
			) {
				const change = {
					extension: definition.id,
					facet,
					action,
					requestId,
					expectedGeneration: row(await list(), facet).generation,
				};
				const { response, body } = await rpc({ op: "control", change });
				assert.equal(response.status, 200);
				assert.ok("result" in body && body.result.kind === "control");
				return { change, receipt: body.result.receipt };
			}
			const asset = (registration: ExtensionRegistration, path: string) =>
				fetch(
					http!.origin +
						`/pakka-webui/extensions/assets/${definition.id}/${registration.facet}/${registration.generation}/app/${path}`,
					{ headers: { Cookie: cookies } },
				);
			const initial = await list();
			assert.deepEqual(initial.map((entry) => entry.facet).sort(), ["agent", "backend", "client", "webui"]);
			assert.ok(initial.every((entry) => entry.phase === "ready"));
			assert.equal(m.f.requests.length, 0);
			const backendRow = row(initial, "backend"),
				ui = row(initial, "webui"),
				client = row(initial, "client"),
				nativeGeneration = agent.status().generation;
			const call = {
				extension: definition.id,
				generation: backendRow.generation,
				action: "card",
				requestId: "saved-card",
				input: {},
				target,
			};
			const saved = await rpc({ op: "call", call });
			assert.ok(
				"result" in saved.body &&
					saved.body.result.kind === "operation" &&
					saved.body.result.operation.state === "done",
			);
			await workspace
				.bind(signedIn)
				.submit(target, { requestId: "native-work", mode: "prompt", text: "WAIT-FOR-FACET" });
			await finite(entered.promise);
			assert.match(JSON.stringify(m.f.requests[0]?.tools), /facet_wait/);
			const off = await control("webui", "disable", "ui-off");
			assert.equal(off.receipt.state, "done");
			assert.equal((await asset(ui, "ui.js")).status, 403);
			assert.equal((await asset(client, "client.js")).status, 200);
			assert.equal(row(await list(), "backend").generation, backendRow.generation);
			assert.equal(agent.status().generation, nativeGeneration);
			await control("webui", "enable");
			const replay = await rpc({ op: "control", change: off.change });
			assert.ok("result" in replay.body && replay.body.result.kind === "control");
			assert.deepEqual(
				replay.body.result.receipt,
				off.receipt,
				"replay returns the original result, not current state",
			);
			assert.equal(row(await list(), "webui").phase, "ready");
			const found = await rpc({
				op: "controlByRequest",
				original: { extension: definition.id, facet: "webui", requestId: off.change.requestId },
			});
			assert.ok("result" in found.body && found.body.result.kind === "control-operation");
			assert.deepEqual(found.body.result.receipt, off.receipt);
			const mismatch = await rpc({ op: "control", change: { ...off.change, action: "reload" } });
			assert.equal(mismatch.response.status, 409);
			assert.ok("error" in mismatch.body && mismatch.body.error.outcome === "denied");
			const stale = await rpc({ op: "control", change: { ...off.change, requestId: "stale" } });
			assert.equal(stale.response.status, 409);
			assert.equal((await rpc({ op: "list" }, {}, 2)).response.status, 400);
			assert.equal(
				(
					await rpc(
						{ op: "control", change: { ...off.change, requestId: "foreign" } },
						{ "X-Pakka-Person": "foreign" },
					)
				).response.status,
				403,
			);
			await writeFile(join(root, "public/ui.js"), 'export const Home="UI-TWO";');
			await writeFile(join(root, "backend.mjs"), 'throw Error("must not import Backend during UI reload");');
			await control("webui", "reload");
			const updated = await list();
			assert.match(await (await asset(row(updated, "webui"), "ui.js")).text(), /UI-TWO/);
			assert.equal(row(updated, "client").generation, client.generation);
			assert.equal(row(updated, "backend").generation, backendRow.generation);
			const read = await rpc({
				op: "call",
				call: {
					extension: definition.id,
					generation: backendRow.generation,
					action: "status",
					requestId: "same-backend",
					input: {},
				},
			});
			assert.ok("result" in read.body && read.body.result.kind === "operation");
			assert.equal(read.body.result.operation.value, "BACKEND-ONE");
			await control("client", "disable");
			assert.equal((await asset(client, "client.js")).status, 403);
			assert.equal((await asset(row(updated, "webui"), "ui.js")).status, 200);
			assert.equal(agent.status().generation, nativeGeneration);
			await control("backend", "disable");
			const oldCall = await rpc({ op: "call", call: { ...call, requestId: "disabled-backend" } });
			assert.equal(oldCall.response.status, 403);
			const original = await rpc({
				op: "operationByRequest",
				request: { extension: definition.id, requestId: call.requestId, target },
			});
			assert.ok("result" in original.body && original.body.result.kind === "operation");
			assert.deepEqual(original.body.result, saved.body.result);
			assert.equal(row(await list(), "webui").generation, row(updated, "webui").generation);
			assert.equal(agent.status().generation, nativeGeneration);
			release.resolve();
			await finite((await m.runtime.conversation(target)).waitForIdle());
			assert.match(JSON.stringify(m.f.requests[1]?.messages), /ADMITTED-NATIVE-WORK-FINISHED/);
			const beforeAgent = m.f.requests.length;
			await control("agent", "disable");
			assert.equal(m.f.requests.length, beforeAgent, "control never submits model work");
			await workspace
				.bind(signedIn)
				.submit(target, { requestId: "disabled-agent", mode: "prompt", text: "NO-TOOL" });
			await finite((await m.runtime.conversation(target)).waitForIdle());
			assert.equal(JSON.stringify(m.f.requests.at(-1)?.tools ?? []).includes("facet_wait"), false);
			assert.equal(agent.status().phase, "disabled");
		} finally {
			release.resolve();
			await http?.close();
			await host?.close();
			await m.close();
		}
	},
);

// Initialization has a real HTTP side effect, then remains pending. A healthy UI must not inherit its uncertainty.
test(
	"Facet initialization: asynchronous deadline and writer reopen preserve unknown without re-entry or UI revocation",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		let response: ServerResponse | undefined,
			effects = 0,
			reopened: Runtime | undefined;
		let host: Awaited<ReturnType<typeof createExtensionHost>> | undefined;
		const server = createServer((_req, res) => {
			effects++;
			response = res;
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			assert.ok(address && typeof address === "object");
			const root = join(m.f.root, "uncertain-facets");
			await files(root);
			await writeFile(
				join(root, "backend.mjs"),
				`await fetch("http://127.0.0.1:${address.port}/effect");${backend}`,
			);
			const source: ExtensionSource = { root, facets: ["backend", "webui", "client"] };
			const initial = await services(m.runtime),
				session = await initial.people.initializeOwner("Owner"),
				actor = await initial.people.authenticate(session.token);
			host = await finite(
				createExtensionHost({
					runtime: m.runtime,
					...initial,
					sources: [source],
					initializationTimeoutMs: 150,
				}),
			);
			const registration = host.list(actor);
			assert.equal(registration.find((row) => row.facet === "backend")!.phase, "unknown");
			const ui = registration.find((row) => row.facet === "webui")!;
			assert.equal(ui.phase, "ready");
			assert.match(
				new TextDecoder().decode(
					(await host.asset(actor, definition.id, "webui", ui.generation, "ui.js")).body,
				),
				/UI-ONE/,
			);
			assert.equal(effects, 1);
			const file = m.runtime.view().sessionFile;
			await host.close();
			await m.runtime.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			const next = await services(reopened),
				nextActor = await next.people.authenticate(session.token);
			host = await finite(
				createExtensionHost({ runtime: reopened, ...next, sources: [source], initializationTimeoutMs: 150 }),
			);
			assert.equal(host.list(nextActor).find((row) => row.facet === "backend")!.phase, "unknown");
			assert.equal(effects, 1, "reopening must not retry an unconfirmed initialization");
			response!.end("finished after deadline");
			const active = host.list(nextActor).find((row) => row.facet === "webui")!;
			await writeFile(join(root, "manifest.json"), "not JSON");
			await assert.rejects(
				host.control(nextActor, {
					extension: definition.id,
					facet: "webui",
					action: "reload",
					expectedGeneration: active.generation,
					requestId: "bad-preparation",
				}),
			);
			assert.equal(host.list(nextActor).find((row) => row.facet === "webui")!.generation, active.generation);
			assert.equal(
				(await host.asset(nextActor, definition.id, "webui", active.generation, "ui.js")).body.length > 0,
				true,
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			response?.end("released");
			await host?.close();
			await reopened?.close();
			await m.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	},
);

// A trusted control-port failure is injected before withdrawal; the native source is real and remains active.
test(
	"Facet close: an unconfirmed native withdrawal remains rejected on repeated close",
	{ timeout: 15000 },
	async () => {
		const agent = createAgentFacet({
			id: definition.id,
			version: definition.version,
			profiles: ["default"],
			tools: [],
		});
		const m = await runtimeFixture({ agentFacets: [agent] });
		let failing = false,
			attempts = 0;
		const port = Object.freeze({
			...agent,
			reconcile(enabled: boolean) {
				if (failing && !enabled) {
					attempts++;
					throw Error("CONTROLLED-WITHDRAWAL-FAILURE");
				}
				agent.reconcile(enabled);
			},
		});
		let host: Awaited<ReturnType<typeof createExtensionHost>> | undefined;
		try {
			const root = join(m.f.root, "closing-facet");
			await files(root);
			const bindings = await services(m.runtime);
			const owner = await bindings.people.initializeOwner("Owner"),
				actor = await bindings.people.authenticate(owner.token);
			host = await createExtensionHost({
				runtime: m.runtime,
				...bindings,
				sources: [{ root, facets: ["agent"], agent: port }],
			});
			assert.equal(agent.status().phase, "ready");
			failing = true;
			await assert.rejects(host.close(), AggregateError);
			assert.equal(agent.status().phase, "ready", "failed withdrawal is not a completed native teardown");
			await assert.rejects(host.close(), AggregateError);
			assert.equal(attempts, 1, "repeated close observes the original shutdown result");
			assert.throws(() => host!.list(actor), "admission is sealed even while withdrawal is unconfirmed");
			assert.equal(m.f.requests.length, 0);
		} finally {
			failing = false;
			agent.reconcile(false);
			await host?.close().catch(() => {});
			await m.close();
		}
	},
);
