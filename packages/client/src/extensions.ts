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
} from "@pakka/protocol/extensions";
import { decodeExtensionRequest, decodeExtensionResponse } from "@pakka/protocol/extension-rpc";
import type { ExtensionCommandEnvelope, ExtensionResult } from "@pakka/protocol/extension-rpc";

export interface ExtensionClient {
	/** Exact public asset URL with complete Session/Conversation identity; no authority is granted. */
	assetUrl(
		extension: string,
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
	control(
		extension: string,
		action: "enable" | "disable" | "reload",
		options?: PocketRequestOptions,
	): Promise<void>;
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
			encoded = decodeExtensionRequest({ version: 2, requestId, command });
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
			generation: string,
			path: string,
			target?: Pick<AgentRef, "sessionId" | "conversationId">,
		) => {
			if (
				!extensionId(extension) ||
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
				`${independent ? "/pakka-webui" : "/pocket"}/extensions/assets/${extension}/${generation}/${scope}${path}`,
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
			for (const item of result.registrations) declarations.set(item.manifest.id, item);
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
			const action = declarations.get(call.extension)?.manifest.actions.find((row) => row.id === call.action);
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
		control: async (
			extension: string,
			action: "enable" | "disable" | "reload",
			input: PocketRequestOptions = {},
		) => {
			const result = await request({ op: action, extension }, input);
			if (result.kind !== "updated") return unknown(input.requestId);
			declarations.delete(extension);
		},
	});
}
