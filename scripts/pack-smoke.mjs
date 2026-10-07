import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const consumer = mkdtempSync(join(tmpdir(), "pakka-packed-consumer-"));
const artifacts = join(root, "artifacts", "package-smoke");
mkdirSync(artifacts, { recursive: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run via npm run smoke:package");
const env = {};
for (const k of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"])
	if (process.env[k]) env[k] = process.env[k];
Object.assign(env, {
	HOME: consumer,
	USERPROFILE: consumer,
	PI_CODING_AGENT_DIR: join(consumer, "isolated-agent"),
	DO_NOT_TRACK: "1",
	PI_OFFLINE: "1",
	NO_COLOR: "1",
});
function run(name, args, cwd) {
	const r = spawnSync(process.execPath, args, {
		cwd,
		env,
		encoding: "utf8",
		timeout: 180000,
		maxBuffer: 4 * 1024 * 1024,
	});
	writeFileSync(
		join(artifacts, name + ".log"),
		"cwd=" + cwd + "\n" + (r.stdout ?? "") + (r.stderr ?? "") + "\nexit=" + r.status + "\n",
	);
	if (r.status !== 0) throw new Error(name + " failed: " + r.stdout + "\n" + r.stderr);
	return r.stdout;
}
run(
	"pack",
	[npmCli, "pack", "--workspace", "@pakka/agent", "--pack-destination", consumer, "--ignore-scripts"],
	root,
);
writeFileSync(
	join(consumer, "package.json"),
	JSON.stringify(
		{
			name: "pakka-external-smoke",
			private: true,
			type: "module",
			dependencies: { "@pakka/agent": "file:./pakka-agent-0.1.0.tgz" },
			devDependencies: { typescript: "7.0.2", "@types/node": "26.6.4" },
		},
		null,
		2,
	),
);
copyFileSync(join(root, "scripts", "consumer-smoke.mjs"), join(consumer, "smoke.mjs"));
copyFileSync(join(root, "scripts", "consumer-types.ts"), join(consumer, "consumer-types.ts"));
run(
	"install",
	[npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"],
	consumer,
);
run(
	"declarations",
	[
		join(consumer, "node_modules", "typescript", "bin", "tsc"),
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
run("dependency-tree", [npmCli, "ls", "--all", "--json"], consumer);
console.log(run("smoke", [join(consumer, "smoke.mjs")], consumer));
writeFileSync(join(artifacts, "consumer-path.txt"), consumer + "\n");
