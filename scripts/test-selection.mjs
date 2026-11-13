import { readdirSync } from "node:fs";
import { join } from "node:path";

// Reviewed daily fault boundaries, not an automatic dependency graph.
const core = new Set([
	"scripts/test/runner.test.mjs",
	"packages/protocol/test/codec.test.ts",
	"packages/protocol/test/session-recovery.test.ts",
	"packages/protocol/test/observation-patch.test.ts",
	"packages/client/test/session-recovery.test.ts",
	"packages/client/test/pocket-observation.test.ts",
	"packages/agent/test/permissions.test.ts",
	"packages/agent/test/runtime-safety.test.ts",
	"packages/agent/test/runtime-records.test.ts",
	"packages/agent/test/sqlite-persistence.test.ts",
	"packages/agent/test/storage-maintenance.test.ts",
	"packages/mas/test/lookup.test.ts",
	"packages/rsi/test/concurrency.test.ts",
	"packages/rsi/test/recovery.test.ts",
	"packages/rsi/test/review-boundaries.test.ts",
	"apps/webui/test/extension-host.test.ts",
	"packages/agent/test/record-work.test.ts",
]);
export function inventory(root) {
	const scan = (directory) => {
		try {
			return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((e) =>
				e.isDirectory()
					? scan(directory + "/" + e.name)
					: /\.test\.(ts|mjs)$/.test(e.name)
						? [directory + "/" + e.name]
						: [],
			);
		} catch (e) {
			if (e.code === "ENOENT") return [];
			throw e;
		}
	};
	return ["packages", "apps"]
		.flatMap((area) =>
			readdirSync(join(root, area), { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.flatMap((e) => scan(area + "/" + e.name + "/test")),
		)
		.concat(scan("scripts/test"))
		.sort();
}
// Explicitly audited list: adding a new test never silently admits a heavy
// dependency into the parallel pool. client.test.ts creates a real Runtime.
const lightFiles = new Set([
	"packages/client/test/pocket-configuration.test.ts",
	"packages/client/test/pocket-content.test.ts",
	"packages/client/test/pocket-credentials.test.ts",
	"packages/client/test/pocket-notifications.test.ts",
	"packages/client/test/pocket-observation.test.ts",
	"packages/client/test/pocket-sessions.test.ts",
	"packages/client/test/pocket.test.ts",
	"packages/client/test/session-recovery.test.ts",
	"packages/protocol/test/codec.test.ts",
	"packages/protocol/test/creation-presets.test.ts",
	"packages/protocol/test/observation-patch.test.ts",
	"packages/protocol/test/pocket-collaboration.test.ts",
	"packages/protocol/test/pocket-configuration.test.ts",
	"packages/protocol/test/pocket-credentials.test.ts",
	"packages/protocol/test/pocket-navigation.test.ts",
	"packages/protocol/test/pocket-notifications.test.ts",
	"packages/protocol/test/pocket-sessions.test.ts",
	"packages/protocol/test/pocket.test.ts",
	"packages/protocol/test/preview-content.test.ts",
	"packages/protocol/test/session-recovery.test.ts",
]);
export function light(file) {
	return lightFiles.has(file);
}
const scopes = {
	// Shared DTO/runtime seams have dynamic consumers throughout the product.
	protocol: () => true,
	runtime: () => true,
	memo: (f) => f.startsWith("packages/memo/"),
	history: (f) =>
		/artifact-history|historical-entry|historical-publication|historian|compresser|source-work|sqlite-journal|strategy-adoption|native-storage/.test(
			f,
		),
	rsi: (f) =>
		f.startsWith("packages/rsi/") ||
		f.startsWith("packages/protocol/") ||
		f.startsWith("packages/client/") ||
		/runtime-records|record-work|records-migration|lookup|extension/.test(f),
	maintenance: (f) => /maintenance|writer-recovery|launcher|private-files/.test(f),
	webui: (f) => f.startsWith("apps/") || f.startsWith("packages/mas-devpack/") || /webui.test/.test(f),
};
export function select(files, args) {
	let suite = "core",
		workers = 1,
		list = false;
	const selectedScopes = [],
		explicit = [],
		nodeArgs = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--list") list = true;
		else if (arg === "--suite") suite = args[++i];
		else if (arg === "--scope") selectedScopes.push(...(args[++i] ?? "").split(","));
		else if (arg === "--files") explicit.push(...(args[++i] ?? "").replaceAll("\\", "/").split(","));
		else if (arg === "--workers") workers = Number(args[++i]);
		else if (arg.startsWith("--test-name-pattern=")) nodeArgs.push(arg);
		else throw Error("Unknown test option: " + arg);
	}
	if (!["core", "affected", "release"].includes(suite)) throw Error("Unknown suite: " + suite);
	if (![1, 2, 4].includes(workers)) throw Error("--workers must be 1, 2 or 4 (light files only)");
	if (selectedScopes.some((s) => !Object.hasOwn(scopes, s)))
		throw Error("Unknown scope; choose " + Object.keys(scopes).join(","));
	if (suite === "affected" && !selectedScopes.length) throw Error("affected requires --scope");
	if (explicit.length && (suite !== "core" || selectedScopes.length))
		throw Error("--files cannot combine with suite/scope");
	if (explicit.some((f) => !files.includes(f))) throw Error("Unknown exact test path");
	if (suite === "release" && selectedScopes.length) throw Error("release cannot be narrowed by --scope");
	if (selectedScopes.length) suite = "affected";
	const selected = files.filter((f) =>
		explicit.length
			? explicit.includes(f)
			: suite === "release" || core.has(f) || selectedScopes.some((s) => scopes[s](f)),
	);
	if (!selected.length) throw Error("No tests selected");
	return {
		suite: explicit.length ? "files" : suite,
		scopes: selectedScopes,
		workers,
		list,
		nodeArgs,
		selected,
		excluded: files.filter((f) => !selected.includes(f)),
		light: selected.filter(light),
		heavy: selected.filter((f) => !light(f)),
	};
}
