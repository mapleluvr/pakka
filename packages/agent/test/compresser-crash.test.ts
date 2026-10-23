import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createCompresserSession, type CompresserSession } from "../src/index.ts";
import { fixture, deferred } from "./fixture.ts";

test(
	"Compresser hard interruption stays writer-locked; after explicit dead-writer recovery, unconfirmed work seals without replay",
	{ timeout: 20000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture({}, async (payload) => {
			if (payload.model !== "summary-model") return { text: "MAIN" };
			entered.resolve();
			await release.promise;
			return { tool: "submit_candidate", args: { text: "LATE" } };
		});
		const child = spawn(
			process.execPath,
			[
				"--experimental-strip-types",
				fileURLToPath(new URL("./compresser-crash-child.ts", import.meta.url)),
				f.root,
				f.cwd,
				f.dataDir,
				f.endpoint,
			],
			{ env: process.env, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "",
			stderr = "",
			c: CompresserSession | undefined;
		child.stdout.on("data", (value) => {
			stdout += String(value);
		});
		child.stderr.on("data", (value) => {
			stderr += String(value);
		});
		const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) => resolve({ code, signal }));
		});
		const options = {
			storageDir: join(f.root, "compresser"),
			toolCallingTolerance: 3,
			unresolvedErrorTolerance: 4,
		};
		try {
			await Promise.race([
				entered.promise,
				exited.then((value) => {
					throw new Error("Crash child ended before HTTP: " + JSON.stringify(value) + "\n" + stderr);
				}),
			]);
			assert.equal(child.kill(), true);
			const exit = await exited;
			release.resolve();
			const count = f.requests.length;
			assert.equal(count, 2);
			await assert.rejects(createCompresserSession(options), /writer.*locked/i);
			// Test-operator action ONLY after the OS-confirmed child exit, not implicit product stale-claim recovery.
			await unlink(join(options.storageDir, "pakka-writer.json"));
			c = await createCompresserSession(options);
			const state = await c.snapshot();
			assert.equal(state.status, "sealed");
			assert.match(state.lastError!.reason, /Unconfirmed.*reopen/i);
			assert.equal(state.conversations.length, 1);
			assert.equal(state.conversations[0].status, "quarantined");
			assert.equal(f.requests.length, count, "reopening cannot schedule the unbound native request again");
			await writeFile(
				join(f.root, "crash-observation.json"),
				JSON.stringify({ stdout, stderr, exit, state, requestCount: count }, null, 2),
			);
		} finally {
			release.resolve();
			if (child.exitCode === null && child.signalCode === null) child.kill();
			await exited.catch(() => {});
			await c?.close();
			await f.close();
		}
	},
);
