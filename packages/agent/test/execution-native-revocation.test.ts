import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalExecutionEnvironment } from "../src/index.ts";
import { deferred, fixture } from "./fixture.ts";

test(
	"execution: native edit cannot write after reload starts while its read was pending",
	{ timeout: 10000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		let writes = 0;
		const f = await fixture(
			{
				execution: {
					id: "native-revocation-v1",
					tools: ["edit"],
					open: (target) => {
						const local = createLocalExecutionEnvironment({ cwd: target.cwd });
						return {
							...local,
							// Deliberately ignore signal at the driver seam: the invocation guard must still fence the next effect.
							fileInfo: (path) => local.fileInfo(path),
							canonicalPath: (path) => local.canonicalPath(path),
							readTextFile: async (path) => {
								const result = await local.readTextFile(path);
								entered.resolve();
								await release.promise;
								return result;
							},
							writeFile: (path, content) => {
								writes++;
								return local.writeFile(path, content);
							},
						};
					},
				},
			},
			(_body, n) =>
				n === 1
					? { tool: "edit", args: { path: "protected.txt", edits: [{ oldText: "OLD", newText: "LATE" }] } }
					: { text: "MUST-NOT-DISPATCH" },
		);
		try {
			await writeFile(join(f.cwd, "protected.txt"), "OLD");
			const host = await f.start();
			await host.connect("operator", ["input.submit"]).submit({ key: "edit", text: "Edit once" });
			await entered.promise;
			const stopping = host.reload();
			release.resolve();
			await stopping;
			await host.waitForIdle();
			assert.equal(await readFile(join(f.cwd, "protected.txt"), "utf8"), "OLD");
			assert.equal(writes, 0);
			assert.equal(f.requests.length, 1);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);
