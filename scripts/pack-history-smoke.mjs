import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
	npm = process.env.npm_execpath;
if (!npm) throw new Error("Run through npm run smoke:history -- --agent <archive> --dynamite <archive>");
const args = process.argv.slice(2);
function arg(name) {
	const i = args.indexOf(name);
	if (i < 0 || !args[i + 1]) throw new Error("Missing " + name);
	return resolve(args[i + 1]);
}
const agent = arg("--agent"),
	dynamite = arg("--dynamite"),
	consumer = mkdtempSync(join(tmpdir(), "pakka-history-consumer-")),
	evidence = join(root, "docs/.temp", "installed-history-" + Date.now());
mkdirSync(evidence, { recursive: true });
const env = Object.fromEntries(
	["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"].flatMap((key) =>
		process.env[key] ? [[key, process.env[key]]] : [],
	),
);
Object.assign(env, {
	HOME: consumer,
	USERPROFILE: consumer,
	PI_CODING_AGENT_DIR: join(consumer, "empty-agent"),
	PI_OFFLINE: "1",
	DO_NOT_TRACK: "1",
	NO_COLOR: "1",
	PAKKA_HISTORY_EVIDENCE: join(evidence, "source-fixtures"),
	npm_execpath: npm,
});
const commands = [],
	archives = [];
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
function save(status) {
	writeFileSync(
		join(evidence, "result.json"),
		JSON.stringify({ status, consumer, evidence, node: process.version, archives, commands }, null, 2),
	);
}
function run(name, args, cwd = consumer) {
	const start = Date.now(),
		result = spawnSync(process.execPath, args, {
			cwd,
			env,
			encoding: "utf8",
			timeout: 600000,
			maxBuffer: 8 * 1024 * 1024,
		});
	commands.push({
		name,
		code: result.status,
		signal: result.signal,
		error: result.error?.message,
		elapsedMs: Date.now() - start,
	});
	writeFileSync(join(evidence, name + ".log"), (result.stdout ?? "") + (result.stderr ?? ""));
	save(result.status === 0 ? "running" : "failed");
	if (result.status !== 0 || result.error) throw new Error(name + " failed; see " + evidence);
	return result.stdout;
}
for (const archive of [agent, dynamite]) {
	copyFileSync(archive, join(consumer, basename(archive)));
	archives.push({ name: basename(archive), sha256: sha(archive) });
}
const dependencies = {
	"@pakka/agent": "file:./" + basename(agent),
	"@pakka/dynamite": "file:./" + basename(dynamite),
};
const manifest = () =>
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify({ private: true, type: "module", dependencies }, null, 2),
	);
manifest();
save("running");
for (const file of [
	"history-fixture.mjs",
	"history-standalone.mjs",
	"history-library.mjs",
	"history-source-fixture.mjs",
	"history-source.test.mjs",
	"history-source-boundaries.test.mjs",
	"history-memo-boundaries.test.mjs",
])
	copyFileSync(join(root, "integrations/dynamite", file), join(consumer, file));
run("install-standalone", [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund"]);
run("standalone", ["history-standalone.mjs", join(consumer, "standalone")]);
run("book-example", ["node_modules/@pakka/dynamite/examples/history-book.mjs"]);
for (const name of ["memo", "mas"]) {
	run("build-" + name, [npm, "run", "build", "--workspace=@pakka/" + name], root);
	const output = run(
		"pack-" + name,
		[npm, "pack", "--json", "--ignore-scripts", "--pack-destination", consumer],
		join(root, "packages", name),
	);
	let packed;
	try {
		packed = JSON.parse(output)[0];
	} catch (error) {
		throw new Error("Invalid npm pack identity", { cause: error });
	}
	dependencies["@pakka/" + name] = "file:./" + packed.filename;
	archives.push({ name: packed.filename, sha256: sha(join(consumer, packed.filename)) });
}
manifest();
run("install-library", [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund"]);
copyFileSync(
	join(root, "integrations/dynamite/history-consumer.ts.txt"),
	join(consumer, "history-consumer.ts"),
);
run("consumer-types", [
	join(root, "node_modules/typescript/bin/tsc"),
	"--noEmit",
	"--strict",
	"--skipLibCheck",
	"--target",
	"ES2022",
	"--module",
	"NodeNext",
	"--moduleResolution",
	"NodeNext",
	"history-consumer.ts",
]);
run("memo-source-contracts", [
	"--test",
	"--test-reporter=tap",
	"--test-concurrency=1",
	"history-source.test.mjs",
	"history-source-boundaries.test.mjs",
	"history-memo-boundaries.test.mjs",
]);
run("library", ["history-library.mjs", join(consumer, "library")]);
save("passed");
console.log(JSON.stringify({ status: "passed", consumer, evidence }));
