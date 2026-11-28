import test from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	copyFileSync,
	existsSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const scripts = fileURLToPath(new URL("../", import.meta.url));
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "pakka-runner-test-"));
	mkdirSync(join(root, "scripts"));
	for (const name of ["test.mjs", "test-selection.mjs", "test-monitor.mjs"])
		if (existsSync(join(scripts, name))) copyFileSync(join(scripts, name), join(root, "scripts", name));
	t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
	const file = (path, body) => {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), body);
	};
	file(
		"packages/protocol/test/codec.test.ts",
		`import test from 'node:test';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,basename} from 'node:path';test('isolated',()=>{assert.equal(process.env.USER_SECRET,undefined);assert.equal(process.env.HOME,process.env.USERPROFILE);assert.match(basename(process.env.HOME),/^pakka-test-profile-/);assert.equal(process.env.PI_CODING_AGENT_DIR,process.env.HOME);assert.ok(tmpdir().startsWith(process.env.HOME));writeFileSync(join(process.env.PAKKA_TEST_ARTIFACTS,'environment.json'),JSON.stringify({home:process.env.HOME,temp:tmpdir(),pi:process.env.PI_CODING_AGENT_DIR}));});`,
	);
	file("packages/agent/test/permissions.test.ts", `import test from 'node:test';test('permissions',()=>{});`);
	file(
		"apps/cli/test/maintenance.test.ts",
		`import test from 'node:test';test('unselected failure',()=>{throw Error('HEAVY-RAN');});`,
	);
	const run = (...args) =>
		spawnSync(process.execPath, [join(root, "scripts/test.mjs"), ...args], {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, USER_SECRET: "do not inherit" },
			timeout: 20000,
		});
	return { root, file, run };
}
test("default selects core, explicit files do not append all tests, unknown selections fail closed", (t) => {
	const f = fixture(t);
	const listed = f.run("--list");
	assert.equal(listed.status, 0, listed.stderr);
	const plan = JSON.parse(listed.stdout);
	assert.ok(plan.selected.includes("packages/protocol/test/codec.test.ts"));
	assert.ok(plan.excluded.includes("apps/cli/test/maintenance.test.ts"));
	const only = f.run("--files", "packages/protocol/test/codec.test.ts", "--list");
	assert.equal(only.status, 0, only.stderr);
	assert.deepEqual(JSON.parse(only.stdout).selected, ["packages/protocol/test/codec.test.ts"]);
	for (const args of [
		["--files", "typo.test.ts"],
		["--scope", "typo"],
		["--workers", "20"],
		["--test-concurrency=20"],
		["--suite", "release", "--scope", "maintenance", "--list"],
	])
		assert.notEqual(f.run(...args).status, 0);
	const affected = f.run("--suite", "affected", "--scope", "maintenance", "--list");
	assert.equal(affected.status, 0, affected.stderr);
	assert.ok(JSON.parse(affected.stdout).selected.includes("apps/cli/test/maintenance.test.ts"));
	f.file(
		"packages/protocol/test/new-heavy.test.ts",
		"import test from 'node:test';test('new dependency',()=>{});",
	);
	f.file(
		"packages/agent/test/native-storage.test.ts",
		"import test from 'node:test';test('main storage oracle',()=>{});",
	);
	const history = f.run("--suite", "affected", "--scope", "history", "--list");
	assert.equal(history.status, 0, history.stderr);
	assert.ok(JSON.parse(history.stdout).selected.includes("packages/agent/test/native-storage.test.ts"));
	assert.ok(JSON.parse(history.stdout).heavy.includes("packages/agent/test/native-storage.test.ts"));
	const release = f.run("--suite", "release", "--list");
	assert.ok(JSON.parse(release.stdout).selected.includes("apps/cli/test/maintenance.test.ts"));
	assert.ok(
		JSON.parse(release.stdout).heavy.includes("packages/protocol/test/new-heavy.test.ts"),
		"new tests require a resource review before entering the light pool",
	);
});
test("real selected subprocesses isolate each run, retain old outputs and propagate failure", (t) => {
	const f = fixture(t);
	f.file(
		"artifacts/test-runs/active.json",
		JSON.stringify({ pid: process.pid, run: "owned-by-another-run" }),
	);
	const locked = f.run("--files", "packages/protocol/test/codec.test.ts");
	assert.equal(locked.status, 1);
	assert.equal(
		JSON.parse(readFileSync(join(f.root, "artifacts/test-runs/active.json"), "utf8")).run,
		"owned-by-another-run",
	);
	rmSync(join(f.root, "artifacts/test-runs/active.json"));
	const results = [];
	for (let n = 0; n < 2; n++) {
		const r = f.run("--files", "packages/protocol/test/codec.test.ts");
		const folder = r.stdout.match(/run=(.+)/)?.[1].trim();
		assert.ok(folder);
		const output = readFileSync(join(folder, "workers", "0001", "output.tap"), "utf8");
		assert.equal(r.status, 0, r.stdout + r.stderr + output);
		const summary = JSON.parse(readFileSync(join(folder, "summary.json"), "utf8"));
		assert.equal(summary.status, "passed");
		assert.equal(summary.files.length, 1);
		assert.equal(summary.files[0].code, 0);
		assert.equal(summary.files[0].signal, null);
		assert.ok(summary.minFreeBytes > 0);
		const worker = join(folder, "workers", "0001");
		const env = JSON.parse(readFileSync(join(worker, "artifacts", "environment.json"), "utf8"));
		assert.ok(env.home.startsWith(folder));
		assert.ok(readdirSync(join(worker, "metrics")).length);
		results.push({ folder, env });
	}
	assert.notEqual(results[0].env.home, results[1].env.home);
	assert.ok(existsSync(join(results[0].folder, "summary.json")));
	const empty = f.run(
		"--files",
		"packages/protocol/test/codec.test.ts",
		"--test-name-pattern=does-not-match",
	);
	const emptyFolder = empty.stdout.match(/run=(.+)/)?.[1].trim();
	assert.equal(empty.status, 1, readFileSync(join(emptyFolder, "workers", "0001", "output.tap"), "utf8"));
	const failed = f.run("--files", "apps/cli/test/maintenance.test.ts");
	assert.equal(failed.status, 1);
	const folder = failed.stdout.match(/run=(.+)/)?.[1].trim();
	const summary = JSON.parse(readFileSync(join(folder, "summary.json"), "utf8"));
	assert.equal(summary.status, "failed");
	assert.equal(summary.files[0].code, 1);
	assert.match(readFileSync(join(folder, "workers", "0001", "output.tap"), "utf8"), /HEAVY-RAN/);
});
