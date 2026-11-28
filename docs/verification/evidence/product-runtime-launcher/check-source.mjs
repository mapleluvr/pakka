import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("source-manifest.json", import.meta.url), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(JSON.stringify(manifest.files)), manifest.sha256, "source manifest consistency");
const paths = [...new Set(execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean))]
	.filter((name) => /^(apps|packages|scripts|integrations|patches)\//.test(name) || /^[^/]+\.json$/.test(name))
	.sort();
const files = paths.map((path) => {
	const bytes = readFileSync(join(root, path));
	return { path, bytes: bytes.length, sha256: hash(bytes) };
});
assert.equal(hash(JSON.stringify(files)), manifest.sha256, "current source differs from the recorded candidate");
console.log(JSON.stringify({ unchanged: true, files: files.length, sha256: manifest.sha256 }));
