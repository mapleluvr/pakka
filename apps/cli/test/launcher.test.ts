import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const canary = "launcher-test-private-credential";
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "pakka launcher "));
	const home = join(root, "home");
	let requests = 0;
	const provider = createServer((_request, response) => {
		requests++;
		response.writeHead(500).end("Startup must not request generation");
	});
	await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
	const address = provider.address();
	if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
	const config = join(root, "host config.json");
	const dataDir = join(root, "data");
	const options = {
		runtime: {
			cwd: root,
			dataDir,
			endpoint: `http://127.0.0.1:${address.port}/v1`,
			model: "local-fixture",
			apiKey: canary,
			limits: { maxConversations: 4, maxPrimaryAttempts: 2, maxAuxiliaryAttempts: 2 },
		},
		owner: "Launcher owner",
		initial: [{ name: "Existing conversation", profile: "default" }],
	};
	await writeFile(config, JSON.stringify(options));
	const env: NodeJS.ProcessEnv = {};
	for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"])
		if (process.env[key]) env[key] = process.env[key];
	Object.assign(env, {
		HOME: home,
		USERPROFILE: home,
		PAKKA_HOME: home,
		PI_CODING_AGENT_DIR: home,
		PI_OFFLINE: "1",
		DO_NOT_TRACK: "1",
	});
	return {
		root,
		home,
		config,
		dataDir,
		options,
		env,
		requests: () => requests,
		close: () => new Promise<void>((done) => provider.close(() => done())),
	};
}
function launch(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
	const child = spawn(process.execPath, [entry, ...args], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
	const result = { stdout: "", stderr: "", code: undefined as number | null | undefined, done: false };
	child.stdout.on("data", (chunk) => {
		result.stdout += String(chunk);
	});
	child.stderr.on("data", (chunk) => {
		result.stderr += String(chunk);
	});
	const deadline = setTimeout(() => child.kill(), 20000);
	const exited = new Promise<typeof result>((done, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => {
			clearTimeout(deadline);
			result.code = code;
			result.done = true;
			done(result);
		});
	});
	return {
		result,
		exited,
		async ready(): Promise<{ origin: string; sessionFile: string }> {
			for (let count = 0; count < 1000; count++) {
				const line = result.stdout.split("\n").find((value) => value.startsWith("{"));
				if (line) {
					try {
						const ready = JSON.parse(line);
						if (ready.origin && ready.sessionFile) return ready;
					} catch {
						/* Incomplete stdout chunk. */
					}
				}
				if (result.done) throw new Error(`Launcher exited before ready: ${result.stderr}`);
				await delay(20);
			}
			throw new Error("Launcher ready deadline");
		},
		async stop() {
			if (!result.done) child.stdin.end("stop\n");
			return exited;
		},
	};
}

test("pakka needs no host JSON or selected model to start WebUI and reopen its original workspace", async () => {
	const f = await fixture();
	let child: ReturnType<typeof launch> | undefined;
	try {
		child = launch(["--no-open", "--control-stdin"], f.env, f.root);
		const first = await child.ready();
		assert.equal((await fetch(first.origin)).status, 200);
		const owner = await readFile(join(f.home, "data", "owner-link.txt"), "utf8");
		const token = new URL(owner.trim()).hash.slice("#signin=".length);
		const login = await fetch(first.origin + "/pocket/exchange", {
			method: "POST",
			headers: { Origin: first.origin, "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "session", token }),
		});
		assert.equal(login.status, 200);
		const cookie = login.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		const csrf = /pakka_csrf=([^;]+)/.exec(cookie)![1]!;
		const status = await fetch(first.origin + "/pocket/models/rpc", {
			method: "POST",
			headers: {
				Origin: first.origin,
				Cookie: cookie,
				"X-Pakka-CSRF": csrf,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ version: 2, requestId: "no-model-status", command: { op: "status" } }),
		});
		assert.equal(status.status, 200);
		const value = await status.json();
		assert.equal(value.result.status.defaults.model, undefined);
		assert.equal(value.result.status.sources.models, join(f.home, "models.json"));
		assert.equal((await child.stop()).code, 0);
		const elsewhere = join(f.root, "elsewhere");
		await mkdir(elsewhere);
		child = launch(["--no-open", "--control-stdin"], f.env, elsewhere);
		const second = await child.ready();
		assert.equal(second.sessionFile, first.sessionFile);
		assert.equal(second.origin, first.origin);
		assert.equal((await child.stop()).code, 0);
		assert.equal(await readFile(join(f.home, "data", "owner-link.txt"), "utf8"), owner);
		await assert.rejects(readFile(join(f.home, "config.json")), { code: "ENOENT" });
		assert.equal(f.requests(), 0);
	} finally {
		await child?.stop();
		await f.close();
	}
});

test("pakka help and invalid arguments do not create startup state", async () => {
	const f = await fixture();
	try {
		const help = await launch(["--help"], f.env).exited;
		assert.equal(help.code, 0);
		assert.match(help.stdout, /WebUI/);
		assert.match(help.stdout, /--connection/);
		assert.match(help.stdout, /--no-open/);
		const invalid = await launch(["--unknown"], { ...f.env, PAKKA_CONFIG: f.config }).exited;
		assert.equal(invalid.code, 1);
		assert.match(invalid.stderr, /PAKKA_ARGUMENTS/);
		await assert.rejects(readdir(f.dataDir), { code: "ENOENT" });
		assert.equal(f.requests(), 0);
	} finally {
		await f.close();
	}
});

test("default WebUI serves assets, remembers configuration and reopens exactly the original Session", async () => {
	const f = await fixture();
	let child: ReturnType<typeof launch> | undefined;
	try {
		const original = await readFile(f.config, "utf8");
		child = launch(["--config", f.config, "--no-open", "--control-stdin"], f.env);
		const first = await child.ready();
		const page = await fetch(first.origin);
		assert.equal(page.status, 200);
		assert.ok((await page.text()).includes("<title>pakka-webui</title>"));
		assert.equal((await fetch(`${first.origin}/app.js`)).status, 200);
		const owner = await readFile(join(f.dataDir, "owner-link.txt"), "utf8");
		assert.match(owner, /#signin=/);
		assert.doesNotMatch(
			child.result.stdout + child.result.stderr,
			/#signin=|launcher-test-private-credential/,
		);
		const state = JSON.parse(await readFile(join(f.dataDir, "launcher-state.json"), "utf8"));
		assert.equal(state.sessionFile, first.sessionFile);
		assert.equal(state.phase, "ready");
		const saved = JSON.parse(await readFile(join(f.home, "launch.json"), "utf8"));
		assert.equal(saved.config.path, f.config);
		assert.equal((await child.stop()).code, 0);
		child = launch(["--no-open", "--control-stdin"], f.env);
		const second = await child.ready();
		assert.equal(second.sessionFile, first.sessionFile);
		assert.equal(second.origin, first.origin);
		assert.equal((await child.stop()).code, 0);
		assert.equal((await readdir(join(f.dataDir, "sessions"))).length, 1);
		assert.equal(await readFile(f.config, "utf8"), original);
		assert.equal(f.requests(), 0);
	} finally {
		await child?.stop();
		await f.close();
	}
});

test("a second live launch is refused without creating another Session or replacing state", async () => {
	const f = await fixture();
	const first = launch(["--config", f.config, "--no-open", "--control-stdin"], f.env);
	try {
		await first.ready();
		const stateFile = join(f.dataDir, "launcher-state.json");
		const before = await readFile(stateFile, "utf8");
		const second = await launch(["--no-open", "--control-stdin"], f.env).exited;
		assert.equal(second.code, 1);
		assert.match(second.stderr, /PAKKA_STARTUP_UNCONFIRMED/);
		assert.equal(await readFile(stateFile, "utf8"), before);
		assert.equal((await readdir(join(f.dataDir, "sessions"))).length, 1);
		assert.equal(f.requests(), 0);
	} finally {
		await first.stop();
		await f.close();
	}
});

test("environment and default user configuration are usable without a setup wizard", async () => {
	for (const source of ["environment", "default-home"]) {
		const f = await fixture();
		let child: ReturnType<typeof launch> | undefined;
		try {
			const env = { ...f.env };
			if (source === "environment") env.PAKKA_CONFIG = f.config;
			else {
				await mkdir(f.home);
				await writeFile(join(f.home, "config.json"), JSON.stringify(f.options));
			}
			child = launch(["--no-open", "--control-stdin"], env);
			await child.ready();
			assert.equal((await child.stop()).code, 0);
			assert.equal(f.requests(), 0);
		} finally {
			await child?.stop();
			await f.close();
		}
	}
});

test("trusted module selection is remembered and relative runtime paths follow its directory", async () => {
	const f = await fixture();
	let child: ReturnType<typeof launch> | undefined;
	try {
		const config = join(f.root, "trusted host.mjs");
		await writeFile(
			config,
			`export default ${JSON.stringify({ ...f.options, runtime: { ...f.options.runtime, cwd: ".", dataDir: "data" } })};\n`,
		);
		child = launch(["--config-module", config, "--no-open", "--control-stdin"], f.env);
		const first = await child.ready();
		assert.ok(first.sessionFile.startsWith(f.dataDir));
		assert.equal((await child.stop()).code, 0);
		child = launch(["--no-open", "--control-stdin"], f.env);
		assert.equal((await child.ready()).sessionFile, first.sessionFile);
		assert.equal((await child.stop()).code, 0);
		assert.equal(f.requests(), 0);
	} finally {
		await child?.stop();
		await f.close();
	}
});

test("existing owner file and invalid configuration fail without Session creation or secret output", async () => {
	const f = await fixture();
	try {
		await mkdir(f.dataDir);
		const owner = join(f.dataDir, "owner-link.txt");
		await writeFile(owner, canary);
		const existing = await launch(["--config", f.config, "--no-open"], f.env).exited;
		assert.match(existing.stderr, /PAKKA_OWNER_FILE_EXISTS/);
		assert.equal(await readFile(owner, "utf8"), canary);
		await assert.rejects(readdir(join(f.dataDir, "sessions")), { code: "ENOENT" });
		await writeFile(f.config, canary);
		const invalid = await launch(["--config", f.config, "--no-open"], f.env).exited;
		assert.match(invalid.stderr, /PAKKA_CONFIG_INVALID/);
		assert.ok(!(existing.stderr + invalid.stderr).includes(canary));
		await assert.rejects(readFile(join(f.dataDir, "launcher-state.json")), { code: "ENOENT" });
		assert.equal(f.requests(), 0);
	} finally {
		await f.close();
	}
});

test("missing or unconfirmed startup state requires explicit reopen of the same Session", async () => {
	for (const mode of ["missing", "opening"]) {
		const f = await fixture();
		let child: ReturnType<typeof launch> | undefined;
		try {
			child = launch(["--config", f.config, "--no-open", "--control-stdin"], f.env);
			const first = await child.ready();
			await child.stop();
			const stateFile = join(f.dataDir, "launcher-state.json");
			if (mode === "missing") await unlink(stateFile);
			else {
				const state = JSON.parse(await readFile(stateFile, "utf8"));
				await writeFile(stateFile, JSON.stringify({ ...state, phase: "opening" }));
			}
			const refused = await launch(["--no-open"], f.env).exited;
			assert.equal(refused.code, 1);
			assert.match(refused.stderr, mode === "missing" ? /PAKKA_STATE_MISSING/ : /PAKKA_STARTUP_UNCONFIRMED/);
			assert.equal((await readdir(join(f.dataDir, "sessions"))).length, 1);
			await writeFile(
				f.config,
				JSON.stringify({
					...f.options,
					runtime: { ...f.options.runtime, reopenSessionFile: first.sessionFile },
				}),
			);
			child = launch(["--no-open", "--control-stdin"], f.env);
			assert.equal((await child.ready()).sessionFile, first.sessionFile);
			assert.equal((await child.stop()).code, 0);
			assert.equal((await readdir(join(f.dataDir, "sessions"))).length, 1);
			assert.equal(f.requests(), 0);
		} finally {
			await child?.stop();
			await f.close();
		}
	}
});

test("explicit local recovery never creates a Session when there is no original identity", async () => {
	const f = await fixture();
	try {
		const result = await launch(["--recover", "--no-open", "--control-stdin"], f.env, f.root).exited;
		assert.equal(result.code, 1);
		assert.match(result.stderr, /PAKKA_RECOVERY_IDENTITY_REQUIRED/);
		await assert.rejects(readdir(join(f.home, "data", "sessions")), { code: "ENOENT" });
		assert.equal(f.requests(), 0);
	} finally {
		await f.close();
	}
});

test("explicit local recovery reopens only the recorded original and never clears a writer or replaces missing storage", async () => {
	const f = await fixture();
	let child: ReturnType<typeof launch> | undefined;
	try {
		child = launch(["--no-open", "--control-stdin"], f.env, f.root);
		const first = await child.ready();
		await child.stop();
		const data = join(f.home, "data");
		const stateFile = join(data, "launcher-state.json");
		const ownerFile = join(data, "owner-link.txt");
		const owner = await readFile(ownerFile, "utf8");
		const state = JSON.parse(await readFile(stateFile, "utf8"));
		await writeFile(stateFile, JSON.stringify({ ...state, phase: "opening" }));
		const automatic = await launch(["--no-open"], f.env, f.root).exited;
		assert.equal(automatic.code, 1);
		assert.match(automatic.stderr, /PAKKA_STARTUP_UNCONFIRMED/);
		child = launch(["--recover", "--no-open", "--control-stdin"], f.env, f.root);
		const recovered = await child.ready();
		assert.equal(recovered.sessionFile, first.sessionFile);
		assert.equal(recovered.origin, first.origin);
		assert.equal(await readFile(ownerFile, "utf8"), owner);
		const readyState = await readFile(stateFile, "utf8");
		const busy = await launch(["--recover", "--no-open"], f.env, f.root).exited;
		assert.equal(busy.code, 1);
		assert.match(busy.stderr, /PAKKA_STARTUP_UNCONFIRMED/);
		assert.equal(await readFile(stateFile, "utf8"), readyState);
		assert.equal((await fetch(recovered.origin)).status, 200);
		await child.stop();
		await rename(first.sessionFile, first.sessionFile + ".held");
		const missing = await launch(["--recover", "--no-open"], f.env, f.root).exited;
		assert.equal(missing.code, 1);
		assert.match(missing.stderr, /PAKKA_STARTUP_UNCONFIRMED/);
		await assert.rejects(readFile(first.sessionFile), { code: "ENOENT" });
		assert.equal(await readFile(stateFile, "utf8"), readyState);
		assert.equal((await readdir(join(data, "sessions"))).length, 1);
		assert.equal(await readFile(ownerFile, "utf8"), owner);
		assert.equal(f.requests(), 0);
		await rename(first.sessionFile + ".held", first.sessionFile);
	} finally {
		await child?.stop();
		await f.close();
	}
});

test("corrupt launcher state does not fall back to a fresh Session or echo private content", async () => {
	const f = await fixture();
	const first = launch(["--config", f.config, "--no-open", "--control-stdin"], f.env);
	try {
		await first.ready();
		await first.stop();
		const stateFile = join(f.dataDir, "launcher-state.json");
		await writeFile(stateFile, canary);
		const next = await launch(["--no-open", "--control-stdin"], f.env).exited;
		assert.equal(next.code, 1);
		assert.match(next.stderr, /PAKKA_STATE_INVALID/);
		assert.ok(!(next.stdout + next.stderr).includes(canary));
		assert.equal(await readFile(stateFile, "utf8"), canary);
		assert.equal((await readdir(join(f.dataDir, "sessions"))).length, 1);
		assert.equal(f.requests(), 0);
	} finally {
		await first.stop();
		await f.close();
	}
});
