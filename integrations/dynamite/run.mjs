import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAccepted, readTestCounts } from "./acceptance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
let pair;
try {
	pair = JSON.parse(readFileSync(join(here, "pairing.json"), "utf8"));
} catch (error) {
	throw new Error("Cannot read the fixed Dynamite pairing manifest", { cause: error });
}
assert.equal(pair.schemaVersion, 1);
assert.match(pair.dynamite.commit, /^[a-f0-9]{40}$/);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run via npm run test:dynamite");
const evidenceRoot = join(root, "artifacts", "dynamite");
mkdirSync(evidenceRoot, { recursive: true });
const evidence = mkdtempSync(join(evidenceRoot, "run-"));
const sandbox = mkdtempSync(join(tmpdir(), "pakka-dynamite-pair-"));
const consumer = join(sandbox, "consumer"),
	stage = join(sandbox, "build");
mkdirSync(consumer);
mkdirSync(stage);
const source = join(evidence, "source");
const env = Object.fromEntries(
	["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"].flatMap((key) =>
		process.env[key] ? [[key, process.env[key]]] : [],
	),
);
Object.assign(env, {
	HOME: sandbox,
	USERPROFILE: sandbox,
	PI_CODING_AGENT_DIR: join(sandbox, "isolated-profile"),
	PI_OFFLINE: "1",
	DO_NOT_TRACK: "1",
	NO_COLOR: "1",
	npm_execpath: npmCli,
	PAKKA_DYNAMITE_EVIDENCE: join(evidence, "cases"),
});
const summary = {
	status: "running",
	node: process.version,
	pairing: pair,
	evidence,
	sandbox,
	consumer,
	commands: [],
	artifacts: [],
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function save() {
	writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
	writeFileSync(
		join(evidenceRoot, "latest.json"),
		JSON.stringify({ evidence, status: summary.status }, null, 2) + "\n",
	);
}
function run(name, command, args, cwd, allowFailure = false) {
	const result = spawnSync(command, args, {
		cwd,
		env,
		encoding: "utf8",
		timeout: 300000,
		maxBuffer: 16 * 1024 * 1024,
	});
	writeFileSync(
		join(evidence, name + ".log"),
		"cwd=" + cwd + "\n" + (result.stdout ?? "") + (result.stderr ?? "") + "\nexit=" + result.status + "\n",
	);
	summary.commands.push({ name, command, args, cwd, exitCode: result.status, signal: result.signal });
	save();
	if (result.error || (result.status !== 0 && !allowFailure))
		throw new Error(
			`${name} failed (${result.status}): ${result.error ?? result.stderr ?? ""}; see ${name}.log`,
		);
	return result;
}
function npm(name, args, cwd) {
	return run(name, process.execPath, [npmCli, ...args], cwd).stdout;
}
function packIdentity(packed, directory) {
	copyFileSync(join(directory, packed.filename), join(evidence, packed.filename));
	return {
		name: packed.name,
		version: packed.version,
		filename: packed.filename,
		sha256: sha256(join(directory, packed.filename)),
		integrity: packed.integrity,
	};
}
try {
	summary.harness = [
		"run.mjs",
		"pairing.json",
		"fixture.mjs",
		"consumer.test.mjs",
		"consumer-types.ts",
		"acceptance.mjs",
		"acceptance.test.mjs",
	].map((file) => ({ file, sha256: sha256(join(here, file)) }));
	save();
	summary.hostCommit = run("host-commit", "git", ["rev-parse", "HEAD"], root).stdout.trim();
	const diff = run(
		"host-diff",
		"git",
		[
			"diff",
			"--binary",
			"HEAD",
			"--",
			"packages",
			"scripts",
			"integrations",
			"package.json",
			"package-lock.json",
		],
		root,
	).stdout;
	summary.hostDiffSha256 = createHash("sha256").update(diff).digest("hex");
	summary.npm = npm("npm-version", ["--version"], root).trim();
	run("gate-regressions", process.execPath, ["--test", join(here, "acceptance.test.mjs")], root);
	const patch = JSON.parse(
		readFileSync(join(root, "patches/pi-durable/1.0.3-pakka.1/artifact.json"), "utf8"),
	);
	assert.equal(patch.patchedVersion, pair.durable.version);
	assert.equal(patch.sha256, pair.durable.sha256);
	summary.patch = patch;
	assert.equal(sha256(join(root, "packages/agent/vendor", patch.filename)), patch.sha256);

	npm("host-build", ["run", "build"], root);
	const hostPack = JSON.parse(
		run("host-pack", process.execPath, [join(root, "scripts/pack-agent.mjs"), consumer], root).stdout,
	)[0];
	assert.equal(hostPack.name, pair.agent.name);
	assert.equal(hostPack.version, pair.agent.version);
	summary.artifacts.push(packIdentity(hostPack, consumer));

	// Authentication for fetching a private repository is managed by git itself;
	// model tests and package commands below use only the isolated profile.
	run("source-clone", "git", ["clone", "--no-checkout", pair.dynamite.repository, source], root);
	run("source-checkout", "git", ["checkout", "--detach", pair.dynamite.commit], source);
	assert.equal(
		run("source-identity", "git", ["rev-parse", "HEAD"], source).stdout.trim(),
		pair.dynamite.commit,
	);
	assert.equal(run("source-clean", "git", ["status", "--porcelain"], source).stdout.trim(), "");
	for (const name of [
		"package.json",
		"index.ts",
		"src",
		"tsconfig.json",
		"tsconfig.build.json",
		"docs",
		"examples",
		"README.md",
	])
		cpSync(join(source, name), join(stage, name), { recursive: true });
	const manifest = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
	assert.equal(manifest.name, pair.dynamite.name);
	assert.equal(manifest.version, pair.dynamite.version);
	assert.equal(manifest.private, true);
	assert.equal(manifest.peerDependencies[pair.agent.name], pair.agent.version);
	// Build copied, unchanged production sources. Do not install the external
	// checkout's old host tarball or oracle dev cohort and do not mutate its lock.
	manifest.devDependencies = {
		[pair.agent.name]: "file:" + join(consumer, hostPack.filename),
		typescript: pair.toolchain.typescript,
		"@types/node": pair.toolchain.nodeTypes,
	};
	writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
	npm(
		"strategy-build-install",
		["install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"],
		stage,
	);
	run(
		"strategy-build",
		process.execPath,
		[join(stage, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
		stage,
	);
	// Only the build profile changes; restore source package metadata before pack.
	copyFileSync(join(source, "package.json"), join(stage, "package.json"));
	const strategyPack = JSON.parse(
		npm("strategy-pack", ["pack", "--json", "--ignore-scripts", "--pack-destination", consumer], stage),
	)[0];
	summary.artifacts.push(packIdentity(strategyPack, consumer));
	assert.ok(
		strategyPack.files.every(
			(file) =>
				!file.path.startsWith("artifacts/") &&
				!file.path.includes("node_modules") &&
				!file.path.endsWith(".tgz"),
		),
	);
	assert.equal(run("source-clean-after-build", "git", ["status", "--porcelain"], source).stdout.trim(), "");

	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify(
			{
				name: "pakka-dynamite-pair-consumer",
				private: true,
				type: "module",
				dependencies: {
					[pair.agent.name]: "file:./" + hostPack.filename,
					[pair.dynamite.name]: "file:./" + strategyPack.filename,
				},
				devDependencies: { typescript: pair.toolchain.typescript, "@types/node": pair.toolchain.nodeTypes },
			},
			null,
			2,
		) + "\n",
	);
	for (const name of ["consumer.test.mjs", "fixture.mjs", "consumer-types.ts"])
		copyFileSync(join(here, name), join(consumer, name));
	copyFileSync(join(root, "scripts/consumer-smoke.mjs"), join(consumer, "host-smoke.mjs"));
	npm(
		"consumer-install",
		["install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"],
		consumer,
	);
	const lock = JSON.parse(readFileSync(join(consumer, "package-lock.json"), "utf8"));
	for (const [name, value] of Object.entries(lock.packages)) {
		assert.equal(value.link, undefined, "Workspace link in consumer: " + name);
		assert.ok(
			!name.includes("pi-coding-agent") && !name.includes("pi-agent-core"),
			"Oracle dependency in consumer: " + name,
		);
		if (value.resolved?.startsWith("file:"))
			assert.ok(!value.resolved.slice(5).includes(".."), "Nonlocal tarball resolution: " + name);
	}
	const tree = npm("dependency-tree", ["ls", "--all", "--json"], consumer);
	writeFileSync(join(consumer, "dependency-tree.json"), tree);
	run(
		"declarations",
		process.execPath,
		[
			join(consumer, "node_modules/typescript/bin/tsc"),
			"--noEmit",
			"--strict",
			"--module",
			"NodeNext",
			"--target",
			"ES2022",
			"consumer-types.ts",
		],
		consumer,
	);
	run("host-smoke", process.execPath, ["host-smoke.mjs"], consumer);
	const tests = run(
		"integration-tests",
		process.execPath,
		["--test", "--test-reporter=tap", "--test-concurrency=1", "--test-timeout=20000", "consumer.test.mjs"],
		consumer,
		true,
	);
	summary.tests = readTestCounts(tests.stdout);
	assert.equal(tests.status, 0, "Installed pair failed behavioral acceptance; see integration-tests.log");
	assertAccepted(summary.tests, 6);
	summary.status = "passed";
} catch (error) {
	summary.status = "blocked";
	summary.reason = String(error);
	process.exitCode = 1;
} finally {
	summary.evidencePath = relative(root, evidence);
	save();
	console.log(JSON.stringify(summary, null, 2));
}
