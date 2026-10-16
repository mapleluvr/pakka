import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Runtime, JsonObject, ConversationRef } from "@pakka/agent";
import type { PocketAuthority, PocketPeople, PocketWorkspace } from "@pakka/server/pocket";
import { decodeManifest, decodeValue, extensionId, frozen, isRecord, publicPath } from "./extension.ts";
import type {
	ExtensionRegistration,
	ExtensionCall,
	ExtensionOperation,
	ExtensionOperationRequest,
	ExtensionJson,
	ExtensionFacet,
	ExtensionAction,
} from "./extension.ts";
import type {
	BackendContext,
	BackendModule,
	ExtensionHost,
	ExtensionService,
	ExtensionSetting,
} from "./backend.ts";

export interface ExtensionSource {
	readonly root: string;
	readonly facets?: readonly ExtensionFacet[];
}
export interface ExtensionHostOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly workspace: PocketWorkspace;
	readonly sources: readonly ExtensionSource[];
	readonly services?: Readonly<Record<string, ExtensionService>>;
}
export class ExtensionRefusal extends Error {
	readonly code: "FORBIDDEN" | "CONFLICT" | "INVALID_REQUEST" | "UNSUPPORTED";
	constructor(code: ExtensionRefusal["code"]) {
		super("Extension " + code.toLowerCase());
		this.code = code;
	}
}
type Asset = { path: string; hash: string; type: string; body: Uint8Array };
type Accepted = {
	source: ExtensionSource;
	view: ExtensionRegistration;
	assets: Map<string, Asset>;
	actions: BackendModule["actions"];
	backendHash: string;
	loaded: boolean;
	faulted: boolean;
};
type Saved = {
	id: string;
	extension: string;
	action: string;
	actorId: string;
	requestId: string;
	fingerprint: string;
	permission: ExtensionAction["permission"];
	target: ConversationRef | null;
	state: "pending" | "done" | "unknown";
	value?: ExtensionJson;
};
type SettingsRow = { key: string; version: number; value: ExtensionJson };
type Initialization = { extension: string; hash: string; state: "loading" | "ready" | "unknown" };
type State = {
	schema: 1;
	operations: Saved[];
	settings: SettingsRow[];
	disabled: string[];
	initializations: Initialization[];
};
const requestKey = (value: unknown): value is string =>
	typeof value === "string" && /^[a-zA-Z0-9][-a-zA-Z0-9._:]{0,159}$/.test(value);
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sameRef = (a: ConversationRef, b: ConversationRef) =>
	["key", "sessionId", "conversationId", "incarnation", "profile"].every(
		(key) => a[key as keyof ConversationRef] === b[key as keyof ConversationRef],
	);
const mime: Readonly<Record<string, string>> = {
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	webp: "image/webp",
	woff2: "font/woff2",
};
const refuse = (code: ExtensionRefusal["code"] = "FORBIDDEN"): never => {
	throw new ExtensionRefusal(code);
};
function jsonValue(value: unknown, depth = 0): value is ExtensionJson {
	if (depth > 16) return false;
	if (value === null || typeof value === "boolean" || typeof value === "string") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value))
		return (
			value.length <= 8192 &&
			Object.keys(value).length === value.length &&
			value.every((child) => jsonValue(child, depth + 1))
		);
	return (
		isRecord(value) &&
		Object.keys(value).length <= 512 &&
		Object.entries(value).every(
			([key, child]) =>
				!["__proto__", "constructor", "prototype"].includes(key) && jsonValue(child, depth + 1),
		)
	);
}
function reference(value: unknown): value is ConversationRef {
	return (
		isRecord(value) &&
		Object.keys(value).sort().join(",") === "conversationId,incarnation,key,profile,sessionId" &&
		Object.values(value).every(requestKey)
	);
}
function decodeState(data: JsonObject, version: number): State {
	if (!version) {
		if (Object.keys(data).length) throw new Error("Unconfirmed extension store");
		return { schema: 1, operations: [], settings: [], disabled: [], initializations: [] };
	}
	if (
		data.schema !== 1 ||
		Object.keys(data).sort().join(",") !== "disabled,initializations,operations,schema,settings" ||
		!Array.isArray(data.initializations) ||
		data.initializations.length > 64 ||
		!Array.isArray(data.operations) ||
		data.operations.length > 512 ||
		!Array.isArray(data.settings) ||
		data.settings.length > 512 ||
		!Array.isArray(data.disabled) ||
		data.disabled.length > 64 ||
		!data.disabled.every(extensionId)
	)
		throw new Error("Malformed extension state");
	for (const item of data.initializations) {
		if (
			!isRecord(item) ||
			Object.keys(item).sort().join(",") !== "extension,hash,state" ||
			!extensionId(item.extension) ||
			typeof item.hash !== "string" ||
			!/^[0-9a-f]{64}$/.test(item.hash) ||
			!["loading", "ready", "unknown"].some((state) => state === item.state)
		)
			throw new Error("Malformed extension initialization");
	}
	for (const item of data.operations) {
		if (
			!isRecord(item) ||
			Object.keys(item).some(
				(key) =>
					![
						"id",
						"extension",
						"action",
						"actorId",
						"requestId",
						"fingerprint",
						"permission",
						"target",
						"state",
						"value",
					].includes(key),
			) ||
			![item.id, item.actorId, item.requestId].every(requestKey) ||
			!extensionId(item.extension) ||
			!extensionId(item.action) ||
			typeof item.fingerprint !== "string" ||
			!/^[0-9a-f]{64}$/.test(item.fingerprint) ||
			!["read", "send", "steer", "manage", "extensions.install"].some((v) => v === item.permission) ||
			!["pending", "done", "unknown"].some((v) => v === item.state) ||
			(item.target !== null && !reference(item.target)) ||
			(item.state === "done" ? !jsonValue(item.value) : item.value !== undefined)
		)
			throw new Error("Malformed extension operation");
	}
	for (const item of data.settings)
		if (
			!isRecord(item) ||
			Object.keys(item).sort().join(",") !== "key,value,version" ||
			typeof item.key !== "string" ||
			item.key.length > 512 ||
			!Number.isSafeInteger(item.version) ||
			Number(item.version) < 1 ||
			!jsonValue(item.value)
		)
			throw new Error("Malformed extension settings");
	if (
		new Set(data.operations.map((item) => (item as Record<string, unknown>).id)).size !==
			data.operations.length ||
		new Set(data.settings.map((item) => (item as Record<string, unknown>).key)).size !==
			data.settings.length ||
		new Set(data.disabled).size !== data.disabled.length ||
		new Set(data.initializations.map((item) => (item as Record<string, unknown>).extension)).size !==
			data.initializations.length
	)
		throw new Error("Duplicate extension records");
	// SAFETY: all closed persistent row fields, references, JSON payloads and identities were validated above.
	return structuredClone(data) as unknown as State;
}
function nativeData(value: unknown): JsonObject {
	if (!isRecord(value) || !jsonValue(value)) throw new Error("Non-JSON extension persistence");
	// SAFETY: validated plain JSON object; native storage accepts the same finite JSON vocabulary.
	return structuredClone(value) as JsonObject;
}
async function file(root: string, path: string, max = 1048576): Promise<Uint8Array> {
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
		stat.size > max
	)
		return refuse("INVALID_REQUEST");
	const bytes = await readFile(current);
	if (bytes.length > max || (await lstat(current)).isSymbolicLink() || (await realpath(current)) !== pathReal)
		return refuse("INVALID_REQUEST");
	return bytes;
}
async function prepare(source: ExtensionSource): Promise<Accepted> {
	if (
		!source ||
		Object.keys(source).some((key) => !["root", "facets"].includes(key)) ||
		typeof source.root !== "string" ||
		!isAbsolute(source.root)
	)
		return refuse("INVALID_REQUEST");
	const bytes = await file(source.root, "manifest.json", 131072);
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return refuse("INVALID_REQUEST");
	}
	const manifest = decodeManifest(raw),
		facets = source.facets
			? [...source.facets]
			: (Object.keys(manifest.facets).filter((key) => key !== "agent") as ExtensionFacet[]);
	if (
		new Set(facets).size !== facets.length ||
		facets.some(
			(facet) => !["backend", "webui", "client", "agent"].includes(facet) || !manifest.facets[facet],
		)
	)
		return refuse("INVALID_REQUEST");
	if (facets.includes("agent")) return refuse("UNSUPPORTED"); // Agent contributions require explicit approved-profile startup composition.
	const assets = new Map<string, Asset>();
	let total = 0;
	const publicRoot = manifest.facets.webui?.publicDir;
	if (publicRoot && (facets.includes("webui") || facets.includes("client"))) {
		async function walk(path: string): Promise<void> {
			const absolute = join(source.root, publicRoot!, path);
			if (
				!publicPath([publicRoot, path].filter(Boolean).join("/")) ||
				(await lstat(absolute)).isSymbolicLink()
			)
				return refuse("INVALID_REQUEST");
			for (const name of await readdir(absolute)) {
				const child = [path, name].filter(Boolean).join("/"),
					stat = await lstat(join(absolute, name));
				if (!publicPath(child) || stat.isSymbolicLink()) return refuse("INVALID_REQUEST");
				if (stat.isDirectory()) {
					await walk(child);
					continue;
				}
				const type = mime[name.split(".").at(-1)!];
				if (!type || !stat.isFile() || assets.size >= 128) return refuse("INVALID_REQUEST");
				const body = await file(source.root, publicRoot + "/" + child);
				total += body.length;
				if (total > 8 * 1024 * 1024) return refuse("INVALID_REQUEST");
				assets.set(child, { path: publicRoot + "/" + child, type, body, hash: hash(body) });
			}
		}
		await walk("");
		if (facets.includes("webui") && !assets.has(manifest.facets.webui!.entry))
			return refuse("INVALID_REQUEST");
		if (facets.includes("client") && manifest.facets.client && !assets.has(manifest.facets.client))
			return refuse("INVALID_REQUEST");
	}
	if (!publicRoot && facets.includes("client")) {
		const path = manifest.facets.client!,
			type = mime[path.split(".").at(-1)!];
		if (type !== mime.js) return refuse("INVALID_REQUEST");
		const body = await file(source.root, path);
		assets.set(path, { path, body, type, hash: hash(body) });
	}
	const backendHash = facets.includes("backend")
		? hash(await file(source.root, manifest.facets.backend!))
		: "";
	const generation =
		hash(
			JSON.stringify([manifest, facets, backendHash, [...assets].map(([key, value]) => [key, value.hash])]),
		) +
		"-" +
		randomUUID();
	return {
		source: { root: resolve(source.root), facets },
		view: frozen({ manifest, generation, facets, phase: "ready" }),
		actions: {},
		assets,
		backendHash,
		loaded: false,
		faulted: false,
	};
}
async function activate(entry: Accepted): Promise<void> {
	if (entry.loaded || !entry.view.facets.includes("backend")) return;
	const path = entry.view.manifest.facets.backend!;
	if (hash(await file(entry.source.root, path)) !== entry.backendHash) return refuse("CONFLICT");
	try {
		const loaded = await import(
			pathToFileURL(join(entry.source.root, path)).href + "?pakka=" + entry.backendHash
		);
		if (
			!isRecord(loaded.actions) ||
			Object.keys(loaded.actions).length !== entry.view.manifest.actions.length ||
			entry.view.manifest.actions.some((row) => typeof loaded.actions[row.id] !== "function")
		)
			throw new Error("Unconfirmed backend registration");
		entry.actions = Object.freeze({ ...loaded.actions });
		entry.loaded = true;
	} catch (error) {
		entry.faulted = true;
		entry.view = frozen({ ...entry.view, phase: "unknown" });
		throw error;
	}
}

/** Trusted product composition. Extensions receive only the bound BackendContext, never these owner ports. */
export async function createExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
	const { runtime, people, workspace } = options;
	if (!Array.isArray(options.sources) || options.sources.length > 64) return refuse("INVALID_REQUEST");
	const accepted = new Map<string, Accepted>(),
		store = runtime.store({ namespace: "pocket.extensions", maxBytes: 1048576 });
	let tail: Promise<unknown> = Promise.resolve();
	const serial = <T>(operation: () => Promise<T>): Promise<T> => {
		const value = tail.then(operation);
		tail = value.then(
			() => {},
			() => {},
		);
		return value;
	};
	const snapshot = async () => {
		const saved = await store.snapshot();
		return { version: saved.version, state: decodeState(saved.data, saved.version) };
	};
	const update = <T>(effect: (state: State) => T, check: () => void): Promise<T> =>
		serial(async () => {
			const before = await snapshot();
			check();
			const value = effect(before.state);
			if (
				before.state.operations.length > 512 ||
				before.state.settings.length > 512 ||
				before.state.initializations.length > 64
			)
				throw new Error("Extension persistence capacity exceeded");
			await store.compareAndSet(before.version, nativeData(before.state), check);
			check();
			return value;
		});
	const initial = await snapshot();
	const collision = (candidate: Accepted, except?: string) => {
		for (const [id, active] of accepted)
			if (
				id !== except &&
				(id === candidate.view.manifest.id ||
					active.view.manifest.commands.some((command) =>
						candidate.view.manifest.commands.some((other) => other.slash === command.slash),
					))
			)
				return refuse("CONFLICT");
		for (const name of candidate.view.manifest.services ?? [])
			if (!options.services?.[name]) return refuse("UNSUPPORTED");
	};
	// Stage the entire batch before running any trusted module; collisions cannot leave a half-loaded batch.
	for (const source of options.sources) {
		const entry = await prepare(source);
		collision(entry);
		if (initial.state.disabled.includes(entry.view.manifest.id))
			entry.view = frozen({ ...entry.view, phase: "disabled" });
		accepted.set(entry.view.manifest.id, entry);
	}
	const initialize = async (entry: Accepted, check: () => void, reconcile = false): Promise<boolean> => {
		if (entry.loaded || !entry.view.facets.includes("backend")) {
			check();
			return true;
		}
		const id = entry.view.manifest.id;
		const began = await update((state) => {
			const previous = state.initializations.find((row) => row.extension === id);
			if (previous && previous.state !== "ready" && !reconcile) return false;
			const record: Initialization = { extension: id, hash: entry.backendHash, state: "loading" };
			if (previous) Object.assign(previous, record);
			else state.initializations.push(record);
			return true;
		}, check);
		if (!began) {
			entry.faulted = true;
			entry.view = frozen({ ...entry.view, phase: "unknown" });
			return false;
		}
		try {
			check();
			await activate(entry);
			check();
			await update((state) => {
				const saved = state.initializations.find((row) => row.extension === id);
				if (!saved || saved.hash !== entry.backendHash || saved.state !== "loading")
					return refuse("CONFLICT");
				saved.state = "ready";
			}, check);
			return true;
		} catch (error) {
			entry.faulted = true;
			entry.view = frozen({ ...entry.view, phase: "unknown" });
			try {
				await update(
					(state) => {
						const saved = state.initializations.find((row) => row.extension === id);
						if (saved?.hash === entry.backendHash) saved.state = "unknown";
					},
					() => {},
				);
			} catch (persistenceError) {
				throw new AggregateError([error, persistenceError], "Unconfirmed extension initialization");
			}
			throw error;
		}
	};
	for (const entry of accepted.values())
		if (entry.view.phase === "ready")
			await initialize(entry, () => {
				if (runtime.view().phase !== "ready") return refuse();
			});
	let lifecycleTail: Promise<unknown> = Promise.resolve();
	const lifecycle = <T>(effect: () => Promise<T>): Promise<T> => {
		const value = lifecycleTail.then(effect);
		lifecycleTail = value.then(
			() => {},
			() => {},
		);
		return value;
	};
	const current = (actor: PocketAuthority) => {
		try {
			return people.current(actor);
		} catch {
			return refuse();
		}
	};
	const authorize = (
		actor: PocketAuthority,
		permission: ExtensionAction["permission"],
		target?: ConversationRef,
	) => {
		current(actor);
		if (target) {
			if (!runtime.view().conversations.some((ref) => sameRef(ref, target))) return refuse();
			try {
				people.check(actor, permission, target.conversationId);
			} catch {
				return refuse();
			}
		} else if (permission !== "read") {
			try {
				people.check(actor, "extensions.install");
			} catch {
				return refuse();
			}
		}
	};
	const entryFor = (id: string, generation?: string) => {
		const entry = accepted.get(id);
		if (
			!entry ||
			entry.view.phase !== "ready" ||
			(generation !== undefined && entry.view.generation !== generation)
		)
			return refuse();
		return entry;
	};
	const present = (row: Saved): ExtensionOperation =>
		frozen({
			id: row.id,
			extension: row.extension,
			action: row.action,
			actorId: row.actorId,
			requestId: row.requestId,
			state: row.state === "done" ? "done" : "unknown",
			...(row.state === "done" ? { value: row.value! } : {}),
		});
	const operation = async (actor: PocketAuthority, id: string): Promise<ExtensionOperation> => {
		const person = current(actor),
			before = await snapshot(),
			saved = before.state.operations.find((row) => row.id === id);
		if (!saved || saved.actorId !== person.id) return refuse();
		authorize(actor, saved.permission, saved.target ?? undefined);
		return present(saved);
	};
	return Object.freeze({
		list: (actor: PocketAuthority, target?: ConversationRef) => {
			authorize(actor, "read", target);
			return frozen(
				[...accepted.values()].map((entry) => {
					const manifest = entry.view.manifest,
						can = (action: ExtensionAction) => {
							if (action.scope === "conversation" && !target) return false;
							try {
								authorize(actor, action.permission, action.scope === "conversation" ? target : undefined);
								return true;
							} catch {
								return false;
							}
						};
					const actions = entry.view.facets.includes("backend") ? manifest.actions.filter(can) : [],
						interfaces = entry.view.facets.includes("webui")
							? manifest.interfaces.filter((row) => row.scope === "app" || target)
							: [];
					return {
						...entry.view,
						manifest: {
							...manifest,
							actions,
							commands: manifest.commands.filter((command) =>
								command.action
									? actions.some((action) => action.id === command.action)
									: interfaces.some((view) => view.id === command.interface),
							),
							interfaces,
						},
					};
				}),
			);
		},
		operation,
		operationByRequest: async (actor: PocketAuthority, request: ExtensionOperationRequest): Promise<ExtensionOperation> => {
			const person = current(actor);
			if (!isRecord(request) || !extensionId(request.extension) || !requestKey(request.requestId) || Object.keys(request).some(key => !["extension", "requestId", "target"].includes(key))) return refuse("INVALID_REQUEST");
			authorize(actor, "read", request.target);
			const saved = (await snapshot()).state.operations.find(row => row.extension === request.extension && row.actorId === person.id && row.requestId === request.requestId && (row.target ? !!request.target && sameRef(row.target, request.target) : !request.target));
			if (!saved) return refuse();
			authorize(actor, saved.permission, saved.target ?? undefined);
			return present(saved);
		},
		setEnabled: (actor: PocketAuthority, id: string, enabled: boolean) =>
			lifecycle(async () => {
				authorize(actor, "extensions.install");
				const entry = accepted.get(id);
				if (!entry || typeof enabled !== "boolean") return refuse("INVALID_REQUEST");
				if (enabled) {
					if (entry.faulted) return refuse("CONFLICT");
					if (!(await initialize(entry, () => authorize(actor, "extensions.install"))))
						return refuse("CONFLICT");
					authorize(actor, "extensions.install");
				}
				await update(
					(state) => {
						state.disabled = enabled
							? state.disabled.filter((key) => key !== id)
							: [...new Set([...state.disabled, id])];
					},
					() => authorize(actor, "extensions.install"),
				);
				entry.view = frozen({
					...entry.view,
					generation: hash(entry.view.generation) + "-" + randomUUID(),
					phase: enabled ? "ready" : "disabled",
				});
			}),
		reload: (actor: PocketAuthority, id: string) =>
			lifecycle(async () => {
				authorize(actor, "extensions.install");
				const previous = accepted.get(id);
				if (!previous) return refuse("INVALID_REQUEST");
				const candidate = await prepare(previous.source);
				if (candidate.view.manifest.id !== id) return refuse("CONFLICT");
				collision(candidate, id);
				authorize(actor, "extensions.install");
				try {
					await initialize(candidate, () => authorize(actor, "extensions.install"), true);
					authorize(actor, "extensions.install");
				} catch (error) {
					if (candidate.loaded || candidate.faulted) {
						previous.faulted = true;
						previous.view = frozen({ ...previous.view, phase: "unknown" });
					}
					throw error;
				}
				const disabled = (await snapshot()).state.disabled.includes(id);
				authorize(actor, "extensions.install");
				candidate.view = frozen({ ...candidate.view, phase: disabled ? "disabled" : "ready" });
				accepted.set(id, candidate);
			}),
		asset: async (
			actor: PocketAuthority,
			id: string,
			generation: string,
			path: string,
			target?: ConversationRef,
		) => {
			authorize(actor, "read", target);
			const entry = entryFor(id, generation),
				asset = entry.assets.get(path);
			if (!asset) return refuse();
			if (hash(await file(entry.source.root, asset.path)) !== asset.hash) return refuse();
			authorize(actor, "read", target);
			entryFor(id, generation);
			return { type: asset.type, body: new Uint8Array(asset.body) };
		},
		call: async (
			actor: PocketAuthority,
			raw: ExtensionCall,
			signal?: AbortSignal,
		): Promise<ExtensionOperation> => {
			if (
				!isRecord(raw) ||
				Object.keys(raw).some(
					(key) => !["extension", "generation", "action", "requestId", "input", "target"].includes(key),
				) ||
				!extensionId(raw.extension) ||
				!extensionId(raw.action) ||
				!requestKey(raw.requestId) ||
				typeof raw.generation !== "string" ||
				(raw.target !== undefined && !reference(raw.target))
			)
				return refuse("INVALID_REQUEST");
			const input = structuredClone(raw),
				entry = entryFor(input.extension, input.generation),
				action = entry.view.manifest.actions.find((row) => row.id === input.action);
			if (
				!action ||
				!entry.view.facets.includes("backend") ||
				(action.scope === "conversation") !== !!input.target
			)
				return refuse("INVALID_REQUEST");
			const payload = decodeValue(action.input, input.input),
				person = current(actor),
				target = input.target ? frozen(input.target) : undefined;
			const check = () => {
				if (signal?.aborted) return refuse();
				entryFor(input.extension, input.generation);
				authorize(actor, action.permission, target);
			};
			check();
			const id =
					"operation-" +
					hash(
						JSON.stringify([input.extension, person.id, target?.conversationId ?? null, input.requestId]),
					).slice(0, 48),
				fingerprint = hash(JSON.stringify([entry.view.manifest.version, action, payload, target ?? null]));
			if (action.effect !== "read") {
				const prior = await update((state) => {
					const saved = state.operations.find((row) => row.id === id);
					if (saved) {
						if (saved.fingerprint !== fingerprint) return refuse("CONFLICT");
						return saved;
					}
					state.operations.push({
						id,
						extension: input.extension,
						action: input.action,
						actorId: person.id,
						requestId: input.requestId,
						fingerprint,
						permission: action.permission,
						target: target ?? null,
						state: "pending",
					});
					return null;
				}, check);
				if (prior) return present(prior);
			}
			const controller = new AbortController(),
				outerAbort = () => controller.abort();
			signal?.addEventListener("abort", outerAbort, { once: true });
			const liveCheck = () => {
				if (controller.signal.aborted) return refuse();
				check();
			};
			const scoped = (key: string, scope: "user" | "resource" | "global" = "user") => {
				liveCheck();
				if (!requestKey(key)) return refuse("INVALID_REQUEST");
				if (scope === "global") authorize(actor, "extensions.install");
				else if (scope === "resource") {
					if (!target) return refuse();
					authorize(actor, "read", target);
				} else if (scope !== "user") return refuse();
				return JSON.stringify([
					input.extension,
					scope,
					scope === "user" ? person.id : scope === "resource" ? target!.conversationId : "*",
					key,
				]);
			};
			const context: BackendContext = Object.freeze({
				person,
				...(target ? { target } : {}),
				requestId: id,
				signal: controller.signal,
				check: liveCheck,
				settings: {
					get: async (key: string, scope?: "user" | "resource" | "global"): Promise<ExtensionSetting> => {
						const name = scoped(key, scope),
							saved = (await snapshot()).state.settings.find((row) => row.key === name);
						scoped(key, scope);
						return frozen(
							saved ? { version: saved.version, value: saved.value } : { version: 0, value: null },
						);
					},
					compareAndSet: async (
						key: string,
						expectedVersion: number,
						value: ExtensionJson,
						scope?: "user" | "resource" | "global",
					): Promise<ExtensionSetting> => {
						const name = scoped(key, scope);
						if (
							action.effect === "read" ||
							!Number.isSafeInteger(expectedVersion) ||
							expectedVersion < 0 ||
							!jsonValue(value) ||
							Buffer.byteLength(JSON.stringify(value)) > 32768
						)
							return refuse("INVALID_REQUEST");
						return update(
							(state) => {
								const prior = state.settings.find((row) => row.key === name);
								if ((prior?.version ?? 0) !== expectedVersion) return refuse("CONFLICT");
								const saved = { key: name, version: expectedVersion + 1, value: structuredClone(value) };
								if (prior) Object.assign(prior, saved);
								else state.settings.push(saved);
								return frozen({ version: saved.version, value: saved.value });
							},
							() => {
								scoped(key, scope);
							},
						);
					},
				},
				display: async (kind: "chat" | "card", text: string) => {
					liveCheck();
					if (!target || action.effect === "read") return refuse();
					authorize(actor, "send", target);
					return workspace.bind(actor).display(target, { requestId: id, kind, text });
				},
				submit: async (message: {
					readonly text: string;
					readonly mode: "prompt" | "steer" | "followUp";
				}) => {
					liveCheck();
					if (!target || action.effect !== "model") return refuse();
					return workspace.bind(actor).submit(target, { requestId: id, ...message });
				},
				service: <T extends object = object>(name: string): T => {
					liveCheck();
					const service = options.services?.[name];
					if (!entry.view.manifest.services?.includes(name) || !service) return refuse();
					authorize(actor, service.permission, target);
					// SAFETY: trusted composition binds this named service; the extension supplies its own matching public port type.
					return service.bind(actor, target, liveCheck) as T;
				},
				jobs: {
					start: async (definition: string, payload: { readonly [key: string]: ExtensionJson }) => {
						liveCheck();
						if (!target || action.effect === "read" || !entry.view.manifest.jobs?.includes(definition))
							return refuse();
						return runtime
							.jobs({ namespace: "extension." + input.extension, maxJobs: 64, maxBytes: 262144 })
							.start(
								{ actorId: person.id, requestId: id, target, definition, payload: nativeData(payload) },
								liveCheck,
							);
					},
					receipt: async (jobId: string) => {
						liveCheck();
						const receipt = await runtime
							.jobs({ namespace: "extension." + input.extension, maxJobs: 64, maxBytes: 262144 })
							.receipt(jobId, liveCheck);
						if (receipt.actorId !== person.id || !target || !sameRef(receipt.target, target)) return refuse();
						return receipt;
					},
				},
			});
			Object.freeze(context.settings);
			Object.freeze(context.jobs);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const execute = Promise.resolve().then(() => {
					liveCheck();
					return entry.actions[action.id]!(context, payload);
				});
				const timeout = new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						controller.abort();
						reject(new Error("Extension deadline"));
					}, action.timeoutMs);
				});
				const result = await Promise.race([execute, timeout]);
				liveCheck();
				const value = decodeValue(action.output, result);
				if (action.effect === "read")
					return frozen({
						id,
						extension: input.extension,
						action: input.action,
						actorId: person.id,
						requestId: input.requestId,
						state: "done",
						value,
					});
				return await update((state) => {
					const saved = state.operations.find((row) => row.id === id);
					if (!saved || saved.state !== "pending") throw new Error("Unconfirmed extension transition");
					saved.state = "done";
					saved.value = value;
					return present(saved);
				}, liveCheck);
			} catch {
				if (action.effect !== "read")
					try {
						await update(
							(state) => {
								const saved = state.operations.find((row) => row.id === id);
								if (saved && saved.state === "pending") saved.state = "unknown";
							},
							() => {
								if (runtime.view().phase !== "ready") throw new Error("Unknown extension storage");
							},
						);
					} catch {
						/* The persistent pending record already forbids replay. */
					}
				return frozen({
					id,
					extension: input.extension,
					action: input.action,
					actorId: person.id,
					requestId: input.requestId,
					state: "unknown",
				});
			} finally {
				if (timer) clearTimeout(timer);
				controller.abort();
				signal?.removeEventListener("abort", outerAbort);
			}
		},
	});
}
