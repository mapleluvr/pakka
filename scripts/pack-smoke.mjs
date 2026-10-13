import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const consumer = mkdtempSync(join(tmpdir(), "pakka-packed-consumer-"));
const versions = Object.fromEntries(
	["agent", "mas", "mas-devpack", "server"].map((name) => {
		try {
			return [
				name,
				JSON.parse(
					readFileSync(join(root, name === "server" ? "apps" : "packages", name, "package.json"), "utf8"),
				).version,
			];
		} catch (error) {
			throw new Error("Invalid " + name + " package metadata", { cause: error });
		}
	}),
);
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
	npm_execpath: npmCli,
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
run("pack", [join(root, "scripts", "pack-agent.mjs"), consumer], root);
run(
	"pack-mas",
	[npmCli, "pack", "--ignore-scripts", "--pack-destination", consumer],
	join(root, "packages", "mas"),
);
run(
	"pack-devpack",
	[npmCli, "pack", "--ignore-scripts", "--pack-destination", consumer],
	join(root, "packages", "mas-devpack"),
);
run(
	"pack-server",
	[npmCli, "pack", "--ignore-scripts", "--pack-destination", consumer],
	join(root, "apps", "server"),
);
writeFileSync(
	join(consumer, "package.json"),
	JSON.stringify(
		{
			name: "pakka-external-smoke",
			private: true,
			type: "module",
			dependencies: {
				"@pakka/agent": `file:./pakka-agent-${versions.agent}.tgz`,
				"@pakka/mas": `file:./pakka-mas-${versions.mas}.tgz`,
				"@pakka/server": `file:./pakka-server-${versions.server}.tgz`,
				"@pakka/mas-devpack": `file:./pakka-mas-devpack-${versions["mas-devpack"]}.tgz`,
			},
			devDependencies: { typescript: "7.0.2", "@types/node": "26.6.4" },
		},
		null,
		2,
	),
);
copyFileSync(join(root, "scripts", "consumer-smoke.mjs"), join(consumer, "smoke.mjs"));
copyFileSync(join(root, "scripts", "consumer-types.ts"), join(consumer, "consumer-types.ts"));
copyFileSync(join(root, "scripts", "consumer-runtime.mjs"), join(consumer, "runtime.mjs"));
copyFileSync(join(root, "scripts", "consumer-mas.mjs"), join(consumer, "mas.mjs"));
copyFileSync(join(root, "scripts", "consumer-broker.mjs"), join(consumer, "broker.mjs"));
copyFileSync(join(root, "scripts", "consumer-devpack.mjs"), join(consumer, "devpack.mjs"));
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
writeFileSync(
	join(consumer, "dependency-tree.json"),
	run("dependency-tree", [npmCli, "ls", "--all", "--json"], consumer),
);
console.log(run("smoke", [join(consumer, "smoke.mjs")], consumer));
console.log(run("runtime", [join(consumer, "runtime.mjs")], consumer));
console.log(run("mas", [join(consumer, "mas.mjs")], consumer));
console.log(run("broker", [join(consumer, "broker.mjs")], consumer));
console.log(run("devpack", [join(consumer, "devpack.mjs")], consumer));
writeFileSync(join(artifacts, "consumer-path.txt"), consumer + "\n");
