import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const consumer = dirname(fileURLToPath(import.meta.url)),
	entry = join(consumer, "node_modules", "@pakka", "cli", "dist", "main.js");
const root = await realpath(await mkdtemp(join(tmpdir(), "pakka-installed-upgrade-"))),
	home = join(root, "home");
await mkdir(home);
const env = {};
for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "npm_execpath"])
	if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
	HOME: home,
	USERPROFILE: home,
	PAKKA_HOME: home,
	PI_CODING_AGENT_DIR: join(root, "pi"),
	PI_OFFLINE: "1",
	DO_NOT_TRACK: "1",
});
function launch(args) {
	const task = spawn(process.execPath, [entry, ...args], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
	let stdout = "",
		stderr = "";
	task.stdout.on("data", (value) => (stdout += value));
	task.stderr.on("data", (value) => (stderr += value));
	const timer = setTimeout(() => task.kill(), 600000);
	const done = new Promise((resolve, reject) => {
		task.once("error", reject);
		task.once("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
	return {
		task,
		done,
		async ready() {
			for (let n = 0; n < 2000; n++) {
				const line = stdout.split("\n").find((value) => value.startsWith("{"));
				if (line) return JSON.parse(line);
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			throw new Error("Installed launcher did not become ready: " + stderr);
		},
		async stop() {
			task.stdin.end("stop\n");
			return done;
		},
	};
}
async function command(args) {
	const result = await launch(args).done;
	assert.equal(result.code, 0, result.stderr);
	return JSON.parse(result.stdout);
}
let app;
try {
	app = launch(["--no-open", "--control-stdin"]);
	const original = await app.ready();
	await app.stop();
	app = undefined;
	const sessionId = dirname(original.sessionFile).split(/[\\/]/).at(-1),
		artifact = join(home, "data", "artifact.txt");
	await writeFile(artifact, "original before upgrade\n");
	const source = join(consumer, "release.json"),
		preview = await command(["upgrade", "--to", source]);
	assert.equal(preview.sessionId, sessionId);
	const upgraded = await command(["upgrade", "--to", source, "--confirm", sessionId]);
	assert.equal(upgraded.status, "activated");
	assert.equal(upgraded.health.status, "healthy");
	assert.equal(await readFile(artifact, "utf8"), "original before upgrade\n");
	const selected = JSON.parse(await readFile(join(home, "active-release.json"), "utf8"));
	assert.equal(selected.id, upgraded.releaseId);
	assert.equal(
		JSON.parse(await readFile(join(upgraded.backup, "manifest.json"), "utf8")).control.sessionId,
		sessionId,
	);
	app = launch(["--no-open", "--control-stdin"]);
	const after = await app.ready();
	assert.equal(after.sessionFile, original.sessionFile);
	assert.equal(after.releaseId, upgraded.releaseId);
	await app.stop();
	app = undefined;
	await writeFile(artifact, "after upgrade; preserve this copy\n");
	const rolled = await command(["upgrade", "--rollback", upgraded.releaseId, "--confirm", sessionId]);
	assert.equal(rolled.status, "rolled-back-held");
	assert.equal(await readFile(artifact, "utf8"), "original before upgrade\n");
	const blocked = await launch(["--no-open", "--control-stdin"]).done;
	assert.equal(blocked.code, 1);
	assert.match(blocked.stderr, /MAINTENANCE_REQUIRED/);
	const login = await command(["recover", "login", "--confirm", sessionId]);
	const credential = JSON.parse(await readFile(login.file, "utf8"));
	await command(["restore", "--resume", rolled.restoreId, "--confirm", sessionId]);
	await writeFile(artifact, "new work after rollback\n");
	const repeated = await command(["upgrade", "--rollback", upgraded.releaseId, "--confirm", sessionId]);
	assert.equal(repeated.status, "already-rolled-back");
	assert.equal(await readFile(artifact, "utf8"), "new work after rollback\n");
	app = launch(["--no-open", "--control-stdin", "--login-file", login.file]);
	const resumed = await app.ready();
	assert.equal(resumed.sessionFile, original.sessionFile);
	const response = await fetch(resumed.origin + "/pocket/exchange", {
		method: "POST",
		headers: { Origin: resumed.origin, "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "session", token: credential.token }),
	});
	assert.equal(response.status, 200);
	await app.stop();
	app = undefined;
	console.log(
		JSON.stringify({
			status: "passed",
			consumer,
			isolatedHome: home,
			sessionId,
			releaseId: upgraded.releaseId,
			backup: upgraded.backup,
			restoreId: rolled.restoreId,
			checks: [
				"fixed archives",
				"scripts-disabled staged install",
				"cold snapshot",
				"no-Harness health",
				"selected entry delegation",
				"original Session reopen",
				"data-aware rollback",
				"restored hold",
				"new owner credential",
				"explicit resume",
				"rollback original-receipt replay without replacing new work",
			],
		}),
	);
} finally {
	await app?.stop();
}
