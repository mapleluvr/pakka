import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentFacet } from "@pakka/agent";
import { decodeManifest, frozen, isRecord, publicPath } from "@pakka/protocol/extensions";
import type { ExtensionFacet, ExtensionManifest, ExtensionRegistration } from "@pakka/protocol/extensions";
import { isExtensionFacet } from "@pakka/protocol/extension-rpc";
import type { BackendModule } from "./backend.ts";

export interface ExtensionSource {
	readonly root: string;
	readonly facets?: readonly ExtensionFacet[];
	/** Explicit trusted Agent SDK binding; a manifest path alone never installs an Agent contribution. */
	readonly agent?: AgentFacet;
}
export class ExtensionRefusal extends Error {
	readonly code: "FORBIDDEN" | "CONFLICT" | "INVALID_REQUEST" | "UNSUPPORTED";
	readonly outcome: "denied" | "unknown";
	constructor(code: ExtensionRefusal["code"], outcome: "denied" | "unknown" = "denied") {
		super("Extension " + code.toLowerCase());
		this.code = code;
		this.outcome = outcome;
	}
}
export const refuse = (code: ExtensionRefusal["code"] = "FORBIDDEN"): never => {
	throw new ExtensionRefusal(code);
};
export const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const facetKey = (extension: string, facet: ExtensionFacet) => extension + ":" + facet;
export type ExtensionAsset = { readonly type: string; readonly body: Uint8Array; readonly hash: string };
export interface AcceptedFacet {
	readonly source: ExtensionSource;
	readonly hash: string;
	readonly codeHash: string;
	readonly assets: ReadonlyMap<string, ExtensionAsset>;
	view: ExtensionRegistration;
	actions: BackendModule["actions"];
	loaded: boolean;
}
const mime: Readonly<Record<string, string>> = {
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	webp: "image/webp",
	woff2: "font/woff2",
};
async function file(root: string, path: string, maximum = 1048576): Promise<Uint8Array> {
	if (!publicPath(path)) return refuse("INVALID_REQUEST");
	const realRoot = await realpath(root),
		rootStat = await lstat(root);
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return refuse("INVALID_REQUEST");
	let current = root;
	for (const segment of path.split("/")) {
		current = join(current, segment);
		if ((await lstat(current)).isSymbolicLink()) return refuse("INVALID_REQUEST");
	}
	const pathReal = await realpath(current),
		scope = relative(realRoot, pathReal),
		stat = await lstat(current);
	if (
		!scope ||
		scope === ".." ||
		scope.startsWith(".." + sep) ||
		isAbsolute(scope) ||
		!stat.isFile() ||
		stat.size > maximum
	)
		return refuse("INVALID_REQUEST");
	const body = await readFile(current);
	if (
		body.length > maximum ||
		(await lstat(current)).isSymbolicLink() ||
		(await realpath(current)) !== pathReal
	)
		return refuse("INVALID_REQUEST");
	return body;
}
async function publicAssets(
	source: ExtensionSource,
	manifest: ExtensionManifest,
): Promise<ReadonlyMap<string, ExtensionAsset>> {
	const assets = new Map<string, ExtensionAsset>();
	const publicRoot = manifest.facets.webui?.publicDir;
	let total = 0;
	async function add(path: string, rootPath: string) {
		const type = mime[path.split(".").at(-1)!];
		if (!type || assets.size >= 128) return refuse("INVALID_REQUEST");
		const body = await file(source.root, rootPath);
		total += body.length;
		if (total > 8 * 1024 * 1024) return refuse("INVALID_REQUEST");
		assets.set(path, { type, body, hash: hash(body) });
	}
	if (!publicRoot) {
		const path = manifest.facets.client!;
		if (mime[path.split(".").at(-1)!] !== mime.js) return refuse("INVALID_REQUEST");
		await add(path, path);
		return assets;
	}
	async function walk(path: string): Promise<void> {
		const absolute = join(source.root, publicRoot!, path);
		if (!publicPath([publicRoot, path].filter(Boolean).join("/")) || (await lstat(absolute)).isSymbolicLink())
			return refuse("INVALID_REQUEST");
		for (const name of (await readdir(absolute)).sort()) {
			const child = [path, name].filter(Boolean).join("/"),
				stat = await lstat(join(absolute, name));
			if (!publicPath(child) || stat.isSymbolicLink()) return refuse("INVALID_REQUEST");
			if (stat.isDirectory()) await walk(child);
			else {
				if (!stat.isFile()) return refuse("INVALID_REQUEST");
				await add(child, publicRoot + "/" + child);
			}
		}
	}
	await walk("");
	return assets;
}
/** Stage immutable public bytes. A later source edit only enters a new, explicitly published facet generation. */
export async function prepareFacets(
	input: ExtensionSource,
	only?: ExtensionFacet,
): Promise<readonly AcceptedFacet[]> {
	if (
		!input ||
		Object.keys(input).some((key) => !["root", "facets", "agent"].includes(key)) ||
		typeof input.root !== "string" ||
		!isAbsolute(input.root)
	)
		return refuse("INVALID_REQUEST");
	let raw: unknown;
	try {
		raw = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(await file(input.root, "manifest.json", 131072)),
		);
	} catch {
		return refuse("INVALID_REQUEST");
	}
	const manifest = decodeManifest(raw);
	const approved = input.facets
		? [...input.facets]
		: (Object.keys(manifest.facets).filter((name) => name !== "agent" || input.agent) as ExtensionFacet[]);
	if (
		new Set(approved).size !== approved.length ||
		approved.some((facet) => !isExtensionFacet(facet) || !manifest.facets[facet]) ||
		(only !== undefined && !approved.includes(only))
	)
		return refuse("INVALID_REQUEST");
	const facets = only ? [only] : approved;
	const source: ExtensionSource = Object.freeze({
		root: resolve(input.root),
		facets: Object.freeze(approved),
		...(input.agent ? { agent: input.agent } : {}),
	});
	if (
		facets.includes("agent") &&
		(!source.agent || source.agent.id !== manifest.id || source.agent.version !== manifest.version)
	)
		return refuse("UNSUPPORTED");
	const assets = facets.some((facet) => facet === "webui" || facet === "client")
		? await publicAssets(source, manifest)
		: new Map<string, ExtensionAsset>();
	const result: AcceptedFacet[] = [];
	for (const facet of facets) {
		if (
			(facet === "webui" && !assets.has(manifest.facets.webui!.entry)) ||
			(facet === "client" && !assets.has(manifest.facets.client!))
		)
			return refuse("INVALID_REQUEST");
		const selectedAssets =
			facet === "webui" || facet === "client" ? assets : new Map<string, ExtensionAsset>();
		const path =
			facet === "backend" ? manifest.facets.backend : facet === "agent" ? manifest.facets.agent : undefined;
		const codeHash = path ? hash(await file(source.root, path)) : "";
		const digest = hash(
			JSON.stringify([
				manifest,
				facet,
				codeHash,
				[...selectedAssets].map(([path, asset]) => [path, asset.hash]),
			]),
		);
		result.push({
			source,
			hash: digest,
			codeHash,
			assets: selectedAssets,
			actions: {},
			loaded: false,
			view: frozen({ manifest, facet, generation: digest + "-" + randomUUID(), phase: "ready" }),
		});
	}
	return result;
}
/** Runs only after durable initialization intent; late completion cannot publish through an invalidated guard. */
export async function activateBackend(entry: AcceptedFacet, check: () => void): Promise<void> {
	check();
	if (entry.loaded || entry.view.facet !== "backend") return;
	const path = entry.view.manifest.facets.backend!;
	if (hash(await file(entry.source.root, path)) !== entry.codeHash) return refuse("CONFLICT");
	check();
	const module = await import(
		pathToFileURL(join(entry.source.root, path)).href + "?pakka=" + entry.view.generation
	);
	check();
	if (
		!isRecord(module.actions) ||
		Object.keys(module.actions).length !== entry.view.manifest.actions.length ||
		entry.view.manifest.actions.some((action) => typeof module.actions[action.id] !== "function")
	)
		throw Error("Unconfirmed Backend registration");
	entry.actions = Object.freeze({ ...module.actions });
	entry.loaded = true;
}
/** An Agent reload can only republish the already-bound definition; file changes need new trusted composition. */
export async function checkAgentSource(entry: AcceptedFacet): Promise<void> {
	const agent = entry.source.agent;
	if (
		!agent ||
		!agent.status().bindings ||
		agent.id !== entry.view.manifest.id ||
		agent.version !== entry.view.manifest.version ||
		hash(await file(entry.source.root, entry.view.manifest.facets.agent!)) !== entry.codeHash
	)
		return refuse("UNSUPPORTED");
}
