import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
	npm = process.env.npm_execpath;
if (!npm) throw Error("Run through npm run smoke:memo");
const consumer = mkdtempSync(join(tmpdir(), "pakka-memo-consumer-"));
const evidence = join(root, "docs", ".temp", "installed-memo-" + Date.now());
mkdirSync(evidence, { recursive: true });
const env = {};
for (const name of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"])
	if (process.env[name]) env[name] = process.env[name];
Object.assign(env, {
	HOME: consumer,
	USERPROFILE: consumer,
	PI_CODING_AGENT_DIR: join(consumer, "empty-agent"),
	DO_NOT_TRACK: "1",
	PI_OFFLINE: "1",
	NO_COLOR: "1",
	npm_execpath: npm,
});
function run(name, args, cwd) {
	const start = Date.now(),
		result = spawnSync(process.execPath, args, {
			cwd,
			env,
			encoding: "utf8",
			timeout: name === "pack-agent" || name === "install-runtime" ? 600000 : 180000,
			maxBuffer: 4 * 1024 * 1024,
		});
	writeFileSync(
		join(evidence, name + ".log"),
		JSON.stringify({
			args,
			cwd,
			status: result.status,
			signal: result.signal,
			error: result.error?.code,
			elapsedMs: Date.now() - start,
		}) +
			"\n" +
			(result.stdout ?? "") +
			(result.stderr ?? ""),
	);
	if (result.status !== 0) throw Error(name + " failed: " + result.status + " " + result.stderr);
	return result.stdout;
}
run(
	"pack",
	[npm, "pack", "--ignore-scripts", "--pack-destination", consumer],
	join(root, "packages", "memo"),
);
const name = readdirSync(consumer).find((n) => n.endsWith(".tgz"));
if (!name) throw Error("Missing Memo archive");
writeFileSync(
	join(consumer, "package.json"),
	JSON.stringify({ private: true, type: "module", dependencies: { "@pakka/memo": "file:./" + name } }),
);
run("install", [npm, "install", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund"], consumer);
copyFileSync(join(root, "scripts", "consumer-memo.mjs"), join(consumer, "consumer.mjs"));
run("consumer", ["consumer.mjs", consumer], consumer);
run(
	"headless-first",
	[
		join(consumer, "node_modules", "@pakka", "memo", "examples", "headless.mjs"),
		join(consumer, "example.sqlite"),
	],
	consumer,
);
run(
	"headless-reopen",
	[
		join(consumer, "node_modules", "@pakka", "memo", "examples", "headless.mjs"),
		join(consumer, "example.sqlite"),
	],
	consumer,
);
if (process.argv.includes("--runtime")) {
	run("pack-agent", [join(root, "scripts", "pack-agent.mjs"), consumer], root);
	run(
		"pack-mas",
		[npm, "pack", "--ignore-scripts", "--pack-destination", consumer],
		join(root, "packages", "mas"),
	);
	const archives = readdirSync(consumer),
		agent = archives.find((n) => /^pakka-agent-.*\.tgz$/.test(n)),
		mas = archives.find((n) => /^pakka-mas-[0-9].*\.tgz$/.test(n));
	if (!agent || !mas) throw Error("Missing runtime archives");
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify({
			private: true,
			type: "module",
			dependencies: {
				"@pakka/memo": "file:./" + name,
				"@pakka/agent": "file:./" + agent,
				"@pakka/mas": "file:./" + mas,
			},
		}),
	);
	run("install-runtime", [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
	copyFileSync(join(root, "scripts", "consumer-patchouli.mjs"), join(consumer, "patchouli-consumer.mjs"));
	run("patchouli-consumer", ["patchouli-consumer.mjs", consumer], consumer);
}
const archive = readFileSync(join(consumer, name));
writeFileSync(
	join(evidence, "result.json"),
	JSON.stringify({
		status: "passed",
		runtime: process.argv.includes("--runtime"),
		consumer,
		evidence,
		archive: name,
		sha256: createHash("sha256").update(archive).digest("hex"),
		bytes: archive.length,
	}),
);
console.log(JSON.stringify({ status: "passed", consumer, evidence }));
