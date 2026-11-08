import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { manifest } from "../dist/manifest.js";
await writeFile(new URL("../dist/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
const publicRoot = new URL("../dist/public/", import.meta.url);
await rm(publicRoot, { recursive: true, force: true });
await mkdir(publicRoot, { recursive: true });
for (const name of ["index.js", "client.js", "contract.js"])
	await copyFile(new URL("../dist/browser/" + name, import.meta.url), new URL(name, publicRoot));
await copyFile(new URL("../src/browser/tickets.css", import.meta.url), new URL("tickets.css", publicRoot));
