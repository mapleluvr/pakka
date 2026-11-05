import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHost, executionFor } from "../src/index.ts";
import { deferred, fixture } from "./fixture.ts";

// A driver acknowledging cleanup early must not let Host disposal outrun an already admitted file operation.
test(
	"execution: disposal awaits an admitted operation that does not honor abort",
	{ timeout: 10000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		let written = false;
		const f = await fixture({}, (_body, n) => (n === 1 ? { tool: "slow_write" } : { text: "DO-NOT-RETRY" }));
		const host = await createHost({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			execution: {
				id: "slow-v1",
				open: (target) => ({
					id: "delayed-local",
					cwd: target.cwd,
					writeFile: async (path, content) => {
						entered.resolve();
						await release.promise;
						await writeFile(
							join(target.cwd, path),
							typeof content === "string" ? content : Buffer.from(content.base64, "base64"),
						);
						written = true;
						return { ok: true as const, value: undefined };
					},
					cleanup: async () => {},
				}),
			},
			tools: [
				{
					name: "slow_write",
					description: "Delayed file operation",
					parameters: { type: "object", properties: {} },
					execute: async (_args, _signal, scope) => {
						const env = await executionFor(scope);
						await env.writeFile("slow.txt", "SETTLED");
						return "DONE";
					},
				},
			],
		});
		let timer: NodeJS.Timeout | undefined;
		try {
			await host.connect("operator", ["input.submit"]).submit({ key: "slow", text: "Write once" });
			await entered.promise;
			// The external effect is intentionally non-cancellable but has a finite, controlled completion.
			timer = setTimeout(release.resolve, 500);
			await host.dispose();
			assert.equal(written, true, "Disposal is not just an abort/cleanup acknowledgment");
			assert.equal(await readFile(join(f.cwd, "slow.txt"), "utf8"), "SETTLED");
			assert.equal(f.requests.length, 1);
		} finally {
			if (timer) clearTimeout(timer);
			release.resolve();
			await host.dispose();
			await f.close();
		}
	},
);
