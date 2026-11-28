import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";

const consumer = dirname(fileURLToPath(import.meta.url));
const run = join(consumer, "launcher-run-" + crypto.randomUUID());
await mkdir(run);
const home = join(run, "home"),
	agentDir = join(run, "agent");
const project = join(run, "project"),
	elsewhere = join(run, "elsewhere");
await Promise.all([home, agentDir, project, elsewhere].map((path) => mkdir(path)));
const env = {
	...process.env,
	PAKKA_HOME: home,
	PI_CODING_AGENT_DIR: agentDir,
	PATH: join(consumer, "node_modules", ".bin") + delimiter + process.env.PATH,
};
delete env.PAKKA_CONFIG;

function launch(cwd) {
	// Exercise the npm-installed shell shim, not a source path or a direct node dist/main.js invocation.
	const child = spawn(
		process.platform === "win32" ? "pwsh.exe" : "bash",
		process.platform === "win32"
			? ["-NoProfile", "-NonInteractive", "-Command", "pakka --no-open --control-stdin; exit $LASTEXITCODE"]
			: ["--noprofile", "--norc", "-c", "exec pakka --no-open --control-stdin"],
		{ cwd, env, stdio: ["pipe", "pipe", "pipe"] },
	);
	const result = { stdout: "", stderr: "", done: false, code: null, error: undefined };
	child.stdout.on("data", (chunk) => (result.stdout += String(chunk)));
	child.stderr.on("data", (chunk) => (result.stderr += String(chunk)));
	child.on("error", (error) => (result.error = error));
	child.stdin.on("error", () => {}); // A failed startup may close stdin before cleanup writes its stop line.
	child.on("close", (code) => {
		result.code = code;
		result.done = true;
	});
	return {
		result,
		async ready() {
			for (let n = 0; n < 1000; n++) {
				const line = result.stdout.split("\n").find((value) => value.startsWith("{"));
				if (line) {
					let value;
					try {
						value = JSON.parse(line);
					} catch {
						/* incomplete pipe chunk */
					}
					if (value?.origin && value?.sessionFile) {
						const address = new URL(value.origin);
						assert.equal(address.protocol, "http:");
						assert.equal(address.hostname, "127.0.0.1");
						return value;
					}
				}
				if (result.done)
					throw new Error("Installed shell launcher exited before ready: " + result.stderr, {
						cause: result.error,
					});
				await delay(20);
			}
			throw new Error("Installed shell launcher readiness deadline");
		},
		async stop() {
			if (!result.done) child.stdin.end("stop\n");
			for (let n = 0; n < 750 && !result.done; n++) await delay(20);
			if (!result.done) {
				// Only this still-owned shell process and its descendants; never a name-wide process kill.
				if (process.platform === "win32")
					spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
						timeout: 5000,
						stdio: "ignore",
					});
				else child.kill("SIGKILL");
				for (let n = 0; n < 250 && !result.done; n++) await delay(20);
				throw new Error(
					result.done ? "Installed launcher needed forced cleanup" : "Installed launcher cleanup unconfirmed",
				);
			}
			return result;
		},
	};
}

let child;
try {
	child = launch(project);
	const first = await child.ready();
	const frontend = join(consumer, "node_modules/@pakka/webui/dist/frontend");
	const manifest = JSON.parse(await readFile(join(frontend, "asset-manifest.json"), "utf8"));
	for (const asset of manifest.files) {
		const response = await fetch(first.origin + asset.url);
		assert.equal(response.status, 200, "installed public asset " + asset.path);
		const bytes = Buffer.from(await response.arrayBuffer());
		assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
	}
	const ownerFile = join(home, "data", "owner-link.txt");
	const originalOwner = await readFile(ownerFile, "utf8");
	const owner = new URL(originalOwner.trim());
	assert.equal(owner.origin, first.origin);
	assert.ok(owner.hash.startsWith("#session="));
	const client = await loginHttp(first.origin, owner.hash.slice("#session=".length));
	async function status(origin) {
		const current = await connectHttp(origin, client.cookies);
		assert.equal((await current.services({ op: "model-defaults.read" })).defaults.model, null);
		const connections = await current.services({ op: "model-connections.read" });
		assert.equal(connections.configuration.source, "models.json");
		assert.equal(connections.configuration.load, "ready");
		assert.deepEqual(connections.configuration.document, {});
	}
	await status(first.origin);
	assert.ok(!(child.result.stdout + child.result.stderr).includes(owner.hash.slice("#session=".length)));
	assert.equal((await child.stop()).code, 0);
	child = launch(elsewhere);
	const second = await child.ready();
	assert.equal(second.sessionFile, first.sessionFile);
	assert.equal(second.origin, first.origin);
	await status(second.origin);
	assert.equal((await child.stop()).code, 0);
	assert.equal(await readFile(ownerFile, "utf8"), originalOwner);
	assert.equal((await readdir(join(home, "data", "sessions"))).length, 1);
	await assert.rejects(readFile(join(home, "config.json")), { code: "ENOENT" });
	console.log(
		JSON.stringify({
			installedShellLauncher: "passed",
			shell: process.platform === "win32" ? "pwsh" : "bash",
			configRequired: false,
			nativeModelSettings: true,
			sameSessionReopened: true,
		}),
	);
} finally {
	await child?.stop();
}
