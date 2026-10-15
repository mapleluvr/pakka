import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pairing = json(readFileSync(join(root, "integrations/dynamite/core-m6-pairing.json"), "utf8"));
const artifacts = join(root, "artifacts/dynamite/product-pairing");
mkdirSync(artifacts, { recursive: true });
const runDir = mkdtempSync(join(artifacts, "run-"));
const consumer = mkdtempSync(join(tmpdir(), "pakka-dynamite-product-"));
const npm = process.env.npm_execpath;
assert.ok(npm && existsSync(npm), "Launch using npm run test:dynamite:product -- <agent.tgz> <dynamite.tgz>");
const summary = {
	schema: "pakka.dynamite.product-evidence.v1",
	status: "running",
	runDir,
	consumer,
	pairing,
	tarballs: [],
	commands: [],
};
function json(text) {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error("Invalid product acceptance JSON");
	}
}
function sha(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function run(name, args, cwd = consumer, timeout = 300000) {
	const env = Object.fromEntries(
		["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"].flatMap((key) =>
			process.env[key] ? [[key, process.env[key]]] : [],
		),
	);
	Object.assign(env, {
		HOME: consumer,
		USERPROFILE: consumer,
		PI_CODING_AGENT_DIR: join(consumer, "isolated-profile"),
		PI_OFFLINE: "1",
		DO_NOT_TRACK: "1",
		NPM_CONFIG_USERCONFIG: join(consumer, ".npmrc"),
		NPM_CONFIG_CACHE: join(artifacts, "npm-cache"),
		NPM_CONFIG_AUDIT: "false",
		NPM_CONFIG_FUND: "false",
	});
	const result = spawnSync(process.execPath, args, {
		cwd,
		env,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		timeout,
	});
	writeFileSync(join(runDir, name + ".log"), (result.stdout ?? "") + (result.stderr ?? ""));
	summary.commands.push({
		name,
		code: result.status,
		signal: result.signal,
		error: result.error?.message ?? null,
	});
	if (result.error || result.status !== 0) throw new Error("Product acceptance command failed: " + name);
	return result.stdout;
}
function archive(path, expected) {
	const input = resolve(path);
	assert.equal(sha(input), expected.tarballSha256, expected.name + " archive changed");
	const target = join(runDir, expected.name.split("/").at(-1) + "-" + expected.version + ".tgz");
	copyFileSync(input, target);
	summary.tarballs.push({
		name: expected.name,
		version: expected.version,
		sha256: sha(target),
		path: target,
	});
	return target;
}
function save() {
	writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
}
writeFileSync(
	join(consumer, ".npmrc"),
	"registry=https://registry.npmjs.org/\nignore-scripts=true\naudit=false\nfund=false\n",
);
save();
try {
	assert.equal(process.argv.length, 4, "Provide the exact accepted M6 agent and external Dynamite archives");
	const agent = archive(process.argv[2], pairing.host),
		dynamite = archive(process.argv[3], pairing.dynamite);
	const dependencies = { "@pakka/agent": "file:" + agent };
	for (const folder of [
		"packages/protocol",
		"packages/mas",
		"packages/mas-devpack",
		"packages/client",
		"apps/server",
		"apps/cli",
	]) {
		const manifest = json(readFileSync(join(root, folder, "package.json"), "utf8"));
		const packed = json(
			run(
				"pack-" + manifest.name.split("/").at(-1),
				[npm, "pack", "--ignore-scripts", "--json", "--pack-destination", runDir],
				join(root, folder),
			),
		);
		assert.equal(packed.length, 1);
		const path = join(runDir, packed[0].filename);
		dependencies[manifest.name] = "file:" + path;
		summary.tarballs.push({ name: manifest.name, version: manifest.version, sha256: sha(path), path });
	}
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify(
			{
				name: "pakka-dynamite-product-consumer",
				version: "0.0.0",
				private: true,
				type: "module",
				dependencies,
			},
			null,
			2,
		),
	);
	for (const name of [
		"consumer-dynamite-missing.mjs",
		"consumer-dynamite-product.test.mjs",
		"consumer-apps.mjs",
	])
		copyFileSync(join(root, "scripts", name), join(consumer, name));
	run("install-no-peer", [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund"]);
	assert.ok(
		!existsSync(join(consumer, "node_modules/@pakka/dynamite")),
		"An optional peer must not be implicitly installed",
	);
	run("missing-peer", [join(consumer, "consumer-dynamite-missing.mjs")]);
	summary.missingPeer = json(readFileSync(join(consumer, "missing-peer-evidence.json"), "utf8"));
	assert.equal(summary.missingPeer.storageCreatedOnRefusal, false);
	run("native-apps-without-peer", [join(consumer, "consumer-apps.mjs")]);
	run("install-accepted-peer", [
		npm,
		"install",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		"--save-exact",
		dynamite,
	]);
	for (const [name, version] of [
		["@pakka/agent", pairing.host.version],
		["@pakka/dynamite", pairing.dynamite.version],
	]) {
		const folder = join(consumer, "node_modules", ...name.split("/"));
		assert.ok(
			realpathSync(folder).startsWith(realpathSync(consumer)),
			"No workspace/sibling package shortcut",
		);
		assert.equal(json(readFileSync(join(folder, "package.json"), "utf8")).version, version);
	}
	const tree = json(run("dependency-tree", [npm, "ls", "--all", "--json"]));
	const names = new Set();
	function inventory(node) {
		for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
			names.add(name);
			inventory(dependency);
		}
	}
	inventory(tree);
	for (const name of [
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-tui",
		"@earendil-works/pi-codemode",
		"@earendil-works/pi-mcp",
	])
		assert.ok(!names.has(name), "Legacy oracle in product: " + name);
	const tap = run(
		"product",
		[
			"--test",
			"--test-concurrency=1",
			"--test-reporter=tap",
			join(consumer, "consumer-dynamite-product.test.mjs"),
		],
		consumer,
		360000,
	);
	const counts = Object.fromEntries(
		["tests", "pass", "fail", "skipped", "cancelled", "todo"].map((key) => {
			const matches = [...tap.matchAll(new RegExp("^# " + key + " (\\d+)$", "gm"))];
			assert.equal(matches.length, 1, "Missing/duplicate TAP count " + key);
			return [key, Number(matches[0][1])];
		}),
	);
	assert.equal(counts.tests, 5);
	assert.equal(counts.pass, 5);
	for (const key of ["fail", "skipped", "cancelled", "todo"]) assert.equal(counts[key], 0);
	const cases = json(readFileSync(join(consumer, "dynamite-product-evidence.json"), "utf8"));
	assert.deepEqual(cases.map((item) => item.name).sort(), [
		"compression-128",
		"compression-64",
		"executable",
		"scope-revoke",
		"unknown-inference",
	]);
	for (const item of cases) assert.equal(item.providerErrors, 0);
	summary.tests = counts;
	summary.cases = cases;
	summary.status = "passed";
	console.log(JSON.stringify({ runDir, consumer, tests: counts, cases }, null, 2));
} catch (error) {
	summary.status = "blocked";
	summary.error = String(error);
	throw error;
} finally {
	for (const name of [
		"package.json",
		"package-lock.json",
		"dynamite-product-evidence.json",
		"missing-peer-evidence.json",
	])
		if (existsSync(join(consumer, name))) copyFileSync(join(consumer, name), join(runDir, name));
	if (existsSync(join(consumer, "dynamite-product-evidence")))
		cpSync(join(consumer, "dynamite-product-evidence"), join(runDir, "installed-evidence"), {
			recursive: true,
		});
	save();
	console.log("Product pairing receipt: " + join(runDir, "summary.json"));
}
