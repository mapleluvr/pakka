import { writeFile, copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { manifest } from "../dist/manifest.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = new URL("../dist/public/", import.meta.url);
await rm(publicRoot, { recursive: true, force: true });
await mkdir(publicRoot, { recursive: true });
const output = await build({
	absWorkingDir: root,
	entryPoints: { index: "src/browser/index.ts", client: "src/browser/client.ts" },
	outdir: fileURLToPath(publicRoot),
	bundle: true,
	splitting: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	jsxDev: false,
	minify: true,
	chunkNames: "shared-[hash]",
	metafile: true,
	legalComments: "eof",
	define: { "process.env.NODE_ENV": '"production"' },
	external: [
		"react",
		"react/*",
		"react-dom",
		"react-dom/*",
		"@pakka/webui-sdk",
		"@pakka/webui-sdk/*",
		"@astryxdesign/core/*",
		"@stylexjs/stylex",
		"@stylexjs/stylex/*",
	],
});
const inputs = Object.keys(output.metafile.inputs).map((path) => path.replaceAll("\\", "/"));
if (
	inputs.some((path) =>
		/(?:node_modules\/(?:react(?:-dom)?|preact|@astryxdesign|@earendil-works)\/|packages\/agent\/)/.test(
			path,
		),
	)
)
	throw new Error("MAS UI bundled an execution dependency or a second shared renderer");
await copyFile(new URL("../src/browser/board.css", import.meta.url), new URL("board.css", publicRoot));
await writeFile(new URL("../dist/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
await copyFile(
	new URL("../LICENSE.pi-pocket", import.meta.url),
	new URL("../dist/LICENSE.pi-pocket", import.meta.url),
);
const evidence = new URL("../artifacts/", import.meta.url);
await mkdir(evidence, { recursive: true });
await writeFile(
	new URL("browser-build.json", evidence),
	JSON.stringify(
		{
			inputs,
			sharedRuntime: manifest.facets.webui.runtime,
			files: Object.keys(output.metafile.outputs).sort(),
		},
		null,
		2,
	) + "\n",
);
