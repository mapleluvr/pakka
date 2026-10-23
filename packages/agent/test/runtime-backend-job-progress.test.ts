import { test } from "node:test";
import { strict as assert } from "node:assert";
import { appendFile, readFile, mkdir, cp, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, type JsonObject } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

const options = { namespace: "progress-jobs", maxJobs: 1, maxBytes: 65536 };
const cases: readonly { name: string; first: JsonObject; equivalent: JsonObject; executions: number }[] = [
	{ name: "initial empty checkpoint", first: {}, equivalent: {}, executions: 1 },
	{
		name: "reordered nested object keys",
		first: { left: 1, right: { a: 2, b: 3 } },
		equivalent: { right: { b: 3, a: 2 }, left: 1 },
		executions: 2,
	},
	{ name: "equivalent JSON zero", first: { value: 0 }, equivalent: { value: -0 }, executions: 2 },
];

// Native progress compares JSON values, not object identity or key order. A no-op advance must fail closed inside
// the adapter, before an outer scheduler fault can leave its already-queued public receipt behind indefinitely.
for (const example of cases) {
	test(
		`WebUI job progress: ${example.name} preserves unknown after a real effect and never repeats it`,
		{ timeout: 8000 },
		async (t) => {
			let executions = 0,
				effectFile = "";
			const m = await runtimeFixture({
				jobs: [
					{
						id: "no-progress",
						version: 1,
						authorize: () => {},
						run: async (ctx) => {
							executions++;
							if (Object.keys(ctx.checkpoint).length === 0 && Object.keys(example.first).length > 0) {
								await ctx.advance(example.first);
								return;
							}
							await appendFile(effectFile, "ONE-UNCONFIRMED-EFFECT\n");
							await ctx.advance(example.equivalent);
						},
					},
				],
			});
			let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
			try {
				effectFile = join(m.f.root, "job-progress-effect.txt");
				const port = m.runtime.jobs(options),
					spec = {
						requestId: "original",
						actorId: "human",
						target: m.runtime.view().conversations[0]!,
						definition: "no-progress",
						payload: {},
					};
				const admitted = await port.start(spec, () => {});
				await t.waitFor(
					async () => assert.equal((await port.receipt(admitted.id, () => {})).state, "unknown"),
					{ timeout: 1000 },
				);
				const settled = await port.wait(admitted.id, () => {});
				assert.equal(settled.nativeTerminal, "completed");
				assert.equal(executions, example.executions);
				assert.equal(await readFile(effectFile, "utf8"), "ONE-UNCONFIRMED-EFFECT\n");
				assert.equal(m.f.requests.length, 0);
				const file = m.runtime.view().sessionFile;
				await m.runtime.close();
				assert.doesNotMatch(await readFile(file, "utf8"), /returned without durable progress/);
				reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
				const restored = reopened.jobs(options);
				assert.deepEqual(await restored.receipt(settled.id, () => {}), settled);
				assert.deepEqual(await restored.start(spec, () => {}), settled);
				await assert.rejects(
					restored.start({ ...spec, requestId: "another" }, () => {}),
					/capacity/i,
				);
				assert.equal(executions, example.executions);
				assert.equal(await readFile(effectFile, "utf8"), "ONE-UNCONFIRMED-EFFECT\n");
				assert.equal(reopened.view().phase, "ready");
				assert.equal(m.f.requests.length, 0);
				if (process.env.PAKKA_TEST_ARTIFACTS) {
					await reopened.close();
					const output = join(
						process.env.PAKKA_TEST_ARTIFACTS,
						"job-progress",
						example.name.replaceAll(" ", "-"),
						spec.target.sessionId,
					);
					await mkdir(output, { recursive: true });
					await cp(m.f.dataDir, join(output, "storage"), { recursive: true });
					await copyFile(effectFile, join(output, "effect.txt"));
					await writeFile(
						join(output, "receipt.json"),
						JSON.stringify({ receipt: settled, executions, modelHttp: m.f.requests.length }, null, 2) + "\n",
					);
				}
			} finally {
				await reopened?.close();
				await m.close();
			}
		},
	);
}
