import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBootstrap } from "../src/bootstrap.ts";

function config() {
	return {
		schema: "pakka.server.v1",
		runtime: {
			cwd: "unused-local-workspace",
			dataDir: "unused-local-profile",
			endpoint: "http://127.0.0.1:1/v1",
			model: "main-local",
			apiKey: "test-only",
			systemPrompt: "LEADING-SYSTEM",
			limits: { maxConversations: 4, maxPrimaryAttempts: 10, maxAuxiliaryAttempts: 2 },
			inference: {
				models: [
					{
						key: "summary",
						model: "summary-local",
						endpoint: "http://127.0.0.1:1/v1",
						apiKey: "test-summary-only",
						contextWindow: 16000,
						maxTokens: 512,
					},
				],
				policies: [
					{
						strategyId: "dynamite",
						modelKeys: ["summary"],
						maxCalls: 2,
						maxJobCalls: 1,
						maxOutputTokens: 64,
						timeoutMs: 1000,
					},
				],
			},
		},
		mas: { namespace: "product", maxDeliveries: 10, maxPending: 2 },
		members: [{ key: "root", owner: "operator" }],
		roles: [
			{
				token: "local-dynamite-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				principal: "operator",
				sourceKey: null,
				grants: ["discover", "send", "observe"],
			},
		],
		dynamite: { members: [{ key: "root", config: { autoCompress: false, compressionMaxOutputTokens: 64 } }] },
	};
}

test("product Dynamite: explicit root selection and existing controlled inference configuration are decoded", () => {
	const value = config();
	assert.equal(decodeBootstrap(value).runtime.inference?.policies[0]?.maxCalls, 2);
});

test("product Dynamite: dynamic module/profile authority and ambiguous member selection are refused", () => {
	for (const extra of [
		{ module: "arbitrary/plugin" },
		{ endpoint: "http://127.0.0.1:1" },
		{ members: [{ key: "missing" }] },
		{ members: [{ key: "root" }, { key: "root" }] },
	])
		assert.throws(() => decodeBootstrap({ ...config(), dynamite: { ...config().dynamite, ...extra } }));
	const remote = config();
	remote.roles[0]!.grants.push("configure");
	assert.throws(() => decodeBootstrap(remote));
});

test("product Dynamite: explicit bounded pressure threshold is preserved rather than silently normalized", () => {
	for (const threshold of [
		{ mode: "tokens", tokens: 1 },
		{ mode: "percentage", percentage: 65 },
	]) {
		const value = { ...config(), dynamite: { members: [{ key: "root", config: { threshold } }] } };
		assert.deepEqual(decodeBootstrap(value).dynamite?.members[0]?.config?.threshold, threshold);
	}
});

test("product Dynamite: invalid or unbounded inference and strategy options cannot enter startup", () => {
	for (const maxCalls of [0, -1, Infinity, NaN]) {
		const value = config();
		value.runtime.inference.policies[0]!.maxCalls = maxCalls;
		assert.throws(() => decodeBootstrap(value));
	}
	for (const configPatch of [
		{ arbitrary: true },
		{ autoCompress: "yes" },
		{ compressionMaxOutputTokens: -1 },
		{ compressionAttemptsPerModel: 0 },
		{ threshold: { mode: "tokens", tokens: 0 } },
		{ threshold: { mode: "tokens", tokens: Infinity } },
		{ threshold: { mode: "percentage", percentage: 81 } },
		{ threshold: { mode: "percentage", percentage: NaN } },
		{ threshold: { mode: "tokens", tokens: 1, endpoint: "http://127.0.0.1:1" } },
		{ protectedTail: { steps: 1, tokens: 1 } },
	])
		assert.throws(() =>
			decodeBootstrap({ ...config(), dynamite: { members: [{ key: "root", config: configPatch }] } }),
		);
});
