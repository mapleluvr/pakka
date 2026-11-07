import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { startPocket } from "../src/bootstrap.ts";
import { openProductModels } from "../src/product-models.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { runtimeLimits } from "../../../packages/agent/test/runtime-fixture.ts";

async function product(configured = true) {
	const { f, agentDir } = await isolated();
	if (configured) await configuration(agentDir, f.endpoint);
	const source = await openProductModels({ agentDir, cwd: f.cwd });
	let app: Awaited<ReturnType<typeof startPocket>>;
	try {
		app = await startPocket({
			runtime: {
				cwd: f.cwd,
				dataDir: f.dataDir,
				model: source.defaults().model ?? "",
				models: source.models,
				limits: runtimeLimits,
			},
			modelConfiguration: source,
			owner: "Owner",
			initial: [{ name: "Work", profile: "default" }],
		});
	} catch (error) {
		await source.close();
		await f.close();
		throw error;
	}
	const origin = app.http.origin;
	async function login(token: string) {
		const response = await fetch(origin + "/pocket/exchange", {
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
		return {
			actor,
			async rpc(command: object, options: { requestId?: string; csrf?: string; path?: string } = {}) {
				const requestId = options.requestId ?? crypto.randomUUID();
				const response = await fetch(origin + (options.path ?? "/pocket/models/rpc"), {
					method: "POST",
					headers: {
						Origin: origin,
						Cookie: cookie,
						"X-Pakka-CSRF": options.csrf ?? csrf,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ version: 2, requestId, command }),
				});
				return {
					status: response.status,
					value: await response.json(),
					headers: response.headers,
					requestId,
				};
			},
		};
	}
	assert.ok(app.initialOwner);
	const owner = await login(app.initialOwner.token);
	return {
		f,
		agentDir,
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

test("Product model HTTP: authenticated paging returns genuine capabilities without credentials or inference", async () => {
	const p = await product();
	try {
		const status = await p.owner.rpc({ op: "status" });
		assert.equal(status.status, 200);
		assert.equal(status.headers.get("cache-control"), "no-store");
		assert.equal(status.value.result.status.defaults.model, "alpha/reasoner");
		const catalog = await p.owner.rpc({ op: "catalog", query: { provider: "beta", limit: 50 } });
		assert.equal(catalog.status, 200);
		assert.equal(catalog.value.result.page.total, 70);
		const second = await p.owner.rpc({
			op: "catalog",
			query: { provider: "beta", offset: 50, revision: catalog.value.result.page.revision },
		});
		assert.equal(second.value.result.page.models.at(-1).key, "beta/model-069");
		const alpha = await p.owner.rpc({ op: "catalog", query: { provider: "alpha" } });
		assert.equal(alpha.value.result.page.models[0].contextWindow, 262144);
		assert.equal(alpha.value.result.page.models[0].reasoning, true);
		assert.doesNotMatch(
			JSON.stringify([status.value, catalog.value, second.value, alpha.value]),
			/local-alpha-secret|local-beta-secret|baseUrl|headers/,
		);
		assert.equal((await p.owner.rpc({ op: "refresh" }, { csrf: "incorrect" })).status, 403);
		assert.equal((await p.owner.rpc({ op: "catalog", query: { limit: 1000000 } })).status, 400);
		assert.equal(p.f.requests.length, 0);
	} finally {
		await p.close();
	}
});

test("Product model HTTP: native authentication is login-bound and persists only through Pi auth storage", async () => {
	const p = await product();
	try {
		const prepare = await p.owner.rpc({ op: "auth.prepare", provider: "alpha", type: "api_key" });
		assert.equal(prepare.status, 200);
		const id = prepare.value.result.flow.id;
		assert.equal(prepare.value.result.flow.phase, "prepared");
		const invitation = await p.app.people.invite(p.owner.actor, {
			requestId: "another-login",
			role: "admin",
			resources: "*",
			ttlMs: 60000,
			personId: p.app.people.current(p.owner.actor).id,
		});
		assert.ok(invitation.token);
		const session = await p.app.people.redeem(invitation.token, "Owner again");
		const other = await p.login(session.token);
		assert.notEqual((await other.rpc({ op: "auth.state", id })).status, 200);
		assert.equal((await p.owner.rpc({ op: "auth.start", id })).status, 200);
		let state = await p.owner.rpc({ op: "auth.state", id });
		for (let n = 0; n < 100 && state.value.result?.flow.phase !== "waiting"; n++) {
			await delay(10);
			state = await p.owner.rpc({ op: "auth.state", id });
		}
		assert.equal(state.value.result.flow.phase, "waiting");
		const answer = await p.owner.rpc({
			op: "auth.answer",
			id,
			promptId: state.value.result.flow.prompt.id,
			value: "rpc-private-new-key",
		});
		assert.equal(answer.status, 200);
		for (let n = 0; n < 100; n++) {
			state = await p.owner.rpc({ op: "auth.state", id });
			if (state.value.result.flow.phase === "complete") break;
			await delay(10);
		}
		assert.equal(state.value.result.flow.phase, "complete");
		assert.equal(
			JSON.parse(await readFile(join(p.agentDir, "auth.json"), "utf8")).alpha.key,
			"rpc-private-new-key",
		);
		assert.doesNotMatch(
			JSON.stringify([prepare.value, answer.value, state.value]),
			/rpc-private-new-key|local-alpha-secret/,
		);
		assert.equal(p.f.requests.length, 0);
	} finally {
		await p.close();
	}
});

test("Product model HTTP: budget changes bind the actual owner, require live permission and reconcile the original request", async () => {
	const p = await product();
	try {
		const sessionId = p.app.runtime.view().sessionId;
		const read = await p.owner.rpc({ op: "budget.read", sessionId });
		assert.equal(read.status, 200);
		const before = read.value.result.policy;
		const change = {
			op: "budget.change",
			sessionId,
			expectedVersion: before.version,
			limits: { ...before.limits, maxPrimaryAttempts: 101 },
			reason: "Owner top-up",
		};
		assert.equal((await p.owner.rpc({ ...change, actorId: "forged" })).status, 400);
		const result = await p.owner.rpc(change);
		assert.equal(result.status, 200);
		assert.equal(result.value.result.receipt.actorId, p.app.people.current(p.owner.actor).id);
		const receipt = await p.owner.rpc({
			op: "budget.receipt",
			sessionId,
			originalRequestId: result.requestId,
		});
		assert.deepEqual(receipt.value.result.receipt, result.value.result.receipt);
		assert.equal((await p.owner.rpc(change, { requestId: result.requestId })).status, 200);
		assert.equal(p.app.runtime.view().limits.maxPrimaryAttempts, 101);
		assert.equal((await p.app.runtime.budgetHistory({}, () => {})).items.length, 1);
		const stale = await p.owner.rpc(change);
		assert.equal(stale.status, 409, "a new request with an old policy version is a definite refusal");
		assert.equal(stale.value.error.code, "CONFLICT");
		assert.equal(stale.value.error.outcome, "denied");
		assert.equal(p.app.runtime.view().limits.maxPrimaryAttempts, 101);
		assert.equal((await p.app.runtime.budgetHistory({}, () => {})).items.length, 1);
		const invited = await p.app.people.invite(p.owner.actor, {
			requestId: "collaborator",
			role: "sender",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invited.token);
		const guest = await p.login((await p.app.people.redeem(invited.token, "Collaborator")).token);
		assert.equal((await guest.rpc({ ...change, expectedVersion: before.version + 1 })).status, 403);
		assert.equal((await guest.rpc({ op: "status" })).status, 403);
		assert.equal(p.f.requests.length, 0);
	} finally {
		await p.close();
	}
});

test("Product model HTTP: no selected model remains manageable and arbitrary registered models do not require profiles", async () => {
	const p = await product(false);
	try {
		const sessions = await p.owner.rpc({ op: "session.list" }, { path: "/pocket/rpc" });
		assert.equal(sessions.status, 200);
		assert.ok("result" in decodePocketResponse(sessions.value, sessions.requestId));
		const client = p.app.workspace.bind(p.owner.actor);
		let ref = (await client.list())[0]!;
		assert.equal((await client.configuration(ref)).current.model, "");
		const empty = await p.owner.rpc({ op: "configuration", target: ref }, { path: "/pocket/rpc" });
		assert.equal(empty.status, 200);
		const decoded = decodePocketResponse(empty.value, empty.requestId);
		assert.ok("result" in decoded && decoded.result.kind === "configuration");
		assert.equal(decoded.result.configuration.current?.model, "");
		await configuration(p.agentDir, p.f.endpoint);
		assert.equal((await p.owner.rpc({ op: "refresh" })).status, 200);
		const changed = await p.owner.rpc(
			{ op: "configure.agent", target: ref, change: { model: "beta/model-069" } },
			{ path: "/pocket/rpc" },
		);
		assert.equal(changed.status, 200);
		ref = changed.value.result.ref;
		assert.equal((await client.configuration(ref)).current.model, "beta/model-069");
		assert.equal(p.app.runtime.profileChoices().length, 1);
		assert.equal(p.f.requests.length, 0);
	} finally {
		await p.close();
	}
});

test("Product model HTTP: explicit thinking reaches native requests and slash-prefixed text is ordinary input", async () => {
	const p = await product();
	try {
		const client = p.app.workspace.bind(p.owner.actor);
		let ref = (await client.list())[0]!;
		const changed = await p.owner.rpc(
			{ op: "configure.agent", target: ref, change: { thinkingLevel: "high" } },
			{ path: "/pocket/rpc" },
		);
		assert.equal(changed.status, 200);
		ref = changed.value.result.ref;
		const viewed = await p.owner.rpc({ op: "configuration", target: ref }, { path: "/pocket/rpc" });
		const decoded = decodePocketResponse(viewed.value, viewed.requestId);
		assert.ok("result" in decoded && decoded.result.kind === "configuration");
		assert.equal(decoded.result.configuration.current?.thinkingLevel, "high");
		const submit = await p.owner.rpc(
			{
				op: "submit",
				target: ref,
				input: {
					requestId: "literal-path",
					mode: "prompt",
					text: "/tmp/report.txt is a literal path, not a command",
				},
			},
			{ path: "/pocket/rpc" },
		);
		assert.equal(submit.status, 200);
		await client.wait(submit.value.result.receipt.id);
		assert.equal(p.f.requests.length, 1);
		assert.equal(p.f.requests[0]?.reasoning_effort, "high");
		assert.match(JSON.stringify(p.f.requests[0]?.messages), /\/tmp\/report\.txt/);
	} finally {
		await p.close();
	}
});
