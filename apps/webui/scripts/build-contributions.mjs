import { mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = new URL("../artifacts/", import.meta.url);
await mkdir(evidence, { recursive: true });
for (const name of ["files", "approvals", "browser", "memory", "schedules", "hooks"]) {
	const publicRoot = new URL(`../contributions/${name}/dist/web/`, import.meta.url);
	await rm(publicRoot, { recursive: true, force: true });
	await mkdir(publicRoot, { recursive: true });
	const result = await build({
		absWorkingDir: root,
		entryPoints: {
			index: `contributions/${name}/src/index.tsx`,
			client: `contributions/${name}/src/${name === "files" ? "service" : "data"}.ts`,
		},
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
	const inputs = Object.keys(result.metafile.inputs).map((path) => path.replaceAll("\\", "/"));
	if (
		inputs.some((path) =>
			/(?:node_modules\/(?:react(?:-dom)?|preact|@astryxdesign|@earendil-works)\/|packages\/agent\/)/.test(
				path,
			),
		)
	)
		throw new Error(`${name} UI bundled an execution dependency or another shared renderer`);
	await copyFile(
		new URL(`../contributions/${name}/src/${name}.css`, import.meta.url),
		new URL(`${name}.css`, publicRoot),
	);
	await writeFile(
		new URL(`${name === "files" ? "file" : name}-browser-build.json`, evidence),
		JSON.stringify({ inputs, files: Object.keys(result.metafile.outputs) }, null, 2) + "\n",
	);
}
