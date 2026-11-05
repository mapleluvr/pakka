import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createLocalExecutionEnvironment,
	executionFor,
	type ExecutionConfiguration,
	type HostOptions,
} from "../src/index.ts";
import { fixture } from "./fixture.ts";

for (const [name, patch] of [
	["empty identity", { id: "" }],
	["missing factory", { open: null }],
	["duplicate native tool", { tools: ["read", "read"] }],
	["unknown native tool", { tools: ["not-a-tool"] }],
] as const) {
	// Accepting malformed bootstrap configuration defers errors until after storage/admission setup.
	test(`execution: invalid ${name} is rejected before use`, async () => {
		let opened = 0;
		const original: ExecutionConfiguration = {
			id: "valid-v1",
			tools: ["read"],
			open: (target) => {
				opened++;
				return createLocalExecutionEnvironment({ cwd: target.cwd });
			},
		};
		// SAFETY: deliberately malformed external configuration exercises runtime validation, not the TS type checker.
		const execution = { ...original, ...patch } as unknown as ExecutionConfiguration;
		const f = await fixture({ execution });
		try {
			await assert.rejects(async () => {
				const host = await f.start();
				await host.dispose();
			}, /execution|native tool/i);
			assert.equal(opened, 0);
			assert.equal(f.requests.length, 0);
		} finally {
			await f.close();
		}
	});
}

// Ambiguous tool names must not silently replace the selected native implementation.
test("execution: native/custom tool name collisions are rejected", async () => {
	const f = await fixture({
		execution: {
			id: "collision-v1",
			tools: ["read"],
			open: (target) => createLocalExecutionEnvironment({ cwd: target.cwd }),
		},
		tools: [
			{
				name: "read",
				description: "Collision",
				parameters: { type: "object", properties: {} },
				execute: async () => "SHADOW",
			},
		],
	});
	try {
		await assert.rejects(async () => {
			const host = await f.start();
			await host.dispose();
		}, /execution|duplicate|collision/i);
		assert.equal(f.requests.length, 0);
	} finally {
		await f.close();
	}
});

// A caller catching a lost acknowledgment must not permit another model request or replay the write.
for (const code of ["unknown", "foreign"] as const)
	test(`execution: a ${code} result after a real effect fails closed even when the tool catches it`, async () => {
		let calls = 0;
		const config: Partial<HostOptions> = {
			execution: {
				id: "unknown-v1",
				open: (target) => {
					const env = createLocalExecutionEnvironment({ cwd: target.cwd });
					return {
						...env,
						writeFile: async (...args: Parameters<typeof env.writeFile>) => {
							calls++;
							await env.writeFile(...args);
							return {
								ok: false as const,
								// The foreign tag deliberately violates the external driver's error contract.
								error: { code: code as "unknown", message: "Lost write acknowledgment" },
							};
						},
					};
				},
			},
			tools: [
				{
					name: "unknown_write",
					description: "Write once",
					parameters: { type: "object", properties: {} },
					execute: async (_args, _signal, scope) => {
						const env = await executionFor(scope);
						await env.writeFile("unknown.txt", "EFFECT").catch(() => {});
						return "IGNORED";
					},
				},
			],
		};
		const f = await fixture(config, (_body, n) =>
			n === 1 ? { tool: "unknown_write" } : { text: "MUST-NOT-DISPATCH" },
		);
		try {
			const host = await f.start();
			const user = host.connect("operator", ["input.submit"]);
			await user.submit({ key: "unknown", text: "Write once" });
			await host.waitForIdle();
			assert.equal(await readFile(join(f.cwd, "unknown.txt"), "utf8"), "EFFECT");
			assert.equal(host.view().phase, "failed");
			await assert.rejects(() => user.submit({ key: "retry", text: "Retry" }), /failed|ready|admission/i);
			assert.equal(calls, 1);
			assert.equal(f.requests.length, 1);
		} finally {
			await f.close();
		}
	});
