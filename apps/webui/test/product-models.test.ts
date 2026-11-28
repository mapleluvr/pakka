import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProvider } from "@earendil-works/pi-ai";
import * as completions from "@earendil-works/pi-ai/api/openai-completions";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isolated, configuration } from "./product-model-fixture.ts";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { createPocketPeople } from "../../server/src/pocket-people.ts";
import { openProductModels } from "../src/product-models.ts";
import type { ProductAuthControl, ProductAuthFlow } from "../src/product-model-auth.ts";

const allow = () => {};

// Replacing native configuration with one synthesized provider, truncating the
// catalogue at the profile limit, or returning request auth must fail this test.
test("Product model configuration: native files provide complete paged models and genuine capabilities without inference", async () => {
	const { f, agentDir } = await isolated();
	let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
	try {
		await configuration(agentDir, f.endpoint);
		await assert.doesNotReject(async () => {
			source = await openProductModels({ agentDir, cwd: f.cwd });
		});
		assert.ok(source);
		const control = source.bind({ id: "owner", check: allow });
		assert.deepEqual(source.defaults(), { model: "alpha/reasoner", thinkingLevel: "high" });
		const alpha = control.catalog({ provider: "alpha", limit: 20 });
		assert.equal(alpha.total, 1);
		assert.deepEqual(alpha.models[0], {
			key: "alpha/reasoner",
			provider: "alpha",
			model: "reasoner",
			name: "Alpha Reasoner",
			reasoning: true,
			thinkingLevels: ["off", "minimal", "low", "medium", "high"],
			input: ["text", "image"],
			contextWindow: 262144,
			maxOutputTokens: 8192,
			cost: { input: 1.5, output: 3, cacheRead: 0.15, cacheWrite: 0 },
			available: true,
		});
		const first = control.catalog({ provider: "beta", limit: 50 });
		assert.equal(first.total, 70);
		assert.equal(first.models.length, 50);
		assert.equal(first.nextOffset, 50);
		const second = control.catalog({
			provider: "beta",
			limit: 50,
			offset: first.nextOffset,
			revision: first.revision,
		});
		assert.equal(second.models.length, 20);
		assert.equal(second.models.at(-1)?.key, "beta/model-069");
		assert.equal(second.nextOffset, undefined);
		assert.equal(control.catalog({ query: "model-069" }).models[0]?.key, "beta/model-069");
		assert.equal(Object.isFrozen(first.models), true);
		assert.equal(Object.isFrozen(alpha.models[0]?.cost), true);
		assert.doesNotMatch(
			JSON.stringify({ state: control.status(), alpha, first, second }),
			/local-alpha-secret|local-beta-secret|baseUrl|headers/,
		);
		assert.equal(f.requests.length, 0);
	} finally {
		await source?.close();
		await f.close();
	}
});

test("Product model configuration: absent selection and credentials do not prevent management", async () => {
	const { f, agentDir } = await isolated();
	let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
	try {
		await assert.doesNotReject(async () => {
			source = await openProductModels({ agentDir, cwd: f.cwd });
		});
		assert.ok(source);
		const control = source.bind({ id: "owner", check: allow });
		assert.deepEqual(source.defaults(), {});
		assert.equal(control.catalog({ availableOnly: true }).total, 0);
		assert.ok(control.catalog({}).total > 0, "native built-in models remain discoverable before login");
		assert.deepEqual(control.status().issues, []);
		assert.equal(f.requests.length, 0);
	} finally {
		await source?.close();
		await f.close();
	}
});

test("Product model configuration: malformed native input is diagnosed without disclosure and recovers through refresh", async () => {
	const { f, agentDir } = await isolated();
	let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
	try {
		await writeFile(join(agentDir, "models.json"), '{"providers":{"secret-marker-never-display":');
		await assert.doesNotReject(async () => {
			source = await openProductModels({ agentDir, cwd: f.cwd });
		});
		assert.ok(source);
		let authorized = true;
		const control = source.bind({
			id: "owner",
			check: () => {
				if (!authorized) throw new Error("denied");
			},
		});
		assert.ok(control.status().issues.length > 0);
		assert.doesNotMatch(JSON.stringify(control.status()), /secret-marker-never-display/);
		const before = control.catalog({});
		await configuration(agentDir, f.endpoint);
		await control.refresh();
		assert.deepEqual(control.status().issues, []);
		assert.deepEqual(source.defaults(), { model: "alpha/reasoner", thinkingLevel: "high" });
		assert.equal(control.catalog({ provider: "beta" }).total, 70);
		assert.throws(() => control.catalog({ revision: before.revision }), /changed|stale/i);
		authorized = false;
		assert.throws(() => control.status(), /denied/);
		await assert.rejects(control.refresh(), /denied/);
		assert.equal(f.requests.length, 0);
		assert.match(await readFile(join(agentDir, "auth.json"), "utf8"), /local-alpha-secret/);
	} finally {
		await source?.close();
		await f.close();
	}
});

async function phase(auth: ProductAuthControl, id: string, target: ProductAuthFlow["phase"]) {
	for (let attempt = 0; attempt < 200; attempt++) {
		const current = auth.state(id);
		if (current.phase === target) return current;
		if (["unconfirmed", "cancelled"].includes(current.phase))
			assert.fail(`Unexpected authentication phase: ${current.phase}`);
		await delay(10);
	}
	assert.fail(`Authentication did not reach ${target}`);
}

// Asserts the actual canonical file and unrelated provider preservation, not a mock store call.
test("Product model authentication: native API key login persists only in auth.json and stays private to its login", async () => {
	const { f, agentDir } = await isolated();
	let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
	const scope = new AbortController();
	try {
		await configuration(agentDir, f.endpoint);
		source = await openProductModels({ agentDir, cwd: f.cwd });
		const control = source.bind({ id: "owner-login", check: allow, signal: scope.signal });
		const other = source.bind({ id: "another-login", check: allow, signal: scope.signal });
		assert.equal(control.auth.providers().find((p) => p.id === "alpha")?.configured, true);
		await control.auth.logout("alpha");
		assert.deepEqual(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")), {
			beta: { type: "api_key", key: "local-beta-secret" },
		});
		const prepared = control.auth.prepare("alpha", "api_key");
		assert.equal(prepared.phase, "prepared");
		assert.equal(prepared.prompt, undefined);
		assert.throws(() => other.auth.state(prepared.id));
		assert.throws(() => other.auth.start(prepared.id));
		control.auth.start(prepared.id);
		const waiting = await phase(control.auth, prepared.id, "waiting");
		assert.equal(waiting.prompt?.type, "secret");
		assert.ok(waiting.prompt);
		assert.throws(() => control.auth.answer(prepared.id, "stale-prompt", "must-not-store"));
		control.auth.answer(prepared.id, waiting.prompt.id, "local-replacement-secret");
		const complete = await phase(control.auth, prepared.id, "complete");
		assert.equal(
			control.auth.start(prepared.id).phase,
			"complete",
			"duplicate start never launches another native login",
		);
		assert.deepEqual(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")), {
			alpha: { type: "api_key", key: "local-replacement-secret" },
			beta: { type: "api_key", key: "local-beta-secret" },
		});
		assert.doesNotMatch(
			JSON.stringify({ complete, state: control.status(), providers: control.auth.providers() }),
			/local-replacement-secret|local-beta-secret|must-not-store/,
		);
		await control.auth.logout("alpha");
		assert.equal(control.catalog({ provider: "alpha", availableOnly: true }).total, 0);
		assert.equal(f.requests.length, 0);
	} finally {
		scope.abort();
		await source?.close();
		await f.close();
	}
});

test("Product model authentication: an actual role change cancels native persistence after the key was submitted", async () => {
	const { f, agentDir } = await isolated();
	let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
	let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		await configuration(agentDir, f.endpoint);
		source = await openProductModels({ agentDir, cwd: f.cwd });
		runtime = await createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			model: "",
			models: source.models,
			limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 4 },
		});
		const people = await createPocketPeople({ runtime, namespace: "native-auth-people" });
		const first = await people.initializeOwner("Owner"),
			owner = await people.authenticate(first.token);
		const invitation = await people.invite(owner, {
			requestId: "secondary",
			role: "admin",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const second = await people.redeem(invitation.token, "Admin"),
			actor = await people.authenticate(second.token);
		const lease = people.lease(actor, "extensions.install");
		const control = source.bind(lease);
		const prepared = control.auth.prepare("alpha", "api_key");
		control.auth.start(prepared.id);
		const waiting = await phase(control.auth, prepared.id, "waiting");
		assert.ok(waiting.prompt);
		control.auth.answer(prepared.id, waiting.prompt.id, "late-revoked-secret");
		const revocation = people.setPerson(owner, actor.person.id, { role: "viewer", resources: "*" });
		assert.equal(lease.signal.aborted, true);
		await revocation;
		await source.close();
		assert.deepEqual(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")), {
			alpha: { type: "api_key", key: "local-alpha-secret" },
			beta: { type: "api_key", key: "local-beta-secret" },
		});
		assert.equal(f.requests.length, 0);
	} finally {
		await source?.close();
		await runtime?.close();
		await f.close();
	}
});

test("Product model authentication: native OAuth prompts and notifications retain the full credential shape without disclosing it", async () => {
	const { f, agentDir } = await isolated();
	let source: Awaited<ReturnType<typeof openProductModels>> | undefined;
	const scope = new AbortController();
	try {
		source = await openProductModels({ agentDir, cwd: f.cwd });
		const native = source.models();
		assert.ok(native instanceof ModelRuntime);
		// A controlled provider uses the real native OAuth orchestration and file writer.
		native.registerNativeProvider(
			createProvider({
				id: "local-oauth",
				models: [],
				api: { "openai-completions": completions },
				auth: {
					oauth: {
						name: "Local OAuth",
						async login(interaction) {
							interaction.notify({
								type: "auth_url",
								url: "https://example.invalid/authorize?state=local-only",
							});
							const code = await interaction.prompt({ type: "manual_code", message: "Paste local code" });
							if (code !== "synthetic-confirmation-code") throw new Error("Unexpected local code");
							return {
								type: "oauth",
								access: "local-access-secret",
								refresh: "local-refresh-secret",
								expires: 4102444800000,
								accountId: "local-account",
							};
						},
						async refresh(credential) {
							return credential;
						},
						async toAuth(credential) {
							return { apiKey: credential.access };
						},
					},
				},
			}),
		);
		const control = source.bind({ id: "owner-login", check: allow, signal: scope.signal });
		const prepared = control.auth.prepare("local-oauth", "oauth");
		control.auth.start(prepared.id);
		const waiting = await phase(control.auth, prepared.id, "waiting");
		assert.equal(waiting.prompt?.type, "manual_code");
		assert.deepEqual(waiting.events, [
			{ type: "auth_url", url: "https://example.invalid/authorize?state=local-only" },
		]);
		assert.ok(waiting.prompt);
		control.auth.answer(prepared.id, waiting.prompt.id, "synthetic-confirmation-code");
		const completed = await phase(control.auth, prepared.id, "complete");
		assert.deepEqual(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")), {
			"local-oauth": {
				type: "oauth",
				access: "local-access-secret",
				refresh: "local-refresh-secret",
				expires: 4102444800000,
				accountId: "local-account",
			},
		});
		assert.doesNotMatch(
			JSON.stringify(completed),
			/local-access-secret|local-refresh-secret|synthetic-confirmation-code/,
		);
		assert.doesNotMatch(JSON.stringify(control.status()), /local-only|example.invalid/);
		assert.equal(f.requests.length, 0);
	} finally {
		scope.abort();
		await source?.close();
		await f.close();
	}
});
