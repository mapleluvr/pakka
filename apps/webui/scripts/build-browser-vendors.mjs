import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version as builderVersion } from "esbuild";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const sourcePackage = fileURLToPath(import.meta.resolve("@tanstack/virtual-core/package.json"));
const metadata = JSON.parse(await readFile(sourcePackage, "utf8"));
if (metadata.version !== "3.19.11" || builderVersion !== "0.28.2")
	throw Error("Browser vendor build requires the declared fixed virtual-core/esbuild versions");
const output = join(packageRoot, "dist", "browser-virtual-core.js");
await mkdir(dirname(output), { recursive: true });
const result = await build({
	absWorkingDir: packageRoot,
	entryPoints: [fileURLToPath(import.meta.resolve("@tanstack/virtual-core"))],
	outfile: output,
	bundle: true,
	platform: "browser",
	format: "esm",
	target: "es2022",
	define: { "process.env.NODE_ENV": '"production"' },
	minify: true,
	legalComments: "eof",
	sourcemap: false,
	metafile: true,
	logLevel: "warning",
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = [];
for (const path of Object.keys(result.metafile.inputs).sort()) {
	const absolute = resolve(packageRoot, path);
	sources.push({
		path: relative(dirname(sourcePackage), absolute).replaceAll("\\", "/"),
		sha256: digest(await readFile(absolute)),
	});
}
await writeFile(
	join(packageRoot, "dist", "browser-vendors.json"),
	JSON.stringify(
		{
			version: 1,
			package: { name: metadata.name, version: metadata.version },
			builder: {
				name: "esbuild",
				version: builderVersion,
				platform: "browser",
				target: "es2022",
				format: "esm",
				production: true,
			},
			sources,
			output: { path: "browser-virtual-core.js", sha256: digest(await readFile(output)) },
			license: {
				path: "licenses/virtual-core-MIT.txt",
				sha256: digest(await readFile(join(packageRoot, "licenses", "virtual-core-MIT.txt"))),
			},
		},
		null,
		2,
	) + "\n",
);
console.log("Built fixed virtual-core browser vendor");
