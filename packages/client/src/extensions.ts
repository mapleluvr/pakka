import { PocketRemoteError } from "./pocket.ts";
import { identity } from "@pakka/protocol";
import type { PocketClientOptions, PocketRequestOptions } from "./pocket.ts";
import type { AgentRef } from "@pakka/protocol/pocket";
import { decodeValue, extensionId, publicPath } from "@pakka/protocol/extensions";
import type {
	ExtensionCall,
	ExtensionOperation,
	ExtensionOperationRequest,
	ExtensionRegistration,
	ExtensionFacetControl,
	ExtensionControlIdentity,
	ExtensionControlReceipt,
} from "@pakka/protocol/extensions";
import {
	decodeExtensionRequest,
	decodeExtensionResponse,
	EXTENSION_VERSION,
} from "@pakka/protocol/extension-rpc";
import type { ExtensionCommandEnvelope, ExtensionResult } from "@pakka/protocol/extension-rpc";

export interface ExtensionClient {
	/** Exact public asset URL with complete Session/Conversation identity; no authority is granted. */
	assetUrl(
		extension: string,
		facet: "webui" | "client",
		generation: string,
		path: string,
		target?: Pick<AgentRef, "sessionId" | "conversationId">,
	): string;
	list(target?: AgentRef, options?: PocketRequestOptions): Promise<readonly ExtensionRegistration[]>;
	call(input: ExtensionCall, options?: PocketRequestOptions): Promise<ExtensionOperation>;
	operation(id: string, options?: PocketRequestOptions): Promise<ExtensionOperation>;
	operationByRequest(
		request: ExtensionOperationRequest,
		options?: PocketRequestOptions,
	): Promise<ExtensionOperation>;
	control(change: ExtensionFacetControl, options?: PocketRequestOptions): Promise<ExtensionControlReceipt>;
	/** Queries only: null/unknown never authorizes replay of a control. */
	controlByRequest(
		original: ExtensionControlIdentity,
		options?: PocketRequestOptions,
	): Promise<ExtensionControlReceipt | null>;
}
/** A Backend service binding, separate from UI instance operations and Client-facet module loading. */
export interface ExtensionServiceBinding {
	readonly extensionId: string;
	readonly personId: string;
	/** Current HTTP handshake identity; not a persistent business receipt identity. */
	readonly serverId: string;
	readonly target?: AgentRef;
	readonly signal: AbortSignal;
	/** Select an explicit Conversation for this extension. Authority remains with the server; UI lifetime is inherited. */
	forConversation(target: AgentRef, options?: Pick<PocketRequestOptions, "signal">): ExtensionServiceBinding;
	call(
		action: string,
		input?: import("@pakka/protocol/extensions").ExtensionJson,
		options?: PocketRequestOptions,
	): Promise<ExtensionOperation>;
	operation(id: string, options?: PocketRequestOptions): Promise<ExtensionOperation>;
	operationByRequest(requestId: string, options?: PocketRequestOptions): Promise<ExtensionOperation>;
}

/** Bind an already checked client. New calls read the current Backend publication; receipt queries do not depend on its phase/generation. */
export function bindExtensionService(
	client: ExtensionClient,
	input: {
		readonly extensionId: string;
		readonly personId: string;
		readonly serverId: string;
		readonly target?: AgentRef;
		readonly signal: AbortSignal;
		readonly backend: () => ExtensionRegistration | undefined;
	},
): ExtensionServiceBinding {
	if (!extensionId(input.extensionId) || !identity(input.personId) || !identity(input.serverId))
		throw new Error("Invalid extension service identity");
	const extension = input.extensionId;
	let target: AgentRef | undefined;
	if (input.target) {
		const command = decodeExtensionRequest({
			version: EXTENSION_VERSION,
			requestId: "service-binding",
			command: { op: "list", target: input.target },
		}).command;
		if (command.op !== "list" || !command.target) throw new Error("Invalid Conversation binding");
		target = Object.freeze({ ...command.target });
	}
	const optionsFor = (options: PocketRequestOptions = {}): PocketRequestOptions => ({
		...options,
		signal: AbortSignal.any([input.signal, ...(options.signal ? [options.signal] : [])]),
	});
	async function correlated(result: Promise<ExtensionOperation>) {
		const operation = await result;
		if (operation.extension !== extension || operation.actorId !== input.personId)
			throw new PocketRemoteError("UNKNOWN", "unknown", operation.requestId);
		return operation;
	}
	return Object.freeze<ExtensionServiceBinding>({
		extensionId: extension,
		personId: input.personId,
		serverId: input.serverId,
		target,
		signal: input.signal,
		forConversation(ref, options = {}) {
			return bindExtensionService(client, {
				...input,
				target: ref,
				signal: optionsFor(options).signal!,
			});
		},
		call(action, value = {}, options = {}) {
			const requestId = options.requestId ?? globalThis.crypto.randomUUID();
			const backend = input.backend();
			if (
				input.signal.aborted ||
				options.signal?.aborted ||
				backend?.facet !== "backend" ||
				backend.manifest.id !== extension ||
				backend.phase !== "ready"
			)
				return Promise.reject(new PocketRemoteError("UNSUPPORTED", "denied", requestId));
			return correlated(
				client.call(
					{
						extension,
						generation: backend.generation,
						action,
						input: value,
						requestId,
						...(target ? { target } : {}),
					},
					optionsFor({ ...options, requestId }),
				),
			);
		},
		operation(id, options) {
			return correlated(client.operation(id, optionsFor(options)));
		},
		operationByRequest(requestId, options) {
			return correlated(
				client.operationByRequest(
					{ extension, requestId, ...(target ? { target } : {}) },
					optionsFor(options),
				),
			);
		},
	});
}

/** Explicit same-origin capability client; reads no token/configuration at import and never retries a mutation. */
export function createExtensionClient(
	options: PocketClientOptions & {
		readonly personId?: () => string | null;
		readonly serverId?: () => string | null;
	},
): ExtensionClient {
	let endpoint: URL;
	try {
		endpoint = new URL(options.endpoint);
	} catch {
		throw new Error("Invalid extension endpoint");
	}
	if (
		!["http:", "https:"].includes(endpoint.protocol) ||
		!["/pocket/extensions/rpc", "/pakka-webui/extensions/rpc"].includes(endpoint.pathname) ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash ||
		(typeof globalThis.location !== "undefined" && globalThis.location.origin !== endpoint.origin)
	)
		throw new Error("Explicit same-origin extension endpoint required");
	const timeoutMs = options.timeoutMs ?? 10000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
		throw new Error("Invalid finite extension deadline");
	const url = endpoint.href;
	const independent = endpoint.pathname === "/pakka-webui/extensions/rpc";
	let serverId: string | undefined;
	const declarations = new Map<string, ExtensionRegistration>();
	async function request(
		command: ExtensionCommandEnvelope,
		input: PocketRequestOptions = {},
	): Promise<ExtensionResult> {
		const requestId = input.requestId ?? globalThis.crypto.randomUUID(),
			encoded = decodeExtensionRequest({ version: EXTENSION_VERSION, requestId, command });
		const personId = options.personId?.() ?? null;
		const expectedServer = options.serverId?.() ?? serverId;
		if (input.signal?.aborted || (independent && (!identity(personId) || !identity(expectedServer))))
			throw new PocketRemoteError("FORBIDDEN", "denied", requestId);
		const controller = new AbortController(),
			abort = () => controller.abort();
		input.signal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(abort, timeoutMs);
		try {
			const csrf = options.csrf?.() ?? null;
			if (csrf !== null && !/^[a-zA-Z0-9_-]{43}$/.test(csrf))
				throw new Error("Invalid extension CSRF binding");
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(csrf ? { "X-Pakka-CSRF": csrf } : {}),
					...(independent ? { "X-Pakka-Person": personId!, "X-Pakka-Server": expectedServer! } : {}),
				},
				body: JSON.stringify(encoded),
				credentials: "same-origin",
				cache: "no-store",
				redirect: "error",
				signal: controller.signal,
			});
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Missing extension body");
			const decoder = new TextDecoder("utf-8", { fatal: true });
			let text = "",
				bytes = 0;
			try {
				for (;;) {
					const chunk = await reader.read();
					if (chunk.done) break;
					bytes += chunk.value.byteLength;
					if (bytes > 2097152) {
						await reader.cancel();
						throw new Error("Extension response capacity");
					}
					text += decoder.decode(chunk.value, { stream: true });
				}
				text += decoder.decode();
			} finally {
				reader.releaseLock();
			}
			let raw: unknown;
			try {
				raw = JSON.parse(text);
			} catch {
				throw new Error("Malformed extension JSON");
			}
			const decoded = decodeExtensionResponse(raw, requestId);
			if (
				(expectedServer && decoded.serverId !== expectedServer) ||
				(options.personId && options.personId() !== personId) ||
				(options.serverId && options.serverId() !== expectedServer)
			)
				throw new Error("Changed extension binding");
			if ("error" in decoded)
				throw new PocketRemoteError(decoded.error.code, decoded.error.outcome, requestId);
			if (!response.ok) throw new Error("Unconfirmed extension status");
			serverId = decoded.serverId;
			return decoded.result;
		} catch (error) {
			if (error instanceof PocketRemoteError) throw error;
			throw new PocketRemoteError("UNKNOWN", "unknown", requestId);
		} finally {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", abort);
		}
	}
	const unknown = (requestId?: string): never => {
		throw new PocketRemoteError("UNKNOWN", "unknown", requestId ?? "unconfirmed");
	};
	const correlated = (operation: ExtensionOperation, input: PocketRequestOptions) => {
		const personId = options.personId?.();
		if (personId && operation.actorId !== personId) unknown(input.requestId);
		return operation;
	};
	return Object.freeze({
		assetUrl: (
			extension: string,
			facet: "webui" | "client",
			generation: string,
			path: string,
			target?: Pick<AgentRef, "sessionId" | "conversationId">,
		) => {
			if (
				!extensionId(extension) ||
				(facet !== "webui" && facet !== "client") ||
				!identity(generation) ||
				!publicPath(path) ||
				(target && (!identity(target.sessionId) || !identity(target.conversationId)))
			)
				throw new Error("Invalid extension asset reference");
			const scope = independent
				? target
					? `conversation/${encodeURIComponent(target.sessionId)}/${encodeURIComponent(target.conversationId)}/`
					: "app/"
				: "";
			const asset = new URL(
				`${independent ? "/pakka-webui" : "/pocket"}/extensions/assets/${extension}/${facet}/${generation}/${scope}${path}`,
				endpoint,
			);
			if (target && !independent) {
				asset.searchParams.set("sessionId", target.sessionId);
				asset.searchParams.set("conversationId", target.conversationId);
			}
			return asset.href;
		},
		list: async (target?: AgentRef, input: PocketRequestOptions = {}) => {
			const result = await request({ op: "list", ...(target ? { target } : {}) }, input);
			if (result.kind !== "registrations") return unknown(input.requestId);
			declarations.clear();
			for (const item of result.registrations)
				if (item.facet === "backend") declarations.set(item.manifest.id + ":" + item.generation, item);
			return result.registrations;
		},
		call: async (call: ExtensionCall, input: PocketRequestOptions = {}) => {
			const result = await request({ op: "call", call }, input);
			if (
				result.kind !== "operation" ||
				result.operation.extension !== call.extension ||
				result.operation.action !== call.action ||
				result.operation.requestId !== call.requestId
			)
				return unknown(input.requestId);
			const action = declarations
				.get(call.extension + ":" + call.generation)
				?.manifest.actions.find((row) => row.id === call.action);
			if (result.operation.state === "done" && action) {
				try {
					decodeValue(action.output, result.operation.value);
				} catch {
					return unknown(input.requestId);
				}
			}
			return correlated(result.operation, input);
		},
		operation: async (id: string, input: PocketRequestOptions = {}) => {
			const result = await request({ op: "operation", id }, input);
			if (result.kind !== "operation" || result.operation.id !== id) return unknown(input.requestId);
			return correlated(result.operation, input);
		},
		operationByRequest: async (original: ExtensionOperationRequest, input: PocketRequestOptions = {}) => {
			const result = await request({ op: "operationByRequest", request: original }, input);
			if (
				result.kind !== "operation" ||
				result.operation.extension !== original.extension ||
				result.operation.requestId !== original.requestId
			)
				return unknown(input.requestId);
			return correlated(result.operation, input);
		},
		control: async (change: ExtensionFacetControl, input: PocketRequestOptions = {}) => {
			const result = await request(
				{ op: "control", change },
				{ ...input, requestId: input.requestId ?? change.requestId },
			);
			if (
				result.kind !== "control" ||
				result.receipt.extension !== change.extension ||
				result.receipt.facet !== change.facet ||
				result.receipt.requestId !== change.requestId ||
				result.receipt.action !== change.action ||
				result.receipt.expectedGeneration !== change.expectedGeneration ||
				(options.personId && result.receipt.actorId !== options.personId())
			)
				return unknown(input.requestId ?? change.requestId);
			if (change.facet === "backend")
				for (const [key, row] of declarations)
					if (row.manifest.id === change.extension) declarations.delete(key);
			return result.receipt;
		},
		controlByRequest: async (original: ExtensionControlIdentity, input: PocketRequestOptions = {}) => {
			const result = await request({ op: "controlByRequest", original }, input);
			if (result.kind !== "control-operation") return unknown(input.requestId);
			const receipt = result.receipt;
			if (
				receipt &&
				(receipt.extension !== original.extension ||
					receipt.facet !== original.facet ||
					receipt.requestId !== original.requestId ||
					(options.personId && receipt.actorId !== options.personId()))
			)
				return unknown(input.requestId);
			return receipt;
		},
	});
}
