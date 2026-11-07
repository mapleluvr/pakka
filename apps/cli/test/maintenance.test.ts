import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, access, appendFile, realpath, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
async function setup() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "pakka-offline-cli-"))),
		home = join(root, "home");
	await mkdir(home);
	const env: NodeJS.ProcessEnv = {};
	for (const k of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"])
		if (process.env[k]) env[k] = process.env[k];
	Object.assign(env, {
		PAKKA_HOME: home,
		HOME: home,
		USERPROFILE: home,
		PI_CODING_AGENT_DIR: join(root, "pi"),
		PI_OFFLINE: "1",
		DO_NOT_TRACK: "1",
	});
	const launch = (args: string[]) => {
		const child = spawn(process.execPath, [entry, ...args], {
			env,
			cwd: root,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (v) => (stdout += v));
		child.stderr.on("data", (v) => (stderr += v));
		const timer = setTimeout(
			() => child.kill(),
			["backup", "restore", "upgrade"].includes(args[0]) ? 180000 : 60000,
		);
		const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code) => {
				clearTimeout(timer);
				resolve({ code, stdout, stderr });
			});
		});
		return {
			child,
			done,
			async ready() {
				for (let n = 0; n < 1000; n++) {
					const line = stdout.split("\n").find((v) => v.startsWith("{"));
					if (line) return JSON.parse(line) as { origin: string; sessionFile: string; loginFile?: string };
					if (child.exitCode !== null) throw new Error("Launcher exited before readiness: " + stderr);
					await new Promise((r) => setTimeout(r, 20));
				}
				throw new Error("No launcher readiness: " + stderr);
			},
			async stop() {
				child.stdin.end("stop\n");
				return done;
			},
		};
	};
	const running = launch(["--no-open", "--control-stdin"]);
	const ready = await running.ready();
	const ownerText = await readFile(join(home, "data", "owner-link.txt"), "utf8"),
		oldToken = new URL(ownerText.trim()).hash.slice(8);
	return {
		root,
		home,
		env,
		launch,
		running,
		ready,
		sessionId: dirname(ready.sessionFile).split(/[\\/]/).at(-1)!,
		oldToken,
	};
}
async function childScript(f: Awaited<ReturnType<typeof setup>>, script: string) {
	const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
		cwd: f.root,
		env: f.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (value) => (stdout += value));
	child.stderr.on("data", (value) => (stderr += value));
	const timer = setTimeout(() => child.kill(), 180000);
	const code = await new Promise<number | null>((done, reject) => {
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			done(code);
		});
	});
	return { code, stdout, stderr };
}
test("pakka recover login previews then recovers the original owner through a private file", async () => {
	const f = await setup();
	let app: ReturnType<typeof f.launch> | undefined;
	try {
		await f.running.stop();
		const preview = await f.launch(["recover", "login"]).done;
		assert.equal(preview.code, 0, preview.stderr);
		assert.match(preview.stdout, new RegExp(f.sessionId));
		const recoveryId = randomUUID();
		const issued = await f.launch(["recover", "login", "--confirm", f.sessionId, "--recovery-id", recoveryId])
			.done;
		assert.equal(issued.code, 0, issued.stderr);
		const result = JSON.parse(issued.stdout);
		const credential = JSON.parse(await readFile(result.file, "utf8"));
		assert.equal(credential.recoveryId, recoveryId);
		assert.equal(credential.sessionId, f.sessionId);
		assert.equal(credential.token.length, 43);
		assert.equal((issued.stdout + issued.stderr).includes(credential.token), false);
		const repeated = await f.launch([
			"recover",
			"login",
			"--confirm",
			f.sessionId,
			"--recovery-id",
			recoveryId,
		]).done;
		assert.equal(repeated.code, 0, repeated.stderr);
		assert.equal(JSON.parse(repeated.stdout).expiresAt, result.expiresAt);
		app = f.launch(["--no-open", "--control-stdin", "--login-file", result.file]);
		const ready = await app.ready();
		assert.equal(ready.sessionFile, f.ready.sessionFile);
		assert.ok(ready.loginFile);
		const link = JSON.parse(await readFile(ready.loginFile, "utf8"));
		assert.equal(link.sessionId, f.sessionId);
		assert.equal(link.url, ready.origin + "/#signin=" + credential.token);
		const exchange = (token: string) =>
			fetch(ready.origin + "/pocket/exchange", {
				method: "POST",
				headers: { Origin: ready.origin, "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "session", token }),
			});
		assert.equal((await exchange(f.oldToken)).status, 401);
		assert.equal((await exchange(credential.token)).status, 200);
		assert.equal((await exchange(credential.token)).status, 401);
	} finally {
		await app?.stop();
		await f.running.stop();
	}
});

test("recovery refuses active writer and a foreign confirmation; normal startup preserves originals", async () => {
	const f = await setup();
	try {
		const refused = await f.launch(["recover", "writer", "--confirm", f.sessionId]).done;
		assert.equal(refused.code, 1);
		assert.match(refused.stderr, /alive|active|running|运行|占用/i);
		await f.running.stop();
		const wrong = await f.launch(["recover", "login", "--confirm", randomUUID()]).done;
		assert.equal(wrong.code, 1);
		assert.match(wrong.stderr, /confirm|identity|目标|确认/i);
		await access(f.ready.sessionFile);
	} finally {
		await f.running.stop();
	}
});

test("recovery releases only an exited original writer before the original product reopens", async () => {
	const f = await setup();
	let app: ReturnType<typeof f.launch> | undefined;
	try {
		f.running.child.kill("SIGKILL");
		await f.running.done;
		const claim = await readFile(join(dirname(f.ready.sessionFile), "pakka-writer.json"), "utf8");
		assert.match(claim, /nonce/);
		const preview = await f.launch(["recover", "writer"]).done;
		assert.equal(preview.code, 0, preview.stderr);
		const recovered = await f.launch(["recover", "writer", "--confirm", f.sessionId]).done;
		assert.equal(recovered.code, 0, recovered.stderr);
		app = f.launch(["--recover", "--no-open", "--control-stdin"]);
		assert.equal((await app.ready()).sessionFile, f.ready.sessionFile);
	} finally {
		await app?.stop();
		await f.running.stop();
	}
});

test("a restored execution hold blocks trusted host-module evaluation before configuration loading", async () => {
	const f = await setup();
	try {
		await f.running.stop();
		const marker = join(f.root, "host-code-executed.txt"),
			module = join(f.root, "host.mjs");
		await writeFile(
			join(f.home, "data", "pakka-restored-hold.json"),
			JSON.stringify({ schema: 1, restoreId: randomUUID(), sessionId: f.sessionId, root: 0 }),
		);
		await writeFile(
			module,
			`import {writeFile} from 'node:fs/promises';await writeFile(${JSON.stringify(marker)},'must not execute while held');throw new Error('UNEXPECTED_HOST_EVALUATION');`,
		);
		const refused = await f.launch(["--config-module", module, "--no-open", "--control-stdin"]).done;
		assert.equal(refused.code, 1);
		await assert.rejects(access(marker));
		assert.match(refused.stderr, /MAINTENANCE_REQUIRED/);
	} finally {
		await f.running.stop();
	}
});
async function childSession(f: Awaited<ReturnType<typeof setup>>) {
	const origin = f.ready.origin,
		response = await fetch(origin + "/pocket/exchange", {
			method: "POST",
			headers: { Origin: origin, "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "session", token: f.oldToken }),
		});
	assert.equal(response.status, 200);
	const cookie = response.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; "),
		csrf = /pakka_csrf=([^;]+)/.exec(cookie)?.[1];
	assert.ok(csrf);
	const result = await fetch(origin + "/pocket/rpc", {
		method: "POST",
		headers: { Origin: origin, Cookie: cookie, "X-Pakka-CSRF": csrf, "Content-Type": "application/json" },
		body: JSON.stringify({
			version: 2,
			requestId: randomUUID(),
			command: { op: "session.create", requestId: randomUUID(), name: "Backup child", cwd: f.root },
		}),
	});
	const body = await result.json();
	assert.equal(result.status, 200, JSON.stringify(body));
	return body.result.session.id as string;
}

test("cold backup covers original data, rejects live writers and validates every published file", async () => {
	const f = await setup();
	try {
		const child = await childSession(f),
			out = join(f.root, "backup");
		const busy = await f.launch(["backup", "--out", out, "--confirm", f.sessionId]).done;
		assert.equal(busy.code, 1);
		assert.match(busy.stderr, /writer|locked|alive/i);
		await f.running.stop();
		await writeFile(join(f.home, "data", "artifact.txt"), "original-artifact\n");
		await mkdir(join(f.home, "data", "artifacts"));
		for (const name of ["report-storage.json", "note-wal", "pakka-writer.json"])
			await writeFile(join(f.home, "data", "artifacts", name), "user artifact, not a storage marker\n");
		const result = await f.launch(["backup", "--out", out, "--confirm", f.sessionId]).done;
		assert.equal(result.code, 0, result.stderr);
		const receipt = JSON.parse(result.stdout),
			manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
		assert.equal(receipt.status, "complete");
		assert.equal(manifest.control.sessionId, f.sessionId);
		assert.ok(manifest.domains.some((domain: { sessionId: string }) => domain.sessionId === child));
		for (const name of ["report-storage.json", "note-wal", "pakka-writer.json"])
			assert.equal(
				await readFile(join(out, "roots", "0", "artifacts", name), "utf8"),
				"user artifact, not a storage marker\n",
			);
		assert.equal(await readFile(join(out, "roots", "0", "artifact.txt"), "utf8"), "original-artifact\n");
		await assert.rejects(access(join(out, "roots", "0", "sessions", f.sessionId, "pakka-writer.json")));
		const again = await f.launch(["backup", "--out", out, "--confirm", f.sessionId]).done;
		assert.equal(again.code, 1);
		assert.equal((await f.launch(["backup", "--from", out]).done).code, 0);
		await appendFile(join(out, "roots", "0", "artifact.txt"), "tampered\n");
		const corrupt = await f.launch(["backup", "--from", out]).done;
		assert.equal(corrupt.code, 1);
		assert.match(corrupt.stderr, /digest|hash|integrity|mismatch/i);
	} finally {
		await f.running.stop();
	}
});

test("restore preserves current data first, revokes old access, and stays offline until explicit safe resume", async () => {
	const f = await setup();
	let app: ReturnType<typeof f.launch> | undefined;
	try {
		await f.running.stop();
		const artifact = join(f.home, "data", "artifact.txt");
		await writeFile(artifact, "before-backup\n");
		const out = join(f.root, "restore-backup"),
			backupResult = await f.launch(["backup", "--out", out, "--confirm", f.sessionId]).done;
		assert.equal(backupResult.code, 0, backupResult.stderr);
		const backupId = JSON.parse(backupResult.stdout).id;
		await writeFile(artifact, "after-backup\n");
		const preview = await f.launch(["restore", "--from", out]).done;
		assert.equal(preview.code, 0, preview.stderr);
		assert.equal(await readFile(artifact, "utf8"), "after-backup\n");
		const restored = await f.launch(["restore", "--from", out, "--confirm", f.sessionId]).done;
		assert.equal(restored.code, 0, restored.stderr);
		const result = JSON.parse(restored.stdout);
		assert.equal(result.status, "held");
		assert.equal(await readFile(artifact, "utf8"), "before-backup\n");
		assert.equal(
			await readFile(join(result.preserved, "roots", "0", "artifact.txt"), "utf8"),
			"after-backup\n",
		);
		const blocked = await f.launch(["--no-open", "--control-stdin"]).done;
		assert.equal(blocked.code, 1);
		assert.match(blocked.stderr, /MAINTENANCE_REQUIRED/);
		const recoveryId = randomUUID(),
			recovered = await f.launch(["recover", "login", "--confirm", f.sessionId, "--recovery-id", recoveryId])
				.done;
		assert.equal(recovered.code, 0, recovered.stderr);
		const credential = JSON.parse(await readFile(JSON.parse(recovered.stdout).file, "utf8"));
		const resume = await f.launch(["restore", "--resume", backupId, "--confirm", f.sessionId]).done;
		assert.equal(resume.code, 0, resume.stderr);
		app = f.launch(["--no-open", "--control-stdin"]);
		const ready = await app.ready();
		assert.equal(ready.sessionFile, f.ready.sessionFile);
		const exchange = (token: string) =>
			fetch(ready.origin + "/pocket/exchange", {
				method: "POST",
				headers: { Origin: ready.origin, "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "session", token }),
			});
		assert.equal((await exchange(f.oldToken)).status, 401);
		assert.equal((await exchange(credential.token)).status, 200);
	} finally {
		await app?.stop();
		await f.running.stop();
	}
});

test("upgrade accepts only a pinned local release and rejects archive tampering before data mutation", async () => {
	const f = await setup();
	try {
		await f.running.stop();
		const before = await readFile(f.ready.sessionFile);
		const unfixed = await f.launch(["upgrade", "--to", "latest"]).done;
		assert.equal(unfixed.code, 1);
		assert.match(unfixed.stderr, /explicit|local|release manifest/i);
		const folder = join(f.root, "release");
		await mkdir(folder);
		const packages = [];
		for (const name of ["agent", "mas", "mas-devpack", "protocol", "client", "cli", "server", "webui"]) {
			const file = "pakka-" + name + ".tgz",
				content = "synthetic-rejected-archive-" + name;
			await writeFile(join(folder, file), content);
			packages.push({
				name: "@pakka/" + name,
				version: "0.1.0",
				file,
				sha256: createHash("sha256").update(content).digest("hex"),
				size: Buffer.byteLength(content),
			});
		}
		const release = join(folder, "release.json");
		await writeFile(
			release,
			JSON.stringify({ schema: 1, maintenanceProtocol: 1, version: "0.1.0", nodeMajor: 24, packages }),
		);
		await appendFile(join(folder, "pakka-webui.tgz"), "tampered");
		const changed = await f.launch(["upgrade", "--to", release, "--confirm", f.sessionId]).done;
		assert.equal(changed.code, 1);
		assert.match(changed.stderr, /archive.*(digest|size|hash|integrity).*mismatch/i);
		assert.deepEqual(await readFile(f.ready.sessionFile), before);
		await assert.rejects(access(join(f.home, "active-release.json")));
	} finally {
		await f.running.stop();
	}
});

test("a registered child database must be present before a complete backup is published", async () => {
	const f = await setup();
	try {
		const child = await childSession(f);
		await f.running.stop();
		const original = join(f.home, "data", "sessions", child),
			preserved = join(f.root, "preserved-child");
		await rename(original, preserved);
		const out = join(f.root, "incomplete-backup"),
			result = await f.launch(["backup", "--out", out, "--confirm", f.sessionId]).done;
		assert.equal(result.code, 1);
		assert.match(result.stderr, /registered.*missing|inventory.*incomplete/i);
		await assert.rejects(access(join(out, "manifest.json")));
		await access(join(preserved, "main.sqlite"));
		await access(f.ready.sessionFile);
	} finally {
		await f.running.stop();
	}
});

for (const condition of [
	"corrupted database",
	"missing database",
	"missing data root",
	"corrupted database with an exited writer",
]) {
	test(
		"restore recovers a " + condition + " while preserving original bytes or recording absence",
		async () => {
			const f = await setup();
			try {
				await f.running.stop();
				const out = join(f.root, "known-good");
				const backed = await f.launch(["backup", "--out", out, "--confirm", f.sessionId]).done;
				assert.equal(backed.code, 0, backed.stderr);
				let originalClaim: Buffer | undefined;
				if (condition === "corrupted database with an exited writer") {
					const crashed = f.launch(["--no-open", "--control-stdin"]);
					await crashed.ready();
					const refused = await f.launch(["restore", "--from", out, "--confirm", f.sessionId]).done;
					assert.equal(refused.code, 1);
					assert.match(refused.stderr, /writer|active|running/i);
					originalClaim = await readFile(join(dirname(f.ready.sessionFile), "pakka-writer.json"));
					crashed.child.kill("SIGKILL");
					await crashed.done;
				}
				const damaged = Buffer.from("deliberately damaged local test database");
				if (condition.startsWith("corrupted database")) await writeFile(f.ready.sessionFile, damaged);
				else
					await rename(
						condition === "missing database" ? f.ready.sessionFile : join(f.home, "data"),
						join(f.root, "preserved-unavailable-source"),
					);
				const result = await f.launch(["restore", "--from", out, "--confirm", f.sessionId]).done;
				assert.equal(result.code, 0, result.stderr);
				const restored = JSON.parse(result.stdout);
				assert.equal(restored.status, "held");
				assert.equal(
					(await readFile(f.ready.sessionFile)).subarray(0, 16).toString(),
					"SQLite format 3\u0000",
				);
				const preservation = JSON.parse(
					await readFile(join(restored.preserved, "preservation.json"), "utf8"),
				);
				assert.equal(preservation.kind, "unverified-original-bytes");
				if (originalClaim)
					assert.deepEqual(
						await readFile(
							join(restored.preserved, "roots", "0", "sessions", f.sessionId, "pakka-writer.json"),
						),
						originalClaim,
					);
				if (condition.startsWith("corrupted database"))
					assert.deepEqual(
						await readFile(join(restored.preserved, "roots", "0", "sessions", f.sessionId, "main.sqlite")),
						damaged,
					);
				if (condition === "missing data root") assert.deepEqual(preservation.missingRoots, [0]);
				const blocked = await f.launch(["--no-open", "--control-stdin"]).done;
				assert.equal(blocked.code, 1);
				assert.match(blocked.stderr, /MAINTENANCE_REQUIRED/);
			} finally {
				await f.running.stop();
			}
		},
	);
}

test("interrupted restore publication stays fenced and reconciles the original operation without replacing identity", async () => {
	const f = await setup();
	try {
		await f.running.stop();
		const out = join(f.root, "original-backup");
		const backup = await f.launch(["backup", "--out", out, "--confirm", f.sessionId]).done;
		assert.equal(backup.code, 0, backup.stderr);
		const backupId = JSON.parse(backup.stdout).id,
			data = join(f.home, "data");
		const script = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const original=fs.rename;fs.rename=async(from,to)=>{if(from===${JSON.stringify(data + ".restore." + backupId)}&&to===${JSON.stringify(data)})throw new Error('INJECTED_RESTORE_PUBLISH');return original(from,to);};syncBuiltinESMExports();
const {runMaintenance}=await import(${JSON.stringify(new URL("../../webui/dist/maintenance.js", import.meta.url).href)});process.exitCode=await runMaintenance(${JSON.stringify(["restore", "--from", out, "--confirm", f.sessionId])});`;
		const interrupted = await childScript(f, script);
		assert.equal(interrupted.code, 1, interrupted.stderr);
		assert.match(interrupted.stderr, /INJECTED_RESTORE_PUBLISH/);
		await assert.rejects(access(data));
		await access(data + ".before-restore." + backupId);
		await access(data + ".restore." + backupId);
		const blocked = await f.launch(["--no-open", "--control-stdin"]).done;
		assert.equal(blocked.code, 1);
		assert.match(blocked.stderr, /MAINTENANCE_REQUIRED/);
		const repeated = await f.launch(["restore", "--from", out, "--confirm", f.sessionId]).done;
		assert.equal(repeated.code, 0, repeated.stderr);
		const result = JSON.parse(repeated.stdout);
		assert.equal(result.status, "held");
		assert.equal(result.restoreId, backupId);
		assert.equal(result.sessionId, f.sessionId);
		assert.equal((await readFile(f.ready.sessionFile)).subarray(0, 16).toString(), "SQLite format 3\u0000");
		const original = JSON.parse(await readFile(join(result.preserved, "preservation.json"), "utf8"));
		assert.equal(original.sessionId, f.sessionId);
	} finally {
		await f.running.stop();
	}
});

for (const point of ["credential.json", "receipt.json"]) {
	test(
		"recovery issuance reconciles " + point + " failure using the original private operation",
		async () => {
			const f = await setup();
			let app: ReturnType<typeof f.launch> | undefined;
			try {
				await f.running.stop();
				const id = randomUUID(),
					folder = join(f.home, "maintenance", id),
					file = join(folder, "credential.json");
				const args = ["recover", "login", "--confirm", f.sessionId, "--recovery-id", id];
				const script = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const original=fs.open;fs.open=async(path,...args)=>{if(path===${JSON.stringify(join(folder, point))})throw new Error('INJECTED_ISSUANCE');return original(path,...args);};syncBuiltinESMExports();const {runMaintenance}=await import(${JSON.stringify(new URL("../../webui/dist/maintenance.js", import.meta.url).href)});process.exitCode=await runMaintenance(${JSON.stringify(args)});`;
				const failed = await childScript(f, script);
				assert.equal(failed.code, 1, failed.stderr);
				assert.match(failed.stderr, /INJECTED_ISSUANCE/);
				let prepared: string | undefined;
				if (point === "receipt.json") prepared = await readFile(file, "utf8");
				else await assert.rejects(access(file));
				const repeated = await f.launch(args).done;
				assert.equal(repeated.code, 0, repeated.stderr);
				const issued = JSON.parse(repeated.stdout),
					credential = JSON.parse(await readFile(file, "utf8"));
				assert.equal(issued.recoveryId, id);
				if (prepared) assert.equal(await readFile(file, "utf8"), prepared);
				assert.equal(
					(failed.stdout + failed.stderr + repeated.stdout + repeated.stderr).includes(credential.token),
					false,
				);
				app = f.launch(["--no-open", "--control-stdin", "--login-file", file]);
				const ready = await app.ready();
				const response = await fetch(ready.origin + "/pocket/exchange", {
					method: "POST",
					headers: { Origin: ready.origin, "Content-Type": "application/json" },
					body: JSON.stringify({ kind: "session", token: credential.token }),
				});
				assert.equal(response.status, 200);
				assert.equal(
					(
						await fetch(ready.origin + "/pocket/exchange", {
							method: "POST",
							headers: { Origin: ready.origin, "Content-Type": "application/json" },
							body: JSON.stringify({ kind: "session", token: credential.token }),
						})
					).status,
					401,
				);
			} finally {
				await app?.stop();
				await f.running.stop();
			}
		},
	);
}

test("restored unfinished work requires explicit acknowledgement of its exact durable fingerprint", async () => {
	const f = await setup();
	try {
		await f.running.stop();
		const marker = join(f.root, "original-handler.txt");
		const seed = `import {createLocalProduct} from ${JSON.stringify(new URL("../../webui/dist/product-runtime.js", import.meta.url).href)};import {createRuntime} from ${JSON.stringify(new URL("../../../packages/agent/dist/index.js", import.meta.url).href)};import {writeFile} from 'node:fs/promises';
const product=await createLocalProduct({cwd:${JSON.stringify(f.root)},dataDir:${JSON.stringify(join(f.home, "data"))},agentDir:${JSON.stringify(join(f.root, "pi"))}});let entered;const saved=new Promise(done=>entered=done);const runtime=await createRuntime({...product.runtime,reopenSessionFile:${JSON.stringify(f.ready.sessionFile)},jobs:[{id:'held-backup',version:1,authorize(){},async run(context){await writeFile(${JSON.stringify(marker)},'original effect only');entered();await context.sleep(60000);await context.complete({done:true});}}]});await runtime.jobs({namespace:'held-backup',maxJobs:4,maxBytes:65536}).start({requestId:'original-work',actorId:'operator',target:runtime.view().conversations[0],definition:'held-backup',payload:{}},()=>{});await saved;process.exit(0);`;
		const seeded = await childScript(f, seed);
		assert.equal(seeded.code, 0, seeded.stderr);
		const claim = await f.launch(["recover", "writer", "--confirm", f.sessionId]).done;
		assert.equal(claim.code, 0, claim.stderr);
		const out = join(f.root, "pending-backup"),
			backed = await f.launch(["backup", "--out", out, "--confirm", f.sessionId]).done;
		assert.equal(backed.code, 0, backed.stderr);
		const restored = await f.launch(["restore", "--from", out, "--confirm", f.sessionId]).done;
		assert.equal(restored.code, 0, restored.stderr);
		const id = JSON.parse(restored.stdout).restoreId;
		const refused = await f.launch(["restore", "--resume", id, "--confirm", f.sessionId]).done;
		assert.equal(refused.code, 1);
		assert.match(refused.stderr, /work|review|核对/i);
		const preview = await f.launch(["restore", "--resume", id]).done;
		assert.equal(preview.code, 0, preview.stderr);
		const review = JSON.parse(preview.stdout);
		assert.ok(review.pendingTasks >= 1);
		assert.match(review.reviewWork, /^[0-9a-f]{64}$/);
		const wrong = await f.launch([
			"restore",
			"--resume",
			id,
			"--confirm",
			f.sessionId,
			"--review-work",
			"0".repeat(64),
		]).done;
		assert.equal(wrong.code, 1);
		await access(join(f.home, "data", "pakka-restored-hold.json"));
		const accepted = await f.launch([
			"restore",
			"--resume",
			id,
			"--confirm",
			f.sessionId,
			"--review-work",
			review.reviewWork,
		]).done;
		assert.equal(accepted.code, 0, accepted.stderr);
		assert.equal(JSON.parse(accepted.stdout).status, "resumed");
		const journal = JSON.parse(
			await readFile(join(f.home, "maintenance", "restore-" + id, "operation.json"), "utf8"),
		);
		assert.equal(journal.workReview.fingerprint, review.reviewWork);
		assert.equal(await readFile(marker, "utf8"), "original effect only");
	} finally {
		await f.running.stop();
	}
});
