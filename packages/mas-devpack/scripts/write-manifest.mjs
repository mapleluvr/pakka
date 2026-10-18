import { writeFile, copyFile, mkdir, rm } from "node:fs/promises";
import { manifest } from "../dist/manifest.js";
await writeFile(new URL("../dist/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
const publicRoot = new URL("../dist/public/", import.meta.url);
await rm(publicRoot, { recursive: true, force: true });
await mkdir(publicRoot, { recursive: true });
for (const name of ["index.js", "graph-board.js", "client.js", "contract.js", "dto.js"])
	await copyFile(new URL("../dist/browser/" + name, import.meta.url), new URL(name, publicRoot));
await copyFile(new URL("../src/browser/board.css", import.meta.url), new URL("board.css", publicRoot));
await copyFile(
	new URL("../LICENSE.pi-pocket", import.meta.url),
	new URL("../dist/LICENSE.pi-pocket", import.meta.url),
);
