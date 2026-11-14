/** Static frontend delivery contract. Contains no renderer, Node loader, credentials or service implementation. */
export interface WebUiAssetManifest {
	readonly schema: 1;
	readonly requires: { readonly services: number; readonly workbench: number; readonly extensions: number };
	/** Descriptive UI compatibility; the backend does not interpret component or theme APIs. */
	readonly runtime: {
		readonly id: string;
		readonly sdk: string;
		readonly packages: Readonly<Record<string, string>>;
	};
	/** Null for a shared-runtime-only artifact, otherwise a declared HTML URL. */
	readonly entry: string | null;
	readonly imports: Readonly<Record<string, string>>;
	readonly styles: readonly string[];
	readonly workers: readonly string[];
	readonly files: readonly {
		readonly path: string;
		readonly url: string;
		readonly type: string;
		readonly sha256: string;
	}[];
}
const invalid = (): never => {
	throw new Error("Invalid frontend asset manifest");
};
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		return invalid();
	if (keys && (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))))
		return invalid();
	return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): string {
	if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value))
		return invalid();
	return value;
}
function version(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1000)
		return invalid();
	return value;
}
export function webUiAssetPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 512 &&
		/^[A-Za-z0-9_./-]+$/.test(value) &&
		value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
	);
}
function url(value: unknown): string {
	const path = text(value, 640);
	if (path !== "/" && (!path.startsWith("/") || !webUiAssetPath(path.slice(1)))) return invalid();
	// A static artifact cannot shadow the backend's existing or new service namespace.
	if (
		path === "/pocket" ||
		path.startsWith("/pocket/") ||
		path === "/pakka-webui" ||
		(path.startsWith("/pakka-webui/") &&
			!path.startsWith("/pakka-webui/assets/") &&
			path !== "/pakka-webui/service-worker.js")
	)
		return invalid();
	return path;
}
function strings(value: unknown, max: number): string[] {
	if (!Array.isArray(value) || value.length > max) return invalid();
	const entries = value.map(url);
	if (new Set(entries).size !== entries.length) return invalid();
	return entries;
}
export function decodeWebUiAssetManifest(value: unknown): WebUiAssetManifest {
	const data = object(value, [
		"schema",
		"requires",
		"runtime",
		"entry",
		"imports",
		"styles",
		"workers",
		"files",
	]);
	if (data.schema !== 1) return invalid();
	const needs = object(data.requires, ["services", "workbench", "extensions"]);
	const runtime = object(data.runtime, ["id", "sdk", "packages"]);
	const packageMap = object(runtime.packages),
		imports = object(data.imports);
	if (Object.keys(packageMap).length > 64 || Object.keys(imports).length > 1024) return invalid();
	const declaredPackages = Object.fromEntries(
		Object.entries(packageMap).map(([key, value]) => [text(key), text(value, 80)]),
	);
	const modules = Object.fromEntries(Object.entries(imports).map(([key, value]) => [text(key), url(value)]));
	if (!Array.isArray(data.files) || data.files.length === 0 || data.files.length > 4096) return invalid();
	const paths = new Set<string>(),
		urls = new Map<string, string>();
	const files = data.files.map((value) => {
		const file = object(value, ["path", "url", "type", "sha256"]);
		if (!webUiAssetPath(file.path)) return invalid();
		const type = text(file.type, 80),
			hash = text(file.sha256, 64),
			address = url(file.url);
		if (!/^[a-f0-9]{64}$/.test(hash) || paths.has(file.path) || urls.has(address)) return invalid();
		paths.add(file.path);
		urls.set(address, type);
		return { path: file.path, url: address, type, sha256: hash };
	});
	const entry = data.entry === null ? null : url(data.entry);
	const styles = strings(data.styles, 64),
		workers = strings(data.workers, 32);
	if (
		(entry !== null && urls.get(entry) !== "text/html; charset=utf-8") ||
		Object.values(modules).some((path) => urls.get(path) !== "text/javascript; charset=utf-8") ||
		styles.some((path) => urls.get(path) !== "text/css; charset=utf-8") ||
		workers.some((path) => urls.get(path) !== "text/javascript; charset=utf-8")
	)
		return invalid();
	return {
		schema: 1,
		requires: {
			services: version(needs.services),
			workbench: version(needs.workbench),
			extensions: version(needs.extensions),
		},
		runtime: { id: text(runtime.id), sdk: text(runtime.sdk, 80), packages: declaredPackages },
		entry,
		imports: modules,
		styles,
		workers,
		files,
	};
}
