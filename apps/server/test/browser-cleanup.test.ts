import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, lstat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupBrowserProfile } from "../src/browser-profile-cleanup.ts";

test("browser profile cleanup removes owned files without following a directory junction", async () => {
	const root = await mkdtemp(join(tmpdir(), "pakka-cleanup-test-"));
	try {
		const profile = join(root, "pocket-owned-browser-test"),
			foreign = join(root, "foreign");
		await mkdir(profile);
		await mkdir(foreign);
		await writeFile(join(foreign, "keep.txt"), "KEEP");
		await symlink(foreign, join(profile, "link"), process.platform === "win32" ? "junction" : "dir");
		assert.equal(await cleanupBrowserProfile(profile), "removed");
		await assert.rejects(lstat(profile), { code: "ENOENT" });
		assert.equal(await readFile(join(foreign, "keep.txt"), "utf8"), "KEEP");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test(
	"Windows browser profile cleanup records a held file and finishes without recursive retry cascades",
	{ skip: process.platform !== "win32", timeout: 15000 },
	async () => {
		const root = await mkdtemp(join(tmpdir(), "pakka-cleanup-lock-"));
		const profile = join(root, "pocket-owned-browser-test"),
			held = join(profile, "held.dat");
		await mkdir(profile);
		await writeFile(held, "SYNTHETIC-LOCK");
		const script = join(root, "lock.ps1");
		await writeFile(
			script,
			'$f = [System.IO.File]::Open($env:PAKKA_LOCK_FILE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)\ntry { [Console]::WriteLine("locked"); [Console]::ReadLine() | Out-Null } finally { $f.Dispose() }\n',
		);
		const locker = spawn("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", script], {
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, PAKKA_LOCK_FILE: held },
		});
		const exited = new Promise<void>((resolve) => locker.once("exit", () => resolve()));
		try {
			await new Promise<void>((resolve, reject) => {
				locker.once("error", reject);
				locker.once("exit", () => reject(Error("File locker ended before readiness")));
				locker.stderr.on("data", () => reject(Error("File locker failed")));
				locker.stdout.on("data", (chunk) => {
					if (String(chunk).includes("locked")) resolve();
				});
			});
			const start = performance.now();
			assert.equal(await cleanupBrowserProfile(profile), "retained");
			assert.ok(performance.now() - start < 2000, "held file cleanup must not retry every parent directory");
			const receipt = JSON.parse(await readFile(join(profile, ".pakka-cleanup.json"), "utf8"));
			assert.equal(receipt.state, "retained");
			assert.equal(receipt.browserProcess, "stopped");
			assert.doesNotMatch(JSON.stringify(receipt), /SYNTHETIC-LOCK/);
		} finally {
			locker.stdin.end("\n");
			await exited;
			await rm(root, { recursive: true, force: true });
		}
	},
);
