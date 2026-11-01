import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const production = "1.4.0-pakka.1";
const historical = "1.0.3-pakka.1";
const hash = (data) => createHash("sha256").update(data).digest("hex");

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "pakka-patch-selection-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const directory of ["scripts", "packages/agent/vendor", "tmp", "upstream"])
		mkdirSync(join(root, directory), { recursive: true });
	for (const file of ["build-durable-patch.mjs", "verify-durable-patch.mjs", "durable-patch-version.mjs"])
		if (existsSync(join(source, "scripts", file)))
			cpSync(join(source, "scripts", file), join(root, "scripts", file));
	const manifest = join(root, "packages/agent/package.json");
	writeFileSync(
		manifest,
		JSON.stringify({
			dependencies: {
				"@earendil-works/pi-durable": "file:vendor/earendil-works-pi-durable-1.4.0-pakka.1.tgz",
			},
		}),
	);
	for (const version of [production, historical]) {
		const directory = join(root, "patches/pi-durable", version);
		mkdirSync(directory, { recursive: true });
		const archive = `archive for ${version}`;
		const filename = `earendil-works-pi-durable-${version}.tgz`;
		writeFileSync(join(root, "packages/agent/vendor", filename), archive);
		writeFileSync(join(directory, "source.patch"), "source");
		writeFileSync(join(directory, "build-lock.json"), "{}");
		writeFileSync(
			join(directory, "artifact.json"),
			JSON.stringify({
				filename,
				patchedVersion: version,
				sha256: hash(archive),
				sourcePatchSha256: hash("source"),
				buildLockSha256: hash("{}"),
			}),
		);
	}
	function run(script, args = [], extra = {}) {
		return spawnSync(process.execPath, [join(root, "scripts", script), ...args], {
			cwd: join(root, "upstream"),
			encoding: "utf8",
			timeout: 15_000,
			env: {
				...process.env,
				TEMP: join(root, "tmp"),
				TMP: join(root, "tmp"),
				TMPDIR: join(root, "tmp"),
				...extra,
			},
		});
	}
	return { root, manifest, run };
}

test("default verification checks the production archive from outside repository cwd", (t) => {
	const f = fixture(t);
	const result = f.run("verify-durable-patch.mjs");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Verified pi-durable 1\.4\.0-pakka\.1 /);
});

test("an explicit historical version selects its own fixed artifact", (t) => {
	const f = fixture(t);
	const result = f.run("verify-durable-patch.mjs", [historical]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Verified pi-durable 1\.0\.3-pakka\.1 /);
});

test("default verification refuses corruption of the production archive", (t) => {
	const f = fixture(t);
	writeFileSync(
		join(f.root, "packages/agent/vendor/earendil-works-pi-durable-1.4.0-pakka.1.tgz"),
		"tampered",
	);
	const result = f.run("verify-durable-patch.mjs");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /patch hash mismatch/);
});

test("an ambiguous production dependency fails closed while explicit selection remains usable", (t) => {
	const f = fixture(t);
	writeFileSync(f.manifest, JSON.stringify({ dependencies: { "@earendil-works/pi-durable": "^1.4.0" } }));
	const result = f.run("verify-durable-patch.mjs");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /exact vendored Durable dependency/);
	assert.equal(f.run("verify-durable-patch.mjs", [historical]).status, 0);
});

test("default build selects the production baseline before rejecting an incomplete source checkout", (t) => {
	const f = fixture(t);
	const upstream = join(f.root, "upstream");
	function git(args) {
		const result = spawnSync("git", args, { cwd: upstream, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	}
	git(["init", "--quiet"]);
	git([
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--allow-empty",
		"--quiet",
		"-m",
		"fixture",
	]);
	const revision = git(["rev-parse", "HEAD"]);
	for (const version of [production, historical])
		writeFileSync(
			join(f.root, "patches/pi-durable", version, "baseline.json"),
			JSON.stringify({
				upstreamCommit: version === production ? revision : "0".repeat(40),
			}),
		);
	const result = f.run("build-durable-patch.mjs", [upstream], {
		npm_execpath: join(f.root, "unreachable-npm.cjs"),
	});
	assert.notEqual(result.status, 0);
	assert.doesNotMatch(result.stderr, /Upstream commit differs from patch baseline/);
	assert.match(result.stderr, /pathspec 'packages\/durable'/);
});
