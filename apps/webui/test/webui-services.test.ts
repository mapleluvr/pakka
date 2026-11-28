import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	POCKET_VERSION,
	decodePocketResponse,
	type PocketCommand,
	type PocketResult,
} from "@pakka/protocol/pocket";
import {
	WEBUI_SERVICE_API,
	decodeWebUiResponse,
	type WebUiCommand,
	type WebUiResult,
} from "@pakka/protocol/webui";
import { startPocket } from "../src/bootstrap.ts";
import { openProductModels } from "../src/product-models.ts";
import { executeSessionBudget } from "../src/session-budget.ts";
import { executePeople } from "../src/people-service.ts";
import { executeConversationConfiguration } from "../src/conversation-configuration.ts";
import { WebUiServiceRefusal } from "../src/service-refusal.ts";
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
					api: WEBUI_SERVICE_API,
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
				body: JSON.stringify({ version: POCKET_VERSION, requestId, command }),
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

// This transport must preserve native budget accounting and actor/Session identity;
// the old private model endpoint does not cover this public service boundary.
test("WebUI services: Session budgets use native receipts, exact original intent and current authority", async () => {
	const p = await product();
	try {
		await p.app.runtime
			.root()
			.connect("budget-service-fixture", ["input.submit"])
			.submit({ key: "spent-once", text: "LOCAL BUDGET CHECK" });
		await p.app.runtime.waitForIdle();
		const sessionId = p.app.runtime.view().sessionId;
		const initial = result(
			await p.owner.service({ op: "session-budget.read", sessionId }),
			"session-budget",
		).policy;
		const child = await p.app.sessions.create(p.owner.actor, {
			requestId: "budget-child",
			name: "Budget child",
			cwd: p.f.cwd,
		});
		const change = {
			requestId: "budget-original",
			expectedVersion: initial.version,
			limits: { maxPrimaryAttempts: 0, maxAuxiliaryAttempts: 0, maxConversations: 0 },
			reason: "Capacity review",
		};
		assert.equal(
			result(
				await p.owner.service({ op: "session-budget.lookup", sessionId, original: change }),
				"session-budget-operation",
			).receipt,
			null,
		);
		for (const input of [{ csrf: "wrong" }, { personId: "wrong" }, { serverId: "wrong" }])
			assert.equal(
				(await p.owner.service({ op: "session-budget.write", sessionId, change }, input)).status,
				403,
			);
		const receipt = result(
			await p.owner.service({ op: "session-budget.write", sessionId, change }),
			"session-budget-receipt",
		).receipt;
		assert.equal(receipt.actorId, p.owner.personId);
		assert.deepEqual(receipt.budget, initial.budget);
		assert.deepEqual(
			result(
				await p.owner.service({ op: "session-budget.lookup", sessionId, original: change }),
				"session-budget-operation",
			).receipt,
			receipt,
		);
		assert.deepEqual(
			result(
				await p.owner.service({ op: "session-budget.write", sessionId, change }),
				"session-budget-receipt",
			).receipt,
			receipt,
		);
		for (const original of [
			{ ...change, reason: "Changed intent" },
			{ ...change, expectedVersion: change.expectedVersion + 1 },
			{ ...change, limits: initial.limits },
		])
			assert.equal((await p.owner.service({ op: "session-budget.lookup", sessionId, original })).status, 409);
		assert.equal(
			(
				await p.owner.service({
					op: "session-budget.write",
					sessionId,
					change: { ...change, requestId: "stale-budget" },
				})
			).status,
			409,
		);
		assert.equal(
			result(
				await p.owner.service({ op: "session-budget.lookup", sessionId: child.id, original: change }),
				"session-budget-operation",
			).receipt,
			null,
		);
		assert.deepEqual(
			result(await p.owner.service({ op: "session-budget.read", sessionId: child.id }), "session-budget")
				.policy.limits,
			initial.limits,
		);
		const latest = result(
			await p.owner.service({ op: "session-budget.history", sessionId, limit: 1 }),
			"session-budget-history",
		);
		assert.deepEqual(latest.page.items, [receipt]);
		assert.equal(initial.budget.primaryAttempts, 1);
		assert.deepEqual(
			result(
				await p.owner.service({ op: "session-budget.history", sessionId, beforeVersion: receipt.version }),
				"session-budget-history",
			).page.items,
			[],
		);
		const invitation = await p.app.people.invite(p.owner.actor, {
			requestId: "budget-admin",
			role: "admin",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const login = await p.app.people.redeem(invitation.token, "Budget admin");
		const other = await p.login(login.token);
		assert.equal(
			result(
				await other.service({ op: "session-budget.lookup", sessionId, original: change }),
				"session-budget-operation",
			).receipt,
			null,
		);
		await p.app.people.setPerson(p.owner.actor, other.personId, { role: "viewer", resources: "*" });
		assert.equal((await other.service({ op: "session-budget.read", sessionId })).status, 401);
		const viewerInvite = await p.app.people.invite(p.owner.actor, {
			requestId: "budget-viewer",
			personId: other.personId,
			role: "viewer",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(viewerInvite.token);
		const viewerSession = await p.app.people.redeem(viewerInvite.token, "Budget viewer");
		const viewer = await p.login(viewerSession.token);
		assert.equal((await viewer.service({ op: "session-budget.read", sessionId })).status, 403);
		assert.equal((await viewer.service({ op: "session-budget.write", sessionId, change })).status, 403);
		assert.equal(p.f.requests.length, 1);
	} finally {
		await p.close();
	}
});

// A final authority failure follows a real native commit; it must not release the UI's original request.
test("WebUI budget publication: post-commit check failure retains an unknown effect", async () => {
	const p = await product();
	try {
		const runtime = p.app.runtime,
			sessionId = runtime.view().sessionId;
		const initial = await runtime.budgetPolicy(() => {});
		const change = {
			requestId: "budget-publication",
			expectedVersion: initial.version,
			limits: { ...initial.limits, maxPrimaryAttempts: initial.limits.maxPrimaryAttempts + 1 },
			reason: "Publication check",
		};
		let checks = 0;
		await executeSessionBudget(
			{
				people: p.app.people,
				actor: p.owner.actor,
				runtimeFor: () => runtime,
				check: () => {
					checks++;
				},
			},
			{ op: "session-budget.write", sessionId, change },
		);
		let observed = 0;
		const original = {
			...change,
			requestId: "budget-unconfirmed",
			expectedVersion: change.expectedVersion + 1,
		};
		await assert.rejects(
			executeSessionBudget(
				{
					people: p.app.people,
					actor: p.owner.actor,
					runtimeFor: () => runtime,
					check: () => {
						if (++observed === checks) throw new WebUiServiceRefusal("FORBIDDEN");
					},
				},
				{ op: "session-budget.write", sessionId, change: original },
			),
			{ code: "UNKNOWN", confirmedNoEffect: false },
		);
		const receipt = result(
			await p.owner.service({ op: "session-budget.lookup", sessionId, original }),
			"session-budget-operation",
		).receipt;
		assert.equal(receipt?.version, original.expectedVersion + 1);
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

// The native binding changes on configuration; HTTP recovery must use the old intent and current authority.
test("WebUI services: Conversation configuration receipts survive later changes and failed post-commit checks", async () => {
	const p = await product();
	try {
		const rows = await p.owner.work({ op: "list" });
		assert.ok(rows.kind === "list");
		const target = rows.conversations[0]!;
		const view = result(
			await p.owner.service({ op: "conversation-configuration.read", target }),
			"conversation-configuration",
		).view;
		assert.equal(view.supportsRequests, true);
		assert.deepEqual(
			view.presets.map((row) => row.id),
			["default"],
		);
		const change = {
			requestId: "original-config",
			target,
			selection: {
				kind: "agent" as const,
				change: { model: "beta/model-001", thinkingLevel: "low" as const },
			},
		};
		const query = { op: "conversation-configuration.lookup" as const, original: change };
		assert.equal(result(await p.owner.service(query), "conversation-configuration-operation").receipt, null);
		const saved = result(
			await p.owner.service({ op: "conversation-configuration.write", change }),
			"conversation-configuration-receipt",
		).receipt;
		assert.notEqual(saved.ref.incarnation, target.incarnation);
		assert.equal((await p.app.runtime.configuration(saved.ref)).model, "beta/model-001");
		const profile = {
			requestId: "preset-config",
			target: saved.ref,
			selection: { kind: "profile" as const, profile: "default" },
		};
		const preset = result(
			await p.owner.service({ op: "conversation-configuration.write", change: profile }),
			"conversation-configuration-receipt",
		).receipt;
		assert.equal((await p.app.runtime.configuration(preset.ref)).model, "alpha/reasoner");
		assert.deepEqual(
			result(await p.owner.service(query), "conversation-configuration-operation").receipt,
			saved,
		);
		assert.ok(
			"error" in
				(
					await p.owner.service({
						...query,
						original: { ...change, selection: { kind: "agent", change: { cwd: p.f.cwd } } },
					})
				).value,
		);
		const child = await p.app.sessions.create(p.owner.actor, {
			requestId: "config-child",
			name: "Config child",
			cwd: p.f.cwd,
		});
		assert.ok(
			"error" in
				(
					await p.owner.service({
						...query,
						original: { ...change, target: { ...target, sessionId: child.id } },
					})
				).value,
		);
		const invitation = await p.app.people.invite(p.owner.actor, {
			requestId: "config-other",
			role: "admin",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const session = await p.app.people.redeem(invitation.token, "Other config admin"),
			other = await p.login(session.token);
		assert.equal(result(await other.service(query), "conversation-configuration-operation").receipt, null);
		const lost = {
			requestId: "config-publication",
			target: preset.ref,
			selection: { kind: "agent" as const, change: { model: "beta/model-001" } },
		};
		await assert.rejects(
			executeConversationConfiguration(
				{
					people: p.app.people,
					actor: p.owner.actor,
					workspace: p.app.workspace,
					check: () => {
						if (
							p.app.runtime
								.view()
								.conversations.some(
									(ref) => ref.key === preset.ref.key && ref.incarnation !== preset.ref.incarnation,
								)
						)
							throw Error("publication ended");
					},
				},
				{ op: "conversation-configuration.write", change: lost },
			),
			{ code: "UNKNOWN", confirmedNoEffect: false },
		);
		const recovered = result(
			await p.owner.service({ op: "conversation-configuration.lookup", original: lost }),
			"conversation-configuration-operation",
		).receipt;
		assert.ok(recovered);
		assert.equal((await p.app.runtime.configuration(recovered.ref)).model, "beta/model-001");
		await p.app.people.setPerson(p.owner.actor, other.personId, { role: "viewer", resources: "*" });
		assert.equal((await other.service(query)).status, 401);
		const readerInvitation = await p.app.people.invite(p.owner.actor, {
			requestId: "config-reader",
			role: "viewer",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(readerInvitation.token);
		const readerSession = await p.app.people.redeem(readerInvitation.token, "Reader"),
			reader = await p.login(readerSession.token);
		assert.equal((await reader.service(query)).status, 403);
		assert.equal(
			(
				await reader.service({
					op: "conversation-configuration.write",
					change: { ...lost, requestId: "reader-denied", target: recovered.ref },
				})
			).status,
			403,
		);
		assert.equal(p.f.requests.length, 0);
	} finally {
		await p.close();
	}
});

// Invitation recovery must be an authorized observation, never a second mint or secret replay.
test("WebUI services: original invitation lookup is issuer-bound, read-only and secret-free", async () => {
	const p = await product();
	try {
		const original = {
			requestId: "lost-invitation",
			role: "viewer" as const,
			resources: "*" as const,
			ttlMs: 60000,
		};
		const query = { op: "people.invite.lookup" as const, original };
		const before = await p.app.people.list(p.owner.actor);
		assert.equal(result(await p.owner.service(query), "people-invitation").invite, null);
		assert.deepEqual(await p.app.people.list(p.owner.actor), before);
		const created = await p.owner.work({ op: "invite", ...original });
		assert.ok(created.kind === "invite" && created.token);
		const recovered = result(await p.owner.service(query), "people-invitation");
		assert.equal(recovered.issuerId, p.owner.personId);
		assert.equal(recovered.requestId, original.requestId);
		assert.deepEqual(recovered.invite, created.invite);
		assert.equal(JSON.stringify(recovered).includes(created.token), false);
		assert.deepEqual(Object.keys(recovered).sort(), ["invite", "issuerId", "kind", "requestId"]);
		const altered = await p.owner.service({ ...query, original: { ...original, ttlMs: 60001 } });
		assert.ok("error" in altered.value);
		const adminLink = await p.app.people.invite(p.owner.actor, {
			requestId: "lookup-other-admin",
			role: "admin",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(adminLink.token);
		const otherSession = await p.app.people.redeem(adminLink.token, "Other admin");
		const other = await p.login(otherSession.token);
		assert.equal(result(await other.service(query), "people-invitation").invite, null);
		const otherInvite = await other.work({ op: "invite", ...original });
		assert.ok(otherInvite.kind === "invite");
		assert.notEqual(otherInvite.invite.id, created.invite.id);
		assert.equal(result(await other.service(query), "people-invitation").invite?.id, otherInvite.invite.id);
		const viewerSession = await p.app.people.redeem(created.token, "Reader");
		const viewer = await p.login(viewerSession.token);
		assert.equal((await viewer.service(query)).status, 403);
		const change = {
			requestId: "role-change",
			action: {
				op: "person.set" as const,
				personId: viewer.personId,
				role: "sender" as const,
				resources: "*" as const,
			},
		};
		assert.equal((await viewer.service({ op: "people.write", change })).status, 403);
		assert.equal(
			result(await p.owner.service({ op: "people.lookup", original: change }), "people-operation").receipt,
			null,
		);
		const receipt = result(await p.owner.service({ op: "people.write", change }), "people-receipt").receipt;
		assert.deepEqual(
			result(await p.owner.service({ op: "people.lookup", original: change }), "people-operation").receipt,
			receipt,
		);
		assert.equal(
			result(await other.service({ op: "people.lookup", original: change }), "people-operation").receipt,
			null,
		);
		assert.equal(
			(
				await p.owner.service({
					op: "people.lookup",
					original: { ...change, action: { ...change.action, role: "driver" } },
				})
			).status,
			409,
		);
		assert.equal((await viewer.service(query)).status, 401);
		let checks = 0;
		const cancellation = {
			requestId: "known-invite-revoke",
			action: { op: "invite.revoke" as const, id: created.invite.id },
		};
		await executePeople(
			{
				people: p.app.people,
				actor: p.owner.actor,
				check: () => {
					checks++;
				},
			},
			{ op: "people.write", change: cancellation },
		);
		let observed = 0;
		const lost = {
			requestId: "lost-invite-revoke",
			action: { op: "invite.revoke" as const, id: otherInvite.invite.id },
		};
		await assert.rejects(
			executePeople(
				{
					people: p.app.people,
					actor: p.owner.actor,
					check: () => {
						if (++observed === checks) throw new WebUiServiceRefusal("FORBIDDEN");
					},
				},
				{ op: "people.write", change: lost },
			),
			{ code: "UNKNOWN", confirmedNoEffect: false },
		);
		assert.equal(
			result(await p.owner.service({ op: "people.lookup", original: lost }), "people-operation").receipt
				?.requestId,
			lost.requestId,
		);
		assert.equal(
			(await p.app.people.list(p.owner.actor)).invites.find((invite) => invite.id === otherInvite.invite.id)
				?.status,
			"revoked",
		);
		await p.app.people.revokePerson(p.owner.actor, other.personId);
		assert.equal((await other.service(query)).status, 401);
		assert.equal(result(await p.owner.service(query), "people-invitation").invite?.status, "redeemed");
		assert.equal((await p.app.people.list(p.owner.actor)).invites.length, before.invites.length + 3);
		assert.equal(p.f.requests.length, 0);
	} finally {
		await p.close();
	}
});
