import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run with npm run pack:agent or npm run smoke:package");
const destination = resolve(process.argv[2] ?? join(root, "artifacts", "package"));
mkdirSync(destination, { recursive: true });
const stage = mkdtempSync(join(tmpdir(), "pakka-agent-pack-"));
const agent = join(root, "packages", "agent");
for (const entry of ["package.json", "dist", "vendor"])
	cpSync(join(agent, entry), join(stage, entry), { recursive: true });
const pkg = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
delete pkg.devDependencies;
// Preparation and compilation already happened in the workspace; the stage is production-only.
delete pkg.scripts.build;
writeFileSync(join(stage, "package.json"), JSON.stringify(pkg, null, "\t") + "\n");
function run(args) {
	const result = spawnSync(process.execPath, [npmCli, ...args], {
		cwd: stage,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.status !== 0) throw new Error(`${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
run(["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
// Consumers validate the bundled release by version; file: is only the source build input.
const durable = JSON.parse(
	readFileSync(join(stage, "node_modules", "@earendil-works", "pi-durable", "package.json"), "utf8"),
);
pkg.dependencies["@earendil-works/pi-durable"] = durable.version;
writeFileSync(join(stage, "package.json"), JSON.stringify(pkg, null, "\t") + "\n");
const packed = run(["pack", "--json", "--pack-destination", destination]);
console.log(packed.trim());
