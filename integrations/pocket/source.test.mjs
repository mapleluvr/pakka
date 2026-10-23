import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { verifySource, inventorySource } from "./source.mjs";

const primary = resolve("artifacts/pakka-webui/p0/upstream-source");
const reference = resolve("artifacts/pakka-webui/p0/pi-pocket-source");

test("WebUI source: primary UI tree is exact and never silently substituted by the issue branch", () => {
	const source = verifySource(primary, "upstream");
	assert.equal(source.commit, "de612d5622cdc66b6b8b4900c650c6f2efdf4c63");
	assert.equal(source.durableVersion, "1.1.0");
	assert.equal(source.license, "MIT");
	assert.ok(source.files.some((file) => file.path === "web/subagents-board.js"));
	assert.ok(source.files.some((file) => file.path === "web/fonts/OFL.txt"));
	assert.throws(() => verifySource(reference, "upstream"), /commit|source|tree/i);
});

test("WebUI source: Phase 2 is a separate older reference with a provable Phase 1 parent", () => {
	const source = verifySource(reference, "extensionReference");
	assert.equal(source.durableVersion, "1.0.2");
	assert.equal(source.parents[0], "2cb652c465f670ba8c66fc3ee639798caca8afbc");
	assert.ok(source.files.some((file) => file.path === "web/sheets/extension.js"));
});

test("WebUI source: a dirtied checkout is not accepted as the pinned adoptable bytes", () => {
	const path = resolve(primary, "web/ui.js"),
		before = readFileSync(path);
	try {
		writeFileSync(path, Buffer.concat([before, Buffer.from("\n// CORRUPT-SOURCE-CANARY\n")]));
		assert.throws(() => verifySource(primary, "upstream"), /source|worktree|checkout/i);
	} finally {
		writeFileSync(path, before);
	}
});

test("WebUI source: an untracked executable input cannot join the pinned upstream test tree", () => {
	const path = resolve(primary, "test/pakka-pin-injection.test.ts");
	assert.equal(existsSync(path), false, "do not overwrite a foreign source input");
	try {
		writeFileSync(path, "throw new Error('UNTRACKED-SOURCE-CANARY');\n", { flag: "wx" });
		assert.throws(() => verifySource(primary, "upstream"), /source|worktree|checkout/i);
	} finally {
		rmSync(path);
	}
});

test("WebUI source: every adopted UI module has one explicit service owner and a real acceptance path", () => {
	let map;
	try {
		map = JSON.parse(readFileSync(new URL("./adoption-map.json", import.meta.url), "utf8"));
	} catch (error) {
		throw new Error("Missing/invalid UI adoption map", { cause: error });
	}
	const files = verifySource(primary, "upstream")
		.files.filter((file) => /^web\/.*\.js$/.test(file.path))
		.map((file) => file.path)
		.sort();
	const mapped = map.groups.flatMap((group) => {
		assert.ok(group.owner && group.scope && group.acceptance && group.modelEffect);
		return group.files;
	});
	assert.equal(mapped.length, new Set(mapped).size, "one source module must not have competing owners");
	assert.deepEqual(mapped.sort(), files);
	assert.equal(
		map.groups.find((group) => group.id === "mas-board").owner,
		"@pakka/mas-devpack public facets",
	);
	assert.equal(map.groups.find((group) => group.id === "pip-removal").modelEffect, "removed");
});

test("WebUI source: the inventory exposes actual UI/backend dependency edges to remove", () => {
	const inventory = inventorySource(primary, "upstream");
	assert.ok(
		inventory.authorityEdges.some(
			(edge) => edge.path === "web/app.js" && edge.kind === "import" && /pip/.test(edge.value),
		),
	);
	assert.ok(
		inventory.authorityEdges.some((edge) => edge.path === "web/store.js" && /subagents/i.test(edge.value)),
	);
	assert.ok(
		inventory.authorityEdges.some(
			(edge) => edge.path.startsWith("src/server/") && /PiP|pip|subagent/i.test(edge.value),
		),
	);
	assert.ok(inventory.actions.some((action) => action.path === "web/store.js"));
	assert.ok(
		inventory.routes.some(
			(route) => route.path === "src/server/http/conversation-routes.ts" && /submit/.test(route.condition),
		),
	);
	assert.ok(
		inventory.routes.some(
			(route) => route.path === "src/server/http/api.ts" && /invite/.test(route.condition),
		),
	);
});
