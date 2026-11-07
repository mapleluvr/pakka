import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { createMasDevPack } from "@pakka/mas-devpack";
import { createMasProfilePacks, validateRetainedMasRoots } from "@pakka/mas-devpack/agent";
import { createMasWorkbench } from "@pakka/mas-devpack/workbench";

const runtimeRequire = createRequire(import.meta.resolve("@pakka/agent"));
assert.throws(() => runtimeRequire.resolve("@earendil-works/pi-coding-agent"), { code: "MODULE_NOT_FOUND" });
for (const dependency of ["@pakka/webui", "preact", "@earendil-works/pi-coding-agent"]) {
	await assert.rejects(access(new URL("./node_modules/" + dependency, import.meta.url)), { code: "ENOENT" });
	assert.throws(() => import.meta.resolve(dependency), { code: "ERR_MODULE_NOT_FOUND" });
}
assert.equal(typeof createMasWorkbench, "function");
assert.equal(typeof validateRetainedMasRoots, "function");
const pack = createMasProfilePacks({ profiles: { limited: ["spawn"] } }, () => undefined).get("limited");
assert.ok(pack.tools.some((tool) => tool.name === "mas_spawn"));
assert.ok(
	createMasDevPack({
		resolve: () => {
			throw new Error("No native invocation was admitted");
		},
	}).tools.length > 0,
);
console.log(
	"Headless DevPack public Agent/workbench imports passed with no WebUI, Preact or Coding Agent installed or resolvable; no model dispatch.",
);
