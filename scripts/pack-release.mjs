import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, mkdir, open, lstat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const names = ["agent", "mas", "mas-devpack", "protocol", "client", "cli", "server", "webui"];
export async function writeReleaseManifest(directory) {
	const packages = [];
	for (const name of names) {
		const location = join(root, ["server", "cli", "webui"].includes(name) ? "apps" : "packages", name);
		const metadata = JSON.parse(await readFile(join(location, "package.json"), "utf8"));
		const file = `pakka-${name}-${metadata.version}.tgz`,
			path = join(directory, file),
			stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Expected original packed archive");
		const digest = createHash("sha256");
		let size = 0;
		for await (const bytes of createReadStream(path)) {
			digest.update(bytes);
			size += bytes.length;
		}
		packages.push({
			name: metadata.name,
			version: metadata.version,
			file,
			sha256: digest.digest("hex"),
			size,
		});
	}
	const manifest = {
		schema: 1,
		maintenanceProtocol: 1,
		version: packages.find((item) => item.name === "@pakka/cli").version,
		nodeMajor: Number(process.versions.node.split(".")[0]),
		packages,
	};
	const output = await open(join(directory, "release.json"), "wx", 0o600);
	try {
		await output.writeFile(JSON.stringify(manifest, null, 2) + "\n");
		await output.sync();
	} finally {
		await output.close();
	}
	return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const directory = process.argv[2] ? resolve(process.argv[2]) : undefined,
		npm = process.env.npm_execpath;
	if (!directory || !npm) throw new Error("Usage: npm run pack:release -- <new release directory>");
	await mkdir(directory, { mode: 0o700 });
	for (const name of names) {
		const location = join(root, ["server", "cli", "webui"].includes(name) ? "apps" : "packages", name);
		const args =
			name === "agent"
				? [join(root, "scripts", "pack-agent.mjs"), directory]
				: [npm, "pack", "--ignore-scripts", "--pack-destination", directory];
		const packed = spawnSync(process.execPath, args, {
			cwd: location,
			env: process.env,
			stdio: "inherit",
			timeout: 180000,
		});
		if (packed.status !== 0) throw new Error("Release archive packaging failed: " + name);
	}
	const manifest = await writeReleaseManifest(directory);
	console.log(
		JSON.stringify({
			status: "packed",
			version: manifest.version,
			manifest: join(directory, "release.json"),
			packages: manifest.packages.length,
		}),
	);
}
