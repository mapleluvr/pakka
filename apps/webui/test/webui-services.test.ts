import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodePocketResponse, type PocketCommand, type PocketResult } from "@pakka/protocol/pocket";
import { decodeWebUiResponse, type WebUiCommand, type WebUiResult } from "@pakka/protocol/webui";
import { startPocket } from "../src/bootstrap.ts";
import { openProductModels } from "../src/product-models.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { runtimeLimits } from "../../../packages/agent/test/runtime-fixture.ts";

async function product() {
	const { f, agentDir } = await isolated();
	await configuration(agentDir, f.endpoint);
	const modelsPath = join(agentDir, "models.json");
	const native = JSON.parse(await readFile(modelsPath, "utf8"));
	native.providers.alpha.apiKey = "synthetic-kept-key";
	native.providers.alpha.headers = {
		"X-Test": "synthetic-kept-header",
		constructor: "synthetic-kept-private-constructor",
	};
	native.providers.alpha.futureSetting = { retained: true };
	native.providers.alpha.models[0].compat = {
		headers: {
			Authorization: "synthetic-catalog-hidden",
			constructor: "synthetic-catalog-hidden-constructor",
		},
		supportsStore: false,
	};
	await writeFile(modelsPath, "// preserve native comments\n" + JSON.stringify(native, null, 2) + "\n");
	const source = await openProductModels({ agentDir, cwd: f.cwd });
	let app: Awaited<ReturnType<typeof startPocket>>;
	try {
		app = await startPocket({
			runtime: {
				cwd: f.cwd,
				dataDir: f.dataDir,
				model: "alpha/reasoner",
				models: source.models,
				limits: runtimeLimits,
			},
			modelConfiguration: source,
			owner: "Owner",
			initial: [{ name: "Existing work", profile: "default" }],
		});
	} catch (error) {
		await source.close();
		await f.close();
		throw error;
	}
	const origin = app.http.origin;
	async function login(token: string) {
		const response = await fetch(origin + "/pakka-webui/exchange", {
			method: "POST",
			headers: { Origin: origin, "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "session", token }),
		});
		assert.equal(response.status, 200);
		const cookie = response.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		const csrf = /pakka_csrf=([^;]+)/.exec(cookie)![1]!;
		const actor = await app.people.authenticate(/pakka_pocket=([^;]+)/.exec(cookie)![1]!);
		const personId = app.people.current(actor).id;
		async function service(
			command: WebUiCommand,
			input: { csrf?: string; personId?: string; serverId?: string } = {},
		) {
			const requestId = crypto.randomUUID();
			const response = await fetch(origin + "/pakka-webui/services", {
				method: "POST",
				headers: {
					Origin: origin,
					Cookie: cookie,
					"Content-Type": "application/json",
					"X-Pakka-CSRF": input.csrf ?? csrf,
				},
				body: JSON.stringify({
					api: 1,
					requestId,
					binding: { personId: input.personId ?? personId, serverId: input.serverId ?? app.http.serverId },
					command,
				}),
			});
			const value = decodeWebUiResponse(await response.json(), requestId);
			return { status: response.status, value };
		}
		async function work(command: PocketCommand): Promise<PocketResult> {
			const requestId = crypto.randomUUID();
			const response = await fetch(origin + "/pakka-webui/rpc", {
				method: "POST",
				headers: {
					Origin: origin,
					Cookie: cookie,
					"Content-Type": "application/json",
					"X-Pakka-CSRF": csrf,
					"X-Pakka-Person": personId,
					"X-Pakka-Server": app.http.serverId,
				},
				body: JSON.stringify({ version: 2, requestId, command }),
			});
			const value = decodePocketResponse(await response.json(), requestId);
			assert.equal(response.status, 200);
			assert.ok("result" in value);
			return value.result;
		}
		return { actor, personId, service, work };
	}
	assert.ok(app.initialOwner);
	const owner = await login(app.initialOwner.token);
	return {
		f,
		agentDir,
		modelsPath,
		source,
		app,
		owner,
		login,
		async close() {
			await app.close();
			await source.close();
			await f.close();
		},
	};
}
function result<K extends WebUiResult["kind"]>(
	reply: { status: number; value: ReturnType<typeof decodeWebUiResponse> },
	kind: K,
): Extract<WebUiResult, { kind: K }> {
	assert.equal(reply.status, 200);
	assert.ok("result" in reply.value);
	assert.equal(reply.value.result.kind, kind);
	// SAFETY: the production decoder checked the entire result and its discriminator is asserted above.
	return reply.value.result as Extract<WebUiResult, { kind: K }>;
}

// Necessary new boundary: removing admission binding, redaction or original-operation lookup
// must fail against the real HTTP service, native models.json and durable records, not UI layout.
test("WebUI services: native configuration is identity-bound, private and recoverable by the original request", async () => {
	const p = await product();
	try {
		const caps = result(await p.owner.service({ op: "capabilities" }), "capabilities");
		assert.ok(caps.capabilities.features.includes("model-connections"));
		assert.equal(
			(
				await fetch(p.app.http.origin + "/pakka-webui/models/rpc", {
					method: "POST",
					headers: { Origin: p.app.http.origin },
				})
			).status,
			404,
		);
		const before = result(
			await p.owner.service({ op: "model-connections.read" }),
			"model-configuration",
		).configuration;
		assert.doesNotMatch(
			JSON.stringify(before),
			/synthetic-kept-(?:key|header|private-constructor)|synthetic-catalog-hidden/,
		);
		// Native validation retains this unknown nested metadata; a catalog is still a public projection.
		assert.equal(
			JSON.stringify(p.source.models().getModel("alpha", "reasoner")?.compat).includes(
				"synthetic-catalog-hidden",
			),
			true,
		);
		const catalog = result(
			await p.owner.service({ op: "model-catalog.read", query: { provider: "alpha", type: "chat" } }),
			"model-catalog",
		).page;
		assert.equal(catalog.status, "ready");
		assert.doesNotMatch(
			JSON.stringify(catalog),
			/synthetic-kept-(?:key|header|private-constructor)|synthetic-catalog-hidden/,
		);
		assert.deepEqual(catalog.models[0]?.parameters.compat, { supportsStore: false });
		const change = {
			requestId: "native-edit",
			expectedVersion: before.version,
			edits: [{ path: ["providers", "alpha", "models", 0, "maxTokens"], value: 4096 }],
		};
		for (const input of [{ csrf: "wrong" }, { personId: "wrong-person" }, { serverId: "wrong-server" }]) {
			const refused = await p.owner.service({ op: "model-connections.write", change }, input);
			assert.equal(refused.status, 403);
			assert.ok("error" in refused.value);
			assert.equal(refused.value.error.outcome, "denied");
		}
		assert.equal(
			result(
				await p.owner.service({ op: "model-connections.lookup", original: change }),
				"model-configuration-operation",
			).receipt,
			null,
		);
		const auth = await readFile(join(p.agentDir, "auth.json"), "utf8");
		assert.equal(
			result(await p.owner.service({ op: "model-connections.validate", change }), "model-validation").valid,
			true,
		);
		const saved = result(
			await p.owner.service({ op: "model-connections.write", change }),
			"model-configuration-receipt",
		).receipt;
		assert.equal(saved.state, "saved");
		assert.equal(saved.reload, "ready");
		assert.deepEqual(
			result(
				await p.owner.service({ op: "model-connections.lookup", original: change }),
				"model-configuration-operation",
			).receipt,
			saved,
		);
		assert.deepEqual(
			result(await p.owner.service({ op: "model-connections.write", change }), "model-configuration-receipt")
				.receipt,
			saved,
		);
		assert.equal(
			(await p.owner.service({ op: "model-connections.write", change: { ...change, requestId: "stale" } }))
				.status,
			409,
		);
		assert.equal(
			(
				await p.owner.service({
					op: "model-connections.lookup",
					original: { ...change, edits: [{ ...change.edits[0]!, value: 2048 }] },
				})
			).status,
			409,
		);
		assert.equal(p.source.models().getModel("alpha", "reasoner")?.maxTokens, 4096);
		const persisted = await readFile(p.modelsPath, "utf8");
		assert.match(persisted, /^\/\/ preserve native comments/);
		assert.match(persisted, /synthetic-kept-key/);
		assert.match(persisted, /synthetic-kept-header/);
		assert.match(persisted, /synthetic-catalog-hidden/);
		assert.match(persisted, /synthetic-kept-private-constructor/);
		assert.match(persisted, /synthetic-catalog-hidden-constructor/);
		assert.equal(await readFile(join(p.agentDir, "auth.json"), "utf8"), auth);
		const after = result(
			await p.owner.service({ op: "model-connections.read" }),
			"model-configuration",
		).configuration;
		assert.equal(after.version, saved.version);
		assert.equal(
			(
				await p.owner.service({
					op: "model-connections.write",
					change: {
						requestId: "replace-secret",
						expectedVersion: after.version,
						edits: [{ path: ["providers", "alpha", "apiKey"], value: "browser-key" }],
					},
				})
			).status,
			403,
		);
		assert.equal(p.f.requests.length, 0);
	} finally {
		await p.close();
	}
});

// The original request is raw caller intent: changing Person defaults must not make
// an already-created Conversation disappear from lookup or silently create another one.
test("WebUI services: Person defaults apply only on first human creation and preserve cross-Session identities", async () => {
	const p = await product();
	try {
		const old = await p.owner.work({ op: "list" });
		assert.equal(old.kind, "list");
		assert.ok(old.kind === "list" && old.conversations[0]);
		const existing = old.conversations[0];
		const choice = {
			requestId: "my-default",
			expectedVersion: 0,
			model: { provider: "beta", id: "model-001" },
			thinkingLevel: "high" as const,
		};
		const saved = result(
			await p.owner.service({ op: "model-defaults.write", change: choice }),
			"model-defaults-receipt",
		).receipt;
		assert.deepEqual(
			result(
				await p.owner.service({ op: "model-defaults.lookup", original: choice }),
				"model-defaults-operation",
			).receipt,
			saved,
		);
		const original = {
			op: "create" as const,
			requestId: "first-create",
			name: "My default",
			profile: "default",
		};
		const created = await p.owner.work(original);
		assert.equal(created.kind, "reference");
		assert.ok(created.kind === "reference");
		assert.equal((await p.app.runtime.configuration(created.ref)).model, "beta/model-001");
		assert.equal((await p.app.runtime.configuration(existing)).model, "alpha/reasoner");
		assert.equal(p.source.defaults().model, "alpha/reasoner");
		const next = {
			...choice,
			requestId: "changed-default",
			expectedVersion: saved.defaults.version,
			model: { provider: "alpha", id: "reasoner" },
		};
		result(await p.owner.service({ op: "model-defaults.write", change: next }), "model-defaults-receipt");
		const found = await p.owner.work({ op: "conversation.lookup", original });
		assert.equal(found.kind, "conversation.operation");
		assert.ok(found.kind === "conversation.operation");
		assert.deepEqual(found.result, created.ref);
		assert.deepEqual(await p.owner.work(original), created);
		assert.equal((await p.app.runtime.configuration(created.ref)).model, "beta/model-001");
		const invited = await p.app.people.invite(p.owner.actor, {
			requestId: "other-person",
			role: "admin",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invited.token);
		const otherLogin = await p.app.people.redeem(invited.token, "Other");
		const other = await p.login(otherLogin.token);
		assert.equal(
			result(await other.service({ op: "model-defaults.read" }), "model-defaults").defaults.version,
			0,
		);
		assert.equal(
			result(
				await other.service({ op: "model-defaults.lookup", original: choice }),
				"model-defaults-operation",
			).receipt,
			null,
		);
		const child = await p.app.sessions.create(p.owner.actor, {
			requestId: "child-session",
			name: "Original child",
			cwd: p.f.cwd,
		});
		const childWork = await p.owner.work({
			op: "create",
			requestId: "child-work",
			name: "Child work",
			profile: "default",
			sessionId: child.id,
		});
		assert.ok(childWork.kind === "reference");
		const resolution = result(
			await p.owner.service({
				op: "resource.resolve",
				reference: {
					kind: "conversation",
					sessionId: child.id,
					conversationId: childWork.ref.conversationId,
				},
			}),
			"resource",
		).resolution;
		assert.equal(resolution.status, "loaded");
		assert.ok(resolution.status === "loaded");
		assert.deepEqual(resolution.target, childWork.ref);
		assert.notEqual(resolution.target.sessionId, existing.sessionId);
		const list = await p.owner.work({ op: "list" });
		assert.ok(list.kind === "list");
		assert.equal(new Set(list.conversations.map((ref) => ref.sessionId)).size, 2);
		assert.equal(p.f.requests.length, 0);
	} finally {
		await p.close();
	}
});
