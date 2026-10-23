import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = process.argv[3] ?? "1.0.3-pakka.1";
if (!/^\d+\.\d+\.\d+-pakka\.\d+$/.test(version)) throw new Error("Invalid patch version");
const patchDir = join(root, "patches", "pi-durable", version);
const baseline = parseJson(
	readFileSync(join(patchDir, "baseline.json"), "utf8"),
	join(patchDir, "baseline.json"),
);
const upstream = process.argv[2];
if (!upstream) throw new Error("Usage: npm run build:durable-patch -- <upstream-checkout> [patched-version]");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run with npm run build:durable-patch");
const stage = mkdtempSync(join(tmpdir(), "pakka-durable-build-"));
function run(command, args, cwd = stage) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
	if (result.stdout && !args.includes("--json")) console.log(result.stdout.trimEnd());
	return result.stdout.trim();
}
function parseJson(source, label) {
	try {
		return JSON.parse(source);
	} catch (cause) {
		throw new Error(`Invalid JSON in ${label}`, { cause });
	}
}
const revision = run("git", ["rev-parse", "HEAD"], resolve(upstream));
if (revision !== baseline.upstreamCommit) throw new Error("Upstream commit differs from patch baseline");
const archive = join(stage, "upstream.tar");
run(
	"git",
	["archive", "--format=tar", "--output=" + archive, revision, "packages/durable", "tsconfig.base.json"],
	resolve(upstream),
);
run("tar", ["-xf", archive]);
// Apply to an isolated copy of the exact commit; never touch upstream or an installed dependency.
run("git", ["init", "--quiet"]);
run("git", ["apply", "--check", join(patchDir, "source.patch")]);
run("git", ["apply", join(patchDir, "source.patch")]);
const durableDir = join(stage, "packages", "durable");
const packagePath = join(durableDir, "package.json");
const pkg = parseJson(readFileSync(packagePath, "utf8"), packagePath);
if (pkg.version !== baseline.upstreamVersion) throw new Error("Unexpected source package version");
pkg.version = baseline.patchedVersion;
pkg.dependencies["@earendil-works/pi-ai"] = baseline.upstreamVersion;
pkg.dependencies["@earendil-works/chord"] = baseline.upstreamVersion;
writeFileSync(packagePath, JSON.stringify(pkg, null, "\t") + "\n");
const tsconfigPath = join(durableDir, "tsconfig.build.json");
const tsconfigSource = readFileSync(tsconfigPath, "utf8");
const overrides = {
	"@earendil-works/pi-ai": baseline.upstreamVersion,
	"@earendil-works/chord": baseline.upstreamVersion,
	"@earendil-works/pi-telemetry": baseline.upstreamVersion,
};
if (pkg.dependencies["@earendil-works/pi-codemode"])
	overrides["@earendil-works/pi-codemode"] = baseline.upstreamVersion;
writeFileSync(
	join(stage, "package.json"),
	JSON.stringify(
		{
			name: "pakka-durable-patch-build",
			private: true,
			workspaces: ["packages/durable"],
			devDependencies: { typescript: "7.0.2", "@types/node": "26.6.4", ...baseline.buildDevDependencies },
			overrides,
		},
		null,
		"\t",
	) + "\n",
);
cpSync(join(patchDir, "build-lock.json"), join(stage, "package-lock.json"));
run(process.execPath, [npmCli, "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
let tsconfig;
if (baseline.buildDevDependencies?.["jsonc-parser"]) {
	const { parse } = createRequire(join(stage, "package.json"))("jsonc-parser");
	const errors = [];
	tsconfig = parse(tsconfigSource, errors, { allowTrailingComma: true });
	if (errors.length !== 0) throw new Error("Invalid upstream TypeScript build configuration");
} else {
	tsconfig = parseJson(tsconfigSource, tsconfigPath);
}
delete tsconfig.compilerOptions.paths;
writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, "\t") + "\n");
run(process.execPath, [
	join(stage, "node_modules", "typescript", "bin", "tsc"),
	"-p",
	join(durableDir, "tsconfig.build.json"),
]);
run(
	process.execPath,
	[
		join(stage, "node_modules", "vitest", "vitest.mjs"),
		"run",
		...(baseline.testFiles ?? [
			"test/harness-generation.test.ts",
			"test/harness-generation-recovery.test.ts",
			"test/harness-inbox.test.ts",
			"test/harness-tools.test.ts",
		]),
	],
	durableDir,
);
const vendor = join(root, "packages", "agent", "vendor");
mkdirSync(vendor, { recursive: true });
const packed = run(
	process.execPath,
	[npmCli, "pack", "--json", "--ignore-scripts", "--pack-destination", stage],
	durableDir,
);
const [{ filename }] = parseJson(packed, "npm pack output");
if (baseline.consumerTestFiles?.length) {
	// A separate install root: no workspace alias, source condition, or root overrides.
	const consumer = mkdtempSync(join(tmpdir(), "pakka-durable-consumer-"));
	const vitestVersion = parseJson(
		readFileSync(join(stage, "node_modules", "vitest", "package.json"), "utf8"),
		"build Vitest package",
	).version;
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify(
			{
				name: "pakka-durable-patch-consumer",
				private: true,
				type: "module",
				dependencies: {
					"@earendil-works/pi-durable": "file:" + join(stage, filename).replaceAll("\\", "/"),
					"@earendil-works/pi-ai": baseline.upstreamVersion,
					"@earendil-works/chord": baseline.upstreamVersion,
				},
				devDependencies: { vitest: vitestVersion },
			},
			null,
			"\t",
		) + "\n",
	);
	writeFileSync(
		join(consumer, "vitest.config.mjs"),
		'export default { test: { include: ["*.test.ts"] }, resolve: { conditions: ["node"] } };\n',
	);
	for (const test of baseline.consumerTestFiles)
		cpSync(join(durableDir, test), join(consumer, basename(test)));
	run(process.execPath, [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
	const installed = parseJson(
		readFileSync(join(consumer, "node_modules", "@earendil-works", "pi-durable", "package.json"), "utf8"),
		"installed Durable package",
	);
	if (installed.version !== baseline.patchedVersion)
		throw new Error("Installed Durable version differs from artifact");
	run(
		process.execPath,
		[join(consumer, "node_modules", "vitest", "vitest.mjs"), "run", "--reporter=verbose"],
		consumer,
	);
	console.log(JSON.stringify({ consumer, installedVersion: installed.version }));
}
const destination = join(vendor, filename);
cpSync(join(stage, filename), destination);
const sha256 = createHash("sha256").update(readFileSync(destination)).digest("hex");
writeFileSync(
	join(patchDir, "artifact.json"),
	JSON.stringify(
		{
			filename,
			sha256,
			upstreamCommit: revision,
			upstreamVersion: baseline.upstreamVersion,
			patchedVersion: baseline.patchedVersion,
			sourcePatchSha256: createHash("sha256")
				.update(readFileSync(join(patchDir, "source.patch")))
				.digest("hex"),
			buildLockSha256: createHash("sha256")
				.update(readFileSync(join(patchDir, "build-lock.json")))
				.digest("hex"),
		},
		null,
		"\t",
	) + "\n",
);
console.log(JSON.stringify({ stage, destination, sha256 }));
