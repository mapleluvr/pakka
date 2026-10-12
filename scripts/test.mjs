import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("../", import.meta.url);
const profile = mkdtempSync(join(tmpdir(), "pakka-test-profile-"));
const artifacts = join(fileURLToPath(root), "artifacts", "integration");
mkdirSync(artifacts, { recursive: true });
writeFileSync(join(artifacts, "manifest.jsonl"), "");
const env = {};
for (const k of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"])
	if (process.env[k]) env[k] = process.env[k];
Object.assign(env, {
	HOME: profile,
	USERPROFILE: profile,
	PI_CODING_AGENT_DIR: profile,
	DO_NOT_TRACK: "1",
	PI_OFFLINE: "1",
	NO_COLOR: "1",
	PAKKA_TEST_ARTIFACTS: artifacts,
});
const files = readdirSync(new URL("../packages/", import.meta.url)).flatMap((pkg) => {
	const directory = new URL(`../packages/${pkg}/test/`, import.meta.url);
	try {
		return readdirSync(directory)
			.filter((f) => f.endsWith(".test.ts"))
			.map((f) => `packages/${pkg}/test/${f}`);
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
});
const result = spawnSync(
	process.execPath,
	[
		"--experimental-strip-types",
		"--expose-gc",
		"--test",
		"--test-concurrency=1",
		...process.argv.slice(2),
		...files,
	],
	{ cwd: root, env, stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
