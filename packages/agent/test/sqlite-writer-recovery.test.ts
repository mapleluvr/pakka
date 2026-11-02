import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, access, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as agent from "../src/index.ts";
import { fixture } from "./fixture.ts";

function recover(options: unknown) {
	const command = (agent as any).recoverStorageWriter;
	assert.equal(typeof command, "function", "trusted storage-writer maintenance must be a public command");
	return command(options);
}
test("writer recovery refuses a live process and a mismatched claim without modifying bytes", async () => {
	const f = await fixture();
	try {
		const host = await f.start(),
			storageDir = dirname(host.view().sessionFile),
			path = join(storageDir, "pakka-writer.json"),
			original = await readFile(path, "utf8"),
			claim = JSON.parse(original);
		await assert.rejects(
			async () => recover({ storageDir, expectedClaim: { pid: claim.pid, nonce: randomUUID() } }),
			/changed|mismatch|identity/i,
		);
		await assert.rejects(
			async () => recover({ storageDir, expectedClaim: { pid: claim.pid, nonce: claim.nonce } }),
			/alive|live|running/i,
		);
		assert.equal(await readFile(path, "utf8"), original);
		assert.equal(host.view().phase, "ready");
		assert.equal(f.requests.length, 0);
	} finally {
		await f.close();
	}
});

test(
	"trusted maintenance releases the exact killed writer without opening a model or changing the database",
	{ timeout: 30000 },
	async () => {
		const f = await fixture();
		let child: ReturnType<typeof fork> | undefined;
		try {
			const configuration = join(f.root, "writer-child.json");
			await writeFile(
				configuration,
				JSON.stringify({
					cwd: f.cwd,
					dataDir: f.dataDir,
					endpoint: f.endpoint,
					model: "local-model",
					apiKey: "local-only",
					systemPrompt: "PAKKA-SYSTEM",
				}),
			);
			child = fork(fileURLToPath(new URL("./writer-recovery-child.ts", import.meta.url)), [configuration], {
				silent: true,
				execArgv: ["--experimental-strip-types"],
			});
			let stderr = "";
			child.stderr!.on("data", (data) => {
				stderr += String(data);
			});
			const [message] = await Promise.race([
				once(child, "message", { signal: AbortSignal.timeout(15000) }),
				once(child, "exit").then(() => {
					throw new Error("writer exited before claim publication: " + stderr);
				}),
			]);
			const storageDir = dirname(message.file),
				path = join(storageDir, "pakka-writer.json"),
				claim = JSON.parse(await readFile(path, "utf8"));
			assert.equal(claim.pid, child.pid);
			await assert.rejects(f.start({ reopenSessionFile: message.file }), /locked|writer/i);
			const exit = once(child, "exit");
			child.kill("SIGKILL");
			await exit;
			const files = [message.file, message.file + "-wal"],
				before = await Promise.all(
					files.map(async (file) => {
						try {
							return await readFile(file);
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
							throw error;
						}
					}),
				);
			const result = await recover({ storageDir, expectedClaim: { pid: claim.pid, nonce: claim.nonce } });
			assert.equal(result.status, "released");
			assert.equal(result.nonce, claim.nonce);
			assert.ok(Object.isFrozen(result));
			await assert.rejects(access(path), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
			assert.deepEqual(
				await Promise.all(
					files.map(async (file) => {
						try {
							return await readFile(file);
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
							throw error;
						}
					}),
				),
				before,
			);
			assert.equal(f.requests.length, 0, "maintenance must never construct or dispatch a provider task");
			const host = await f.start({ reopenSessionFile: message.file });
			assert.equal(host.view().sessionId, message.sessionId);
			assert.equal(host.view().phase, "ready");
		} finally {
			if (child && child.exitCode === null && child.signalCode === null) {
				const exit = once(child, "exit");
				child.kill("SIGKILL");
				await exit;
			}
			await f.close();
		}
	},
);

test("an exclusive maintenance gate refuses a new writer before changing stored content", async () => {
	const f = await fixture();
	let gate: string | undefined;
	try {
		let host = await f.start();
		const file = host.view().sessionFile;
		await host.dispose();
		const before = await readFile(file);
		gate = join(dirname(file), "pakka-maintenance.json");
		await writeFile(
			gate,
			JSON.stringify({ schema: "pakka.maintenance.v1", pid: process.pid, nonce: randomUUID() }),
		);
		await assert.rejects(f.start({ reopenSessionFile: file }), /maintenance|locked/i);
		assert.deepEqual(await readFile(file), before);
		await assert.rejects(
			access(join(dirname(file), "pakka-writer.json")),
			(error: NodeJS.ErrnoException) => error.code === "ENOENT",
		);
		await unlink(gate);
		gate = undefined;
		host = await f.start({ reopenSessionFile: file });
		assert.equal(host.view().phase, "ready");
	} finally {
		if (gate) await unlink(gate);
		await f.close();
	}
});
