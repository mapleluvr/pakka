import { randomUUID } from "node:crypto";
import type { Runtime, JsonObject, ConversationRef } from "@pakka/agent";
import type { PocketAuthority, PocketPeople, PocketWorkspace } from "@pakka/server/pocket";
import {
	decodeSchema,
	decodeValue,
	extensionId,
	frozen,
	isRecord,
	publicPath,
} from "@pakka/protocol/extensions";
import type {
	ExtensionCall,
	ExtensionOperation,
	ExtensionOperationRequest,
	ExtensionJson,
	ExtensionFacet,
	ExtensionAction,
} from "@pakka/protocol/extensions";
import type {
	BackendContext,
	ExtensionHost,
	ExtensionService,
	ExtensionSetting,
	ExtensionIngress,
	ExtensionIngressRequest,
	ExtensionIngressResponse,
} from "./backend.ts";
import { createFacetLifecycle } from "./extension-lifecycle.ts";
import { facetKey, hash, refuse } from "./extension-source.ts";
import type { ExtensionSource } from "./extension-source.ts";
export { ExtensionRefusal } from "./extension-source.ts";
export type { ExtensionSource } from "./extension-source.ts";

export interface ExtensionHostOptions {
	readonly runtime: Runtime;
	readonly runtimeFor?: (target: Pick<ConversationRef, "sessionId">) => Runtime;
	readonly people: PocketPeople;
	readonly workspace: PocketWorkspace;
	readonly sources: readonly ExtensionSource[];
	readonly services?: Readonly<Record<string, ExtensionService>>;
	/** Bounds asynchronous trusted module initialization; not a sandbox for synchronous plugin code. */
	readonly initializationTimeoutMs?: number;
}
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
	schema: 1 | 2;
	operations: Saved[];
	settings: SettingsRow[];
	disabled: string[];
	initializations: Initialization[];
};
const requestKey = (value: unknown): value is string =>
	typeof value === "string" && /^[a-zA-Z0-9][-a-zA-Z0-9._:]{0,159}$/.test(value);

const sameRef = (a: ConversationRef, b: ConversationRef) =>
	["key", "sessionId", "conversationId", "incarnation", "profile"].every(
		(key) => a[key as keyof ConversationRef] === b[key as keyof ConversationRef],
	);
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
function decodeOperation(item: unknown): Saved {
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
	// SAFETY: every operation field and its optional value are validated above.
	return structuredClone(item) as Saved;
}

function decodeState(data: JsonObject, version: number): State {
	if (!version) {
		if (Object.keys(data).length) throw new Error("Unconfirmed extension store");
		return { schema: 1, operations: [], settings: [], disabled: [], initializations: [] };
	}
	if (
		(data.schema !== 1 && data.schema !== 2) ||
		(data.schema === 2 && (!Array.isArray(data.operations) || data.operations.length > 0)) ||
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
	for (const item of data.operations) decodeOperation(item);
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
/** Trusted product composition. Extensions receive only the bound BackendContext, never these owner ports. */
export async function createExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
	const { runtime, people, workspace } = options;
	if (!Array.isArray(options.sources) || options.sources.length > 64) return refuse("INVALID_REQUEST");
	const ingressServices = new Map<string, ExtensionIngress>();
	for (const [name, service] of Object.entries(options.services ?? {})) {
		const raw = service.ingress;
		if (!raw) continue;
		if (
			!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(name) ||
			Object.keys(raw).some((key) => !["maxBytes", "timeoutMs", "output", "handle"].includes(key)) ||
			!Number.isSafeInteger(raw.maxBytes) ||
			raw.maxBytes < 1 ||
			raw.maxBytes > 5 * 1024 * 1024 ||
			!Number.isSafeInteger(raw.timeoutMs) ||
			raw.timeoutMs < 50 ||
			raw.timeoutMs > 30000 ||
			typeof raw.handle !== "function"
		)
			return refuse("INVALID_REQUEST");
		ingressServices.set(
			name,
			Object.freeze({
				maxBytes: raw.maxBytes,
				timeoutMs: raw.timeoutMs,
				output: decodeSchema(structuredClone(raw.output)),
				handle: raw.handle,
			}),
		);
	}
	const store = runtime.store({ namespace: "pocket.extensions", maxBytes: 1048576 });
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
	const operations = runtime.records({ namespace: "pocket.extension-operations" });
	const initial = await snapshot();
	if (initial.state.schema === 1) {
		for (const operation of initial.state.operations) {
			await operations.commit(
				{
					requestId: "legacy:" + operation.id,
					reads: [{ key: operation.id, version: 0 }],
					writes: [{ key: operation.id, data: nativeData(operation) }],
					append: [],
					work: [{ key: operation.id, state: operation.state === "done" ? null : operation.state }],
				},
				() => {},
			);
		}
		await update(
			(state) => {
				state.schema = 2;
				state.operations = [];
			},
			() => {},
		);
	}
	const findOperation = async (id: string, check: () => void) => {
		const record = await operations.get(id, check);
		const value = record.data ? decodeOperation(record.data) : null;
		if (value && value.id !== id) throw Error("Extension operation identity mismatch");
		return { version: record.version, value };
	};
	const updateOperation = <T>(
		id: string,
		effect: (row: { value: Saved | null }) => T,
		check: () => void,
	): Promise<T> =>
		serial(async () => {
			for (let attempt = 0; attempt < 4; attempt++) {
				const before = await findOperation(id, check),
					draft = { value: structuredClone(before.value) };
				check();
				const result = effect(draft);
				if (draft.value && JSON.stringify(draft.value) !== JSON.stringify(before.value)) {
					try {
						await operations.commit(
							{
								// A replayed receipt is not a fresh right to invoke the handler.
								requestId: id + ":" + randomUUID(),
								reads: [{ key: id, version: before.version }],
								writes: [{ key: id, data: nativeData(draft.value) }],
								append: [],
								work: [{ key: id, state: draft.value.state === "done" ? null : draft.value.state }],
							},
							check,
						);
					} catch (error) {
						if (
							error instanceof Error &&
							error.name === "RecordsRequestRefusedError" &&
							"code" in error &&
							error.code === "conflict"
						)
							continue;
						throw error;
					}
				}
				check();
				return result;
			}
			return refuse("CONFLICT");
		});
	const operationId = (
		extension: string,
		actorId: string,
		target: ConversationRef | null | undefined,
		requestId: string,
	) =>
		"operation-" +
		hash(
			JSON.stringify([
				extension,
				actorId,
				target ? [target.sessionId, target.conversationId] : null,
				requestId,
			]),
		).slice(0, 48);
	const originalOperation = async (
		extension: string,
		actorId: string,
		target: ConversationRef | undefined,
		requestId: string,
		check: () => void,
	): Promise<Saved | null> => {
		const id = operationId(extension, actorId, target, requestId),
			current = (await findOperation(id, check)).value;
		if (current || !target) return current;
		// Preserve the handler identity of already admitted operations. Reading an old record never migrates or replays it.
		const legacyId =
			"operation-" +
			hash(JSON.stringify([extension, actorId, target.conversationId, requestId])).slice(0, 48);
		const legacy = (await findOperation(legacyId, check)).value;
		return legacy?.target?.sessionId === target.sessionId &&
			legacy.target.conversationId === target.conversationId
			? legacy
			: null;
	};
	const facets = await createFacetLifecycle({
		runtime,
		people,
		sources: options.sources,
		legacy: initial.state,
		hasService: (name) => Object.hasOwn(options.services ?? {}, name),
		initializationTimeoutMs: options.initializationTimeoutMs,
	});
	const accepted = facets.entries;
	const current = (actor: PocketAuthority) => {
		facets.live();
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
			try {
				const source = options.runtimeFor?.(target) ?? runtime;
				if (!source.view().conversations.some((ref) => sameRef(ref, target))) return refuse();
				people.check(actor, permission, people.resourceId(target));
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
	// Original receipts keep their full target for correlation, but do not execute that old incarnation.
	// Recheck the same currently loaded Session/Conversation and the recorded permission.
	const authorizeReceipt = (
		actor: PocketAuthority,
		permission: ExtensionAction["permission"],
		target?: ConversationRef,
	) => {
		if (!target) return authorize(actor, permission);
		current(actor);
		try {
			const source = options.runtimeFor?.(target) ?? runtime;
			const ref = source
				.view()
				.conversations.find(
					(row) => row.sessionId === target.sessionId && row.conversationId === target.conversationId,
				);
			if (!ref) return refuse();
			people.check(actor, permission, people.resourceId(ref));
		} catch {
			return refuse();
		}
	};
	const entryFor = (id: string, facet: ExtensionFacet, generation?: string) => {
		facets.live();
		const entry = accepted.get(facetKey(id, facet));
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
			saved = (await findOperation(id, () => current(actor))).value;
		if (!saved || saved.actorId !== person.id) return refuse();
		authorizeReceipt(actor, saved.permission, saved.target ?? undefined);
		return present(saved);
	};
	return Object.freeze({
		ingress: (extension: string, service: string) => {
			const entry = entryFor(extension, "backend"),
				route = ingressServices.get(service),
				generation = entry.view.generation;
			if (!route || entry.view.facet !== "backend" || !entry.view.manifest.services?.includes(service))
				return refuse("UNSUPPORTED");
			return Object.freeze({
				maxBytes: route.maxBytes,
				handle: async (
					request: Omit<ExtensionIngressRequest, "check">,
				): Promise<ExtensionIngressResponse> => {
					if (
						!request ||
						!(request.body instanceof Uint8Array) ||
						request.body.length > route.maxBytes ||
						!Array.isArray(request.path) ||
						request.path.length > 4 ||
						request.path.some((part) => typeof part !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(part)) ||
						!isRecord(request.headers) ||
						Object.keys(request.headers).length > 64 ||
						Object.entries(request.headers).some(
							([key, value]) =>
								!/^[a-z0-9-]{1,80}$/.test(key) || typeof value !== "string" || value.length > 8192,
						)
					)
						return refuse("INVALID_REQUEST");
					const controller = new AbortController();
					let rejectStopped!: (error: Error) => void;
					const stopped = new Promise<never>((_resolve, reject) => {
						rejectStopped = reject;
					});
					const abort = () => {
						controller.abort();
						rejectStopped(Error("Incoming operation outcome unconfirmed"));
					};
					request.signal.addEventListener("abort", abort, { once: true });
					const timer = setTimeout(abort, route.timeoutMs);
					const check = () => {
						if (controller.signal.aborted || request.signal.aborted || runtime.view().phase !== "ready")
							return refuse();
						entryFor(extension, "backend", generation);
					};
					try {
						check();
						const headers = Object.freeze(
							Object.fromEntries(
								Object.entries(request.headers).filter(
									([key]) => !["cookie", "x-pakka-csrf", "proxy-authorization"].includes(key),
								),
							),
						);
						const context = Object.freeze({
							path: Object.freeze([...request.path]),
							headers,
							body: new Uint8Array(request.body),
							signal: controller.signal,
							check,
						});
						const response = await Promise.race([
							Promise.resolve().then(() => {
								check();
								return route.handle(context);
							}),
							stopped,
						]);
						check();
						if (
							!isRecord(response) ||
							Object.keys(response).some((key) => !["status", "value"].includes(key)) ||
							![200, 202, 400, 401, 403, 404, 409, 413, 429, 500, 503].includes(response.status)
						)
							throw Error("Invalid bounded incoming result");
						const value = decodeValue(route.output, response.value);
						if (Buffer.byteLength(JSON.stringify(value)) > 262144)
							throw Error("Incoming output capacity exceeded");
						check();
						return Object.freeze({ status: response.status, value });
					} finally {
						clearTimeout(timer);
						request.signal.removeEventListener("abort", abort);
						controller.abort();
					}
				},
			});
		},
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
					// Declarations remain discoverable while disabled so known commands cannot
					// fall through to ordinary model input. Invocation still checks phase.
					const actions = entry.view.facet === "backend" ? manifest.actions.filter(can) : [],
						interfaces =
							entry.view.facet === "webui"
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
		operationByRequest: async (
			actor: PocketAuthority,
			request: ExtensionOperationRequest,
		): Promise<ExtensionOperation> => {
			const person = current(actor);
			if (
				!isRecord(request) ||
				!extensionId(request.extension) ||
				!requestKey(request.requestId) ||
				Object.keys(request).some((key) => !["extension", "requestId", "target"].includes(key))
			)
				return refuse("INVALID_REQUEST");
			authorizeReceipt(actor, "read", request.target);
			const saved = await originalOperation(
				request.extension,
				person.id,
				request.target,
				request.requestId,
				() => current(actor),
			);
			if (
				!saved ||
				saved.extension !== request.extension ||
				saved.actorId !== person.id ||
				saved.requestId !== request.requestId ||
				(saved.target ? !request.target || !sameRef(saved.target, request.target) : !!request.target)
			)
				return refuse();
			authorizeReceipt(actor, saved.permission, saved.target ?? undefined);
			return present(saved);
		},
		control: facets.control,
		controlByRequest: facets.controlByRequest,
		close: facets.close,
		asset: async (
			actor: PocketAuthority,
			id: string,
			facet: "webui" | "client",
			generation: string,
			path: string,
			target?: ConversationRef,
		) => {
			if (!["webui", "client"].includes(facet) || !publicPath(path)) return refuse("INVALID_REQUEST");
			authorize(actor, "read", target);
			const entry = entryFor(id, facet, generation),
				asset = entry.assets.get(path);
			if (!asset) return refuse();
			// Serve the admitted immutable snapshot, never different on-disk bytes under an existing generation.
			authorize(actor, "read", target);
			entryFor(id, facet, generation);
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
				entry = entryFor(input.extension, "backend", input.generation),
				action = entry.view.manifest.actions.find((row) => row.id === input.action);
			if (!action || entry.view.facet !== "backend" || (action.scope === "conversation") !== !!input.target)
				return refuse("INVALID_REQUEST");
			const payload = decodeValue(action.input, input.input),
				person = current(actor),
				target = input.target ? frozen(input.target) : undefined;
			const check = () => {
				if (signal?.aborted) return refuse();
				entryFor(input.extension, "backend", input.generation);
				authorize(actor, action.permission, target);
			};
			check();
			const id = operationId(input.extension, person.id, target, input.requestId),
				fingerprint = hash(JSON.stringify([entry.view.manifest.version, action, payload, target ?? null]));
			if (action.effect !== "read") {
				const existing = await originalOperation(input.extension, person.id, target, input.requestId, check);
				if (existing) {
					if (existing.fingerprint !== fingerprint) return refuse("CONFLICT");
					check();
					return present(existing);
				}
				const prior = await updateOperation(
					id,
					(row) => {
						const saved = row.value;
						if (saved) {
							if (saved.fingerprint !== fingerprint) return refuse("CONFLICT");
							return saved;
						}
						row.value = {
							id,
							extension: input.extension,
							action: input.action,
							actorId: person.id,
							requestId: input.requestId,
							fingerprint,
							permission: action.permission,
							target: target ?? null,
							state: "pending",
						};
						return null;
					},
					check,
				);
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
					scope === "user" ? person.id : scope === "resource" ? people.resourceId(target!) : "*",
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
					const service = Object.hasOwn(options.services ?? {}, name) ? options.services![name] : undefined;
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
				return await updateOperation(
					id,
					(row) => {
						const saved = row.value;
						if (!saved || saved.state !== "pending") throw new Error("Unconfirmed extension transition");
						saved.state = "done";
						saved.value = value;
						return present(saved);
					},
					liveCheck,
				);
			} catch {
				if (action.effect !== "read")
					try {
						await updateOperation(
							id,
							(row) => {
								const saved = row.value;
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
