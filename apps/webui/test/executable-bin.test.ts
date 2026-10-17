import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { readFile, writeFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));
test(
	"Pocket executable starts through the symlinked npm bin path without exposing the owner token",
	{ timeout: 20000 },
	async () => {
		const fixture = await runtimeFixture();
		await fixture.runtime.close();
		const bin = join(fixture.f.root, "installed-bin"),
			config = join(fixture.f.root, "product.json"),
			owner = join(fixture.f.root, "owner.txt");
		// Windows npm uses a command shim. A directory junction exercises canonical entry
		// resolution there without requiring administrator-only file-symlink privileges.
		let executable: string;
		if (process.platform === "win32") {
			await symlink(dirname(main), bin, "junction");
			executable = join(bin, "main.js");
		} else {
			executable = bin;
			await symlink(main, executable, "file");
		}
		await writeFile(
			config,
			JSON.stringify({
				runtime: fixture.config,
				owner: "Isolated bin owner",
				initial: [{ name: "Bin launched", profile: "default" }],
			}),
		);
		const child = spawn(
			process.execPath,
			[executable, "--config", config, "--owner-file", owner, "--control-stdin"],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (bytes) => {
			stdout += String(bytes);
		});
		child.stderr.on("data", (bytes) => {
			stderr += String(bytes);
		});
		const exited = new Promise<number | null>((resolve, reject) => {
			child.once("exit", resolve);
			child.once("error", reject);
		});
		try {
			const deadline = Date.now() + 10000;
			while (!stdout.includes("\n") && child.exitCode === null && Date.now() < deadline)
				await new Promise((resolve) => setTimeout(resolve, 25));
			assert.ok(
				stdout.includes("\n"),
				`Linked executable exited ${child.exitCode} without a listener: ${stderr}`,
			);
			const info = JSON.parse(stdout.split("\n")[0]!);
			assert.equal(new URL(info.origin).hostname, "127.0.0.1");
			assert.equal((await fetch(info.origin)).status, 200);
			const link = new URL((await readFile(owner, "utf8")).trim()),
				token = new URLSearchParams(link.hash.slice(1)).get("signin");
			assert.equal(link.origin, info.origin);
			assert.ok(token);
			assert.equal(stdout.includes(token), false);
			assert.equal(stderr.includes(token), false);
			assert.equal(fixture.f.requests.length, 0);
			child.stdin.end("stop\n");
			assert.equal(await exited, 0, stderr);
			assert.deepEqual(fixture.f.errors, []);
		} finally {
			child.kill();
			await exited;
			await fixture.f.close();
		}
	},
);

test("Importing the Pocket executable does not start it", async () => {
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`await import(${JSON.stringify(new URL("../dist/main.js", import.meta.url).href)})`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let output = "";
	child.stdout.on("data", (bytes) => {
		output += String(bytes);
	});
	child.stderr.on("data", (bytes) => {
		output += String(bytes);
	});
	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	assert.equal(code, 0, output);
	assert.equal(output, "");
});
