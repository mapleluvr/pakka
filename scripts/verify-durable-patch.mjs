import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = process.argv[2] ?? "1.0.3-pakka.1";
if (!/^\d+\.\d+\.\d+-pakka\.\d+$/.test(version)) throw new Error("Invalid patch version");
const metadataPath = join(root, "patches", "pi-durable", version, "artifact.json");
let metadata;
try {
	metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
} catch (cause) {
	throw new Error(`Unable to read Durable patch metadata: ${metadataPath}`, { cause });
}
const artifactPath = join(root, "packages", "agent", "vendor", metadata.filename);
const actual = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
if (actual !== metadata.sha256) {
	throw new Error(`pi-durable patch hash mismatch: expected ${metadata.sha256}, got ${actual}`);
}
for (const [filename, expected] of [
	["source.patch", metadata.sourcePatchSha256],
	["build-lock.json", metadata.buildLockSha256],
]) {
	const hash = createHash("sha256")
		.update(readFileSync(join(dirname(metadataPath), filename)))
		.digest("hex");
	if (hash !== expected) throw new Error(`pi-durable ${filename} does not match the recorded artifact`);
}
console.log(`Verified pi-durable ${metadata.patchedVersion} (${actual})`);
