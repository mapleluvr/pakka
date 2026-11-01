import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

test(
	"foreign hot journal is refused without implicit rollback or file rewriting",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture(),
			file = m.runtime.view().sessionFile;
		await m.runtime.close();
		const child = fork(fileURLToPath(new URL("./sqlite-foreign-child.ts", import.meta.url)), [file], {
			silent: true,
			execArgv: ["--experimental-strip-types"],
		});
		let stderr = "";
		child.stderr!.on("data", (data) => {
			stderr += String(data);
		});
		try {
			const [ready] = await Promise.race([
				once(child, "message", { signal: AbortSignal.timeout(15000) }),
				once(child, "exit").then(() => {
					throw new Error("Foreign fixture exited before its journal: " + stderr);
				}),
			]);
			assert.equal(ready.ready, true);
			const exited = once(child, "exit");
			child.kill("SIGKILL");
			await exited;
			const before = await readFile(file),
				journal = await readFile(file + "-journal");
			assert.equal(journal.subarray(0, 8).toString("hex"), "d9d505f920a163d7", "real hot journal header");
			await assert.rejects(
				createRuntime({ ...m.config, reopenSessionFile: file }),
				/identity|read.?only|database/i,
			);
			assert.ok((await readFile(file)).equals(before), "refusal must not recover a foreign transaction");
			assert.ok((await readFile(file + "-journal")).equals(journal), "refusal preserves the hot journal");
			assert.equal(m.f.requests.length, 0);
		} finally {
			if (child.exitCode === null && child.signalCode === null) {
				const exited = once(child, "exit");
				child.kill("SIGKILL");
				await exited;
			}
			await m.close();
		}
	},
);
