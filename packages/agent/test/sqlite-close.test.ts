import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../src/index.ts";
import { fixture } from "./fixture.ts";

test(
	"an unconfirmed published-storage close retains writer ownership and its failed promise",
	{ timeout: 20000 },
	async () => {
		const f = await fixture();
		const options = {
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			limits: { maxConversations: 8, maxPrimaryAttempts: 100, maxAuxiliaryAttempts: 20 },
		};
		const optionsFile = join(f.root, "sqlite-close-options.json");
		await writeFile(optionsFile, JSON.stringify(options));
		const child = fork(fileURLToPath(new URL("./sqlite-close-child.ts", import.meta.url)), [optionsFile], {
			silent: true,
			execArgv: ["--experimental-strip-types"],
		});
		let stderr = "";
		child.stderr!.on("data", (data) => {
			stderr += String(data);
		});
		try {
			const [observation] = await Promise.race([
				once(child, "message", { signal: AbortSignal.timeout(15000) }),
				once(child, "exit").then(() => {
					throw new Error("Close fixture exited before its receipt: " + stderr);
				}),
			]);
			assert.equal(typeof observation.error, "string", JSON.stringify(observation));
			assert.match(observation.error, /I.O|disk|database|checkpoint|SQLite/i);
			assert.equal(observation.writerRetained, true);
			assert.equal(observation.sameClosePromise, true, "a repeated close cannot fabricate success");
			await assert.rejects(
				createRuntime({ ...options, reopenSessionFile: observation.file }),
				/writer|claim|ownership/i,
			);
			assert.equal(f.requests.length, 0);
		} finally {
			if (child.exitCode === null && child.signalCode === null) {
				const exited = once(child, "exit");
				child.kill("SIGKILL");
				await exited;
			}
			await f.close();
		}
	},
);
