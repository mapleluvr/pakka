import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const consumer = dirname(fileURLToPath(import.meta.url));
const home = join(consumer, "launcher-home"),
	agentDir = join(consumer, "launcher-agent");
const project = join(consumer, "launcher-project"),
	elsewhere = join(consumer, "launcher-elsewhere");
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
	for (const path of [
		"/",
		"/app.js",
		"/creation.js",
		"/product-model-settings.js",
		"/budget-settings.js",
		"/session-settings.js",
	])
		assert.equal((await fetch(first.origin + path)).status, 200, "installed public asset " + path);
	const ownerFile = join(home, "data", "owner-link.txt");
	const originalOwner = await readFile(ownerFile, "utf8");
	const owner = new URL(originalOwner.trim());
	assert.equal(owner.origin, first.origin);
	assert.ok(owner.hash.startsWith("#signin="));
	const login = await fetch(first.origin + "/pocket/exchange", {
		method: "POST",
		headers: { Origin: first.origin, "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "session", token: owner.hash.slice("#signin=".length) }),
	});
	assert.equal(login.status, 200);
	const cookie = login.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	const csrf = /pakka_csrf=([^;]+)/.exec(cookie)?.[1];
	assert.ok(csrf);
	async function status(origin) {
		const response = await fetch(origin + "/pocket/models/rpc", {
			method: "POST",
			headers: { Origin: origin, Cookie: cookie, "X-Pakka-CSRF": csrf, "Content-Type": "application/json" },
			body: JSON.stringify({ version: 2, requestId: "installed-status", command: { op: "status" } }),
		});
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.result.status.defaults.model, undefined);
		assert.equal(body.result.status.sources.models, join(agentDir, "models.json"));
	}
	await status(first.origin);
	assert.doesNotMatch(child.result.stdout + child.result.stderr, /#signin=/);
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
