// Run after the execution pack-consumer wrapper; reuse that independent installed artifact.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const consumer = readFileSync(join(root, "docs/.temp/execution-consumer-path.txt"), "utf8").trim();
const profile = join(consumer, "core-profile");
mkdirSync(profile, { recursive: true });
const env = {};
for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC"])
	if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
	HOME: profile,
	USERPROFILE: profile,
	PI_CODING_AGENT_DIR: profile,
	PI_OFFLINE: "1",
	DO_NOT_TRACK: "1",
	NO_COLOR: "1",
	TEMP: realpathSync.native(tmpdir()),
	TMP: realpathSync.native(tmpdir()),
});
for (const file of ["consumer-smoke.mjs", "consumer-native-storage.mjs"])
	copyFileSync(join(root, "scripts", file), join(consumer, file));
function run(args) {
	const result = spawnSync(process.execPath, ["--experimental-import-meta-resolve", ...args], {
		cwd: consumer,
		env,
		encoding: "utf8",
		timeout: 120_000,
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.status !== 0)
		throw new Error(`Exit ${result.status}: ${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
writeFileSync(
	join(consumer, "dependency-tree.json"),
	run(["C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js", "ls", "--all", "--json"]),
);
console.log(run([join(consumer, "consumer-smoke.mjs")]));
