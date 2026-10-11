import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const patchDir = join(root, "patches", "pi-durable", "1.0.3-pakka.1");
const baseline = JSON.parse(readFileSync(join(patchDir, "baseline.json"), "utf8"));
const upstream = process.argv[2];
if (!upstream) throw new Error("Usage: npm run build:durable-patch -- <upstream-v1.0.3-checkout>");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run with npm run build:durable-patch");
const stage = mkdtempSync(join(tmpdir(), "pakka-durable-build-"));
function run(command, args, cwd = stage) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
	if (result.stdout && !args.includes("--json")) console.log(result.stdout.trimEnd());
	return result.stdout.trim();
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
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
if (pkg.version !== baseline.upstreamVersion) throw new Error("Unexpected source package version");
pkg.version = baseline.patchedVersion;
pkg.dependencies["@earendil-works/pi-ai"] = baseline.upstreamVersion;
pkg.dependencies["@earendil-works/chord"] = baseline.upstreamVersion;
writeFileSync(packagePath, JSON.stringify(pkg, null, "\t") + "\n");
const tsconfigPath = join(durableDir, "tsconfig.build.json");
const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
delete tsconfig.compilerOptions.paths;
writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, "\t") + "\n");
writeFileSync(
	join(stage, "package.json"),
	JSON.stringify(
		{
			name: "pakka-durable-patch-build",
			private: true,
			workspaces: ["packages/durable"],
			devDependencies: { typescript: "7.0.2", "@types/node": "26.6.4" },
			overrides: {
				"@earendil-works/pi-ai": "1.0.3",
				"@earendil-works/chord": "1.0.3",
				"@earendil-works/pi-telemetry": "1.0.3",
			},
		},
		null,
		"\t",
	) + "\n",
);
cpSync(join(patchDir, "build-lock.json"), join(stage, "package-lock.json"));
run(process.execPath, [npmCli, "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
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
		"test/harness-generation.test.ts",
		"test/harness-generation-recovery.test.ts",
		"test/harness-inbox.test.ts",
		"test/harness-tools.test.ts",
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
const [{ filename }] = JSON.parse(packed);
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
