import { readFileSync } from "node:fs";
import { join } from "node:path";

export function productionDurableVersion(root) {
	const path = join(root, "packages", "agent", "package.json");
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(path, "utf8"));
	} catch (cause) {
		throw new Error(`Unable to read production Durable dependency: ${path}`, { cause });
	}
	const dependency = manifest.dependencies?.["@earendil-works/pi-durable"];
	const match =
		typeof dependency === "string"
			? /^file:vendor\/earendil-works-pi-durable-(\d+\.\d+\.\d+-pakka\.\d+)\.tgz$/.exec(dependency)
			: null;
	if (!match) throw new Error("Expected an exact vendored Durable dependency in packages/agent/package.json");
	return match[1];
}
