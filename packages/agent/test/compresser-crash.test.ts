import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createCompresserSession, type CompresserSession } from "../src/index.ts";
import { fixture, deferred, seed } from "./fixture.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";

test(
	"Compresser hard interruption stays writer-locked; after explicit dead-writer recovery, only unconfirmed work seals without replay while fresh work can run",
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
			assert.equal(state.status, "open");
			assert.equal(state.conversations[0].sealed, true);
			assert.match(state.conversations[0].lastError!.reason, /Unconfirmed.*reopen/i);
			assert.equal(state.conversations.length, 1);
			assert.equal(state.conversations[0].status, "quarantined");
			assert.equal(f.requests.length, count, "reopening cannot schedule the unbound native request again");
			const host = await f.start({ inference: { ...inferencePolicy(f.endpoint).inference!, compresserSession: c } });
			await seed(host);
			const owner = host.connect("recovered-source", ["context_artifacts.write", "model.infer"]);
			owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
			const b = binding(owner), frame = b.readFrame();
			const job = b.createJob(frame.basis, { planId: "fresh-after-crash", targetEntryIds: [target(frame)], maxCalls: 2 });
			const result = await job.converse({ modelKey: "summary", prompt: "FRESH AUTHORIZED SOURCE", outputTool: { name: "submit_candidate", description: "Submit a complete candidate", parameters: { type: "object", properties: { text: { type: "string", minLength: 3 } }, required: ["text"], additionalProperties: false } } });
			assert.equal(result.status, "completed", "quarantining unconfirmed work does not retire the healthy shared container");
			assert.equal(f.requests.filter(p => p.model === "summary-model").length, 2);
			const after = await c.snapshot();
			assert.equal(after.status, "open");
			assert.deepEqual(after.conversations.find(row => row.jobId === state.conversations[0].jobId), state.conversations[0]);
			await writeFile(
				join(f.root, "crash-observation.json"),
				JSON.stringify({ stdout, stderr, exit, state, after, requestCountBeforeFreshWork: count, requestCount: f.requests.length }, null, 2),
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
