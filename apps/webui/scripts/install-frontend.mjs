import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeWebUiAssetManifest } from "@pakka/protocol/webui-assets";
import { loadWebUiAssets } from "../dist/assets.js";
import {
	DEFAULT_WEBUI_ARCHIVE,
	DEFAULT_WEBUI_ARCHIVE_SHA256,
	DEFAULT_WEBUI_MANIFEST_SHA256,
} from "../dist/default-frontend.js";

// Consume the independent build verbatim. Package installation and startup need no source checkout or build tools.
const root = fileURLToPath(new URL("../", import.meta.url));
const archive = fileURLToPath(
	new URL("../../../integrations/webui/app/" + DEFAULT_WEBUI_ARCHIVE, import.meta.url),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (digest(await readFile(archive)) !== DEFAULT_WEBUI_ARCHIVE_SHA256)
	throw Error("Default frontend archive identity mismatch");
const tar = (...args) =>
	execFileSync("tar", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
const rawManifest = tar("-xOf", archive, "package/asset-manifest.json");
if (digest(rawManifest) !== DEFAULT_WEBUI_MANIFEST_SHA256)
	throw Error("Default frontend manifest identity mismatch");
let manifest;
try {
	manifest = decodeWebUiAssetManifest(JSON.parse(rawManifest));
} catch (cause) {
	throw new Error("Default frontend manifest cannot be decoded", { cause });
}
const expected = new Set([
	"package/package.json",
	"package/asset-manifest.json",
	...manifest.files.map((file) => "package/" + file.path),
]);
const members = tar("-tzf", archive).trim().split(/\r?\n/);
if (
	members.length !== expected.size ||
	new Set(members).size !== members.length ||
	members.some((path) => !expected.has(path))
)
	throw Error("Default frontend archive members differ from its manifest");
const dist = join(root, "dist");
await mkdir(dist, { recursive: true });
const stage = await mkdtemp(join(dist, ".frontend-"));
try {
	tar("-xzf", archive, "-C", stage);
	const loaded = await loadWebUiAssets({
		directory: join(stage, "package"),
		manifestSha256: DEFAULT_WEBUI_MANIFEST_SHA256,
	});
	if (loaded.manifest.entry !== "/") throw Error("Default frontend requires an HTML entry");
	await rm(join(dist, "frontend"), { recursive: true, force: true });
	await rename(join(stage, "package"), join(dist, "frontend"));
	console.log(
		`Installed fixed independent frontend: ${loaded.assets.size} assets, ${DEFAULT_WEBUI_ARCHIVE_SHA256}`,
	);
} finally {
	await rm(stage, { recursive: true, force: true });
}
