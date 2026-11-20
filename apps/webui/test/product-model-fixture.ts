import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fixture } from "../../../packages/agent/test/fixture.ts";

export async function isolated(reply?: Parameters<typeof fixture>[1]) {
	// ModelRuntime checks ambient native auth sources. Always use the repository's
	// credential-free runner, including for a name-filtered local test run.
	assert.equal(process.env.PI_OFFLINE, "1", "Run through scripts/test.mjs");
	const artifacts = process.env.PAKKA_TEST_ARTIFACTS;
	assert.ok(artifacts && isAbsolute(artifacts), "Run through scripts/test.mjs");
	const home = join(dirname(artifacts), "home");
	assert.equal(process.env.HOME, home);
	assert.equal(process.env.USERPROFILE, home);
	assert.equal(process.env.PI_CODING_AGENT_DIR, join(home, "pi"));
	const f = await fixture({}, reply);
	const agentDir = join(f.root, "pi-agent");
	await mkdir(agentDir);
	return { f, agentDir };
}

export async function configuration(agentDir: string, endpoint: string) {
	const model = {
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 262144,
		maxTokens: 8192,
		cost: { input: 1.5, output: 3, cacheRead: 0.15, cacheWrite: 0 },
	};
	await writeFile(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				alpha: {
					api: "openai-completions",
					baseUrl: endpoint,
					models: [{ ...model, id: "reasoner", name: "Alpha Reasoner" }],
				},
				beta: {
					api: "openai-completions",
					baseUrl: endpoint,
					models: Array.from({ length: 70 }, (_, n) => ({
						...model,
						id: `model-${String(n).padStart(3, "0")}`,
						name: `Beta ${n}`,
					})),
				},
			},
		}),
		{ mode: 0o600 },
	);
	await writeFile(
		join(agentDir, "auth.json"),
		JSON.stringify({
			alpha: { type: "api_key", key: "local-alpha-secret" },
			beta: { type: "api_key", key: "local-beta-secret" },
		}),
		{ mode: 0o600 },
	);
	await writeFile(
		join(agentDir, "settings.json"),
		JSON.stringify({
			defaultProvider: "alpha",
			defaultModel: "reasoner",
			defaultThinkingLevel: "high",
			theme: "dark",
		}),
	);
}
