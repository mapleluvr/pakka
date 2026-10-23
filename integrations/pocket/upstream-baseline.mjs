import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { verifySource } from "./source.mjs";

const root = resolve("artifacts/pakka-webui/p0");
const cwd = join(root, "upstream-source");
const pinned = verifySource(cwd, "upstream");
const isolated = mkdtempSync(join(root, "baseline-profile-"));
for (const path of ["home", "home/AppData/Roaming", "home/AppData/Local", "temp", "data"])
	mkdirSync(join(isolated, path), { recursive: true });
const env = {};
for (const name of ["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "PROCESSOR_ARCHITECTURE"])
	if (process.env[name]) env[name] = process.env[name];
Object.assign(env, {
	HOME: join(isolated, "home"),
	USERPROFILE: join(isolated, "home"),
	APPDATA: join(isolated, "home/AppData/Roaming"),
	LOCALAPPDATA: join(isolated, "home/AppData/Local"),
	TEMP: join(isolated, "temp"),
	TMP: join(isolated, "temp"),
	PI_POCKET_DIR: join(isolated, "data"),
	PI_CODING_AGENT_DIR: join(isolated, "agent"),
	PI_POCKET_GUARD: "off",
	NPM_CONFIG_USERCONFIG: join(isolated, "empty.npmrc"),
	NPM_CONFIG_GLOBALCONFIG: join(isolated, "empty-global.npmrc"),
	NPM_CONFIG_AUDIT: "false",
	NPM_CONFIG_FUND: "false",
	CI: "true",
});
writeFileSync(env.NPM_CONFIG_USERCONFIG, "");
writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, "");
const npm = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
assert.ok(existsSync(npm), "Use installed npm CLI through the already-selected Node");
const steps = [
	["install", [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], 300000],
	["check", [npm, "run", "check"], 120000],
	["test", ["--test", "--test-concurrency=1", "test/*.test.ts"], 900000],
];
const summary = {
	source: pinned.commit,
	sourceTree: pinned.tree,
	platform: process.platform + "-" + process.arch,
	purpose: "Unmodified upstream baseline only; faux provider is not Pakka production evidence",
	node: process.version,
	isolatedHome: true,
	inheritedCredentialValues: false,
	steps: [],
};
for (const [name, args, timeout] of steps) {
	const started = Date.now();
	const run = spawnSync(process.execPath, args, {
		cwd,
		env,
		encoding: "utf8",
		timeout,
		maxBuffer: 32 * 1024 * 1024,
		windowsHide: true,
	});
	writeFileSync(
		join(root, `upstream-${name}.log`),
		(run.stdout ?? "") + (run.stderr ?? "") + (run.error ? "\n" + String(run.error) : ""),
	);
	summary.steps.push({
		name,
		status: run.status,
		signal: run.signal,
		elapsedMs: Date.now() - started,
		...(run.error ? { error: String(run.error) } : {}),
	});
	writeFileSync(join(root, "upstream-baseline.json"), JSON.stringify(summary, null, 2) + "\n");
	console.log(JSON.stringify(summary.steps.at(-1)));
	if (name === "install" && run.status !== 0) break;
}
process.exitCode = summary.steps.some((step) => step.status !== 0) ? 1 : 0;
