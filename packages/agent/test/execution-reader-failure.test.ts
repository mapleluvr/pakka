import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalExecutionEnvironment, executionFor } from "../src/index.ts";
import { fixture } from "./fixture.ts";

for (const code of ["unknown", "foreign"] as const)
	test(`execution: reader ${code} result is checked like other environment operations`, async () => {
		const f = await fixture(
			{
				execution: {
					id: "reader-errors-v1",
					open: (target) => {
						const env = createLocalExecutionEnvironment({ cwd: target.cwd });
						return {
							...env,
							openBinaryReader: async (...args: Parameters<typeof env.openBinaryReader>) => {
								const opened = await env.openBinaryReader(...args);
								if (!opened.ok) return opened;
								return {
									ok: true as const,
									value: {
										...opened.value,
										read: async () => ({
											ok: false as const,
											// The foreign case deliberately tests an out-of-contract RPC error tag.
											error: { code: code as "unknown", message: "Reader connection lost" },
										}),
									},
								};
							},
						};
					},
				},
				tools: [
					{
						name: "probe_reader",
						description: "Read once",
						parameters: { type: "object", properties: {} },
						execute: async (_args, _signal, scope) => {
							const opened = await (await executionFor(scope)).openBinaryReader("reader.txt");
							if (!opened.ok) throw new Error(opened.error.message);
							await opened.value.read(0, 3).catch(() => {});
							return "IGNORED";
						},
					},
				],
			},
			(_body, n) => (n === 1 ? { tool: "probe_reader" } : { text: "MUST-NOT-DISPATCH" }),
		);
		try {
			await writeFile(join(f.cwd, "reader.txt"), "DATA");
			const host = await f.start();
			await host.connect("operator", ["input.submit"]).submit({ key: "reader", text: "Read once" });
			await host.waitForIdle();
			assert.equal(host.view().phase, "failed");
			assert.equal(f.requests.length, 1);
		} finally {
			await f.close();
		}
	});
