#!/usr/bin/env node
import { readFile, writeFile, lstat } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import type { ExtensionFacet } from "./extension.ts";
import { pathToFileURL } from "node:url";
import { startPocket, type PocketProductOptions } from "./bootstrap.ts";

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new Error("Invalid Pocket configuration object");
	return value as Record<string, unknown>;
}
function text(value: unknown, max = 8192): string {
	if (typeof value !== "string" || !value.trim() || value.length > max)
		throw new Error("Invalid Pocket configuration text");
	return value;
}
function integer(value: unknown, min: number, max: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
		throw new Error("Invalid Pocket configuration bound");
	return value as number;
}
function strings(value: unknown, max: number): string[] {
	if (!Array.isArray(value) || value.length > max) throw new Error("Invalid Pocket configuration array");
	return value.map((item) => text(item));
}

/** Finite, host-authored startup file. Endpoint/model/credentials never enter browser configuration. */
export function decodePocketProduct(value: unknown): PocketProductOptions {
	const root = object(value, ["runtime", "owner", "initial", "profiles", "transport", "extensions"]),
		runtime = object(root.runtime, [
			"cwd",
			"dataDir",
			"endpoint",
			"model",
			"apiKey",
			"systemPrompt",
			"limits",
			"reopenSessionFile",
			"profiles",
		]),
		limits = object(runtime.limits, ["maxConversations", "maxPrimaryAttempts", "maxAuxiliaryAttempts"]);
	const profiles =
		runtime.profiles === undefined
			? undefined
			: (() => {
					if (!Array.isArray(runtime.profiles) || runtime.profiles.length > 64)
						throw new Error("Invalid approved profiles");
					return runtime.profiles.map((item) => {
						const row = object(item, ["id", "systemPrompt"]);
						return {
							id: text(row.id, 128),
							...(row.systemPrompt === undefined ? {} : { systemPrompt: text(row.systemPrompt, 65536) }),
						};
					});
				})();
	const initial =
		root.initial === undefined
			? []
			: (() => {
					if (!Array.isArray(root.initial) || root.initial.length > 64)
						throw new Error("Invalid initial Pocket conversations");
					return root.initial.map((item) => {
						const row = object(item, ["name", "profile"]);
						return { name: text(row.name, 80), profile: text(row.profile, 128) };
					});
				})();
	const transport =
		root.transport === undefined
			? undefined
			: (() => {
					const row = object(root.transport, [
						"host",
						"port",
						"publicOrigin",
						"allowInsecureRemote",
						"trustedProxyPeers",
						"pollMs",
						"maxConnections",
					]);
					if (row.allowInsecureRemote !== undefined && typeof row.allowInsecureRemote !== "boolean")
						throw new Error("Invalid explicit insecure remote choice");
					return {
						...(row.host === undefined ? {} : { host: text(row.host, 255) }),
						...(row.port === undefined ? {} : { port: integer(row.port, 0, 65535) }),
						...(row.publicOrigin === undefined ? {} : { publicOrigin: text(row.publicOrigin, 2048) }),
						...(row.allowInsecureRemote === undefined
							? {}
							: { allowInsecureRemote: row.allowInsecureRemote }),
						...(row.trustedProxyPeers === undefined
							? {}
							: { trustedProxyPeers: strings(row.trustedProxyPeers, 16) }),
						...(row.pollMs === undefined ? {} : { pollMs: integer(row.pollMs, 20, 5000) }),
						...(row.maxConnections === undefined
							? {}
							: { maxConnections: integer(row.maxConnections, 1, 128) }),
					};
				})();
	const extensions =
		root.extensions === undefined
			? undefined
			: (() => {
					if (!Array.isArray(root.extensions) || root.extensions.length > 64)
						throw new Error("Invalid trusted extension sources");
					return root.extensions.map((item) => {
						const row = object(item, ["root", "facets"]),
							path = text(row.root);
						if (!isAbsolute(path)) throw new Error("Explicit absolute extension root required");
						const facets = row.facets === undefined ? undefined : strings(row.facets, 4);
						if (
							facets &&
							(new Set(facets).size !== facets.length ||
								facets.some((facet) => !["agent", "backend", "webui", "client"].includes(facet)))
						)
							throw new Error("Invalid explicit extension facets");
						// SAFETY: the finite facet strings above exactly match the public ExtensionFacet vocabulary.
						return { root: path, ...(facets ? { facets: facets as ExtensionFacet[] } : {}) };
					});
				})();
	return {
		owner: text(root.owner, 80),
		...(extensions ? { extensions } : {}),
		initial,
		...(root.profiles === undefined ? {} : { profiles: strings(root.profiles, 64) }),
		...(transport ? { transport } : {}),
		runtime: {
			cwd: text(runtime.cwd),
			dataDir: text(runtime.dataDir),
			endpoint: text(runtime.endpoint),
			model: text(runtime.model, 256),
			apiKey: text(runtime.apiKey),
			...(runtime.systemPrompt === undefined ? {} : { systemPrompt: text(runtime.systemPrompt, 65536) }),
			...(runtime.reopenSessionFile === undefined
				? {}
				: { reopenSessionFile: text(runtime.reopenSessionFile) }),
			...(profiles ? { profiles } : {}),
			limits: {
				maxConversations: integer(limits.maxConversations, 1, 1024),
				maxPrimaryAttempts: integer(limits.maxPrimaryAttempts, 1, 1000000),
				maxAuxiliaryAttempts: integer(limits.maxAuxiliaryAttempts, 1, 1000000),
			},
		},
	};
}
const productKeys = [
	"runtime",
	"owner",
	"initial",
	"profiles",
	"transport",
	"extensions",
	"extensionServices",
] as const;
/** Explicit local host code, not a manifest action, browser request, or untrusted configuration decoder. */
async function loadPocketModule(path: string): Promise<PocketProductOptions> {
	if (!isAbsolute(path) || !path.endsWith(".mjs"))
		throw new Error("Explicit absolute ESM configuration required");
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072)
		throw new Error("Invalid ESM configuration file");
	const loaded: unknown = await import(pathToFileURL(path).href);
	if (!loaded || typeof loaded !== "object" || !("default" in loaded))
		throw new Error("Default product options required");
	const options = object(loaded.default, productKeys);
	if (
		typeof options.owner !== "string" ||
		!options.owner.trim() ||
		!options.runtime ||
		typeof options.runtime !== "object" ||
		Array.isArray(options.runtime)
	)
		throw new Error("Product options required");
	// SAFETY: this is operator-selected executable composition, not decoded wire data. Closed top-level keys and required
	// fields are checked here; startPocket, Runtime and extension registration validate their own controlled contracts.
	return options as unknown as PocketProductOptions;
}

export async function runPocket(args: readonly string[]): Promise<number> {
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		if (
			!["--config", "--config-module"].includes(args[0] ?? "") ||
			!args[1] ||
			args[2] !== "--owner-file" ||
			!args[3] ||
			!(args.length === 4 || (args.length === 5 && args[4] === "--control-stdin"))
		)
			throw new Error("Explicit Pocket configuration and private owner-file path required");
		let options: PocketProductOptions;
		if (args[0] === "--config-module") options = await loadPocketModule(args[1]);
		else {
			const data = await readFile(args[1]);
			if (data.byteLength > 131072) throw new Error("Pocket configuration too large");
			const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
			options = decodePocketProduct(raw);
		}
		if (!options.runtime.reopenSessionFile) {
			try {
				await lstat(args[3]);
				throw new Error("Owner-link file already exists");
			} catch (error) {
				if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
			}
		}
		app = await startPocket(options);
		if (app.initialOwner)
			await writeFile(args[3], app.http.origin + "/#signin=" + app.initialOwner.token + "\n", {
				flag: "wx",
				mode: 0o600,
			});
		const stopped = new Promise<void>((done) => {
			process.once("SIGINT", done);
			process.once("SIGTERM", done);
			if (args[4] === "--control-stdin") {
				let input = "";
				process.stdin.setEncoding("utf8");
				process.stdin.on("data", (chunk: string) => {
					input += chunk;
					if (input.trim() === "stop" || input.length > 128) done();
				});
				process.stdin.once("end", done);
				process.stdin.resume();
			}
		});
		process.stdout.write(
			JSON.stringify({
				origin: app.http.origin,
				serverId: app.http.serverId,
				sessionFile: app.runtime.view().sessionFile,
			}) + "\n",
		);
		await stopped;
		process.stdin.pause();
		await app.close();
		return 0;
	} catch {
		try {
			await app?.close();
		} catch {
			/* Unknown storage ownership remains unresolved. */
		}
		process.stderr.write(
			"Pocket startup/control unconfirmed; check explicit configuration and private owner file.\n",
		);
		return 1;
	}
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
	process.exitCode = await runPocket(process.argv.slice(2));
