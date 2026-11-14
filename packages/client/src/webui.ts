import {
	decodeWebUiRequest,
	decodeWebUiResponse,
	WEBUI_SERVICE_MAX_BYTES,
	WEBUI_SERVICE_PATH,
	type WebUiCommand,
	type WebUiResult,
	type WebUiResults,
} from "@pakka/protocol/webui";
import { PocketRemoteError, type PocketClientOptions, type PocketRequestOptions } from "./pocket.ts";
import { identity } from "@pakka/protocol";
export type * from "@pakka/protocol/webui";

export interface WebUiServiceClient {
	request<C extends WebUiCommand>(command: C, options?: PocketRequestOptions): Promise<WebUiResults[C["op"]]>;
}
const kinds: { readonly [K in keyof WebUiResults]: WebUiResults[K]["kind"] } = {
	capabilities: "capabilities",
	"resource.resolve": "resource",
	"model-connections.read": "model-configuration",
	"model-connections.reload": "model-reload",
	"model-connections.validate": "model-validation",
	"model-connections.write": "model-configuration-receipt",
	"model-connections.lookup": "model-configuration-operation",
	"model-catalog.read": "model-catalog",
	"model-catalog.refresh": "model-catalog-refresh",
	"model-defaults.read": "model-defaults",
	"model-defaults.write": "model-defaults-receipt",
	"model-defaults.lookup": "model-defaults-operation",
};
function correlate(command: WebUiCommand, result: WebUiResult, personId: string | null): boolean {
	if (kinds[command.op] !== result.kind) return false;
	if (command.op === "resource.resolve" && result.kind === "resource")
		return (
			result.resolution.reference.sessionId === command.reference.sessionId &&
			result.resolution.reference.conversationId === command.reference.conversationId
		);
	if (command.op === "model-connections.write" || command.op === "model-connections.lookup") {
		const original = command.op === "model-connections.write" ? command.change : command.original;
		if (result.kind !== "model-configuration-receipt" && result.kind !== "model-configuration-operation")
			return false;
		return (
			result.receipt === null ||
			(result.receipt.requestId === original.requestId && (!personId || result.receipt.actorId === personId))
		);
	}
	if (command.op === "model-defaults.write" || command.op === "model-defaults.lookup") {
		const original = command.op === "model-defaults.write" ? command.change : command.original;
		if (result.kind !== "model-defaults-receipt" && result.kind !== "model-defaults-operation") return false;
		return (
			result.receipt === null ||
			(result.receipt.requestId === original.requestId &&
				(!personId || result.receipt.actorId === personId) &&
				result.receipt.defaults.version === original.expectedVersion + 1 &&
				result.receipt.defaults.thinkingLevel === original.thinkingLevel &&
				result.receipt.defaults.model?.provider === original.model?.provider &&
				result.receipt.defaults.model?.id === original.model?.id)
		);
	}
	if (command.op === "model-catalog.read" && result.kind === "model-catalog")
		return (
			(command.query.revision === undefined || command.query.revision === result.page.revision) &&
			result.page.models.length <= (command.query.limit ?? 50) &&
			result.page.models.every(
				(item) =>
					(!command.query.type || item.type === command.query.type) &&
					(!command.query.provider || item.provider === command.query.provider),
			)
		);
	return true;
}
async function readBody(response: Response): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing service response");
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let body = "",
		bytes = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > WEBUI_SERVICE_MAX_BYTES) {
				await reader.cancel();
				throw new Error("Service response capacity exceeded");
			}
			body += decoder.decode(chunk.value, { stream: true });
		}
		return JSON.parse(body + decoder.decode());
	} finally {
		reader.releaseLock();
	}
}
/** Inert until explicitly called. Cookie/CSRF are supplied by the host; writes are never retried. */
export function createWebUiServiceClient(
	options: PocketClientOptions & {
		readonly personId: () => string | null;
		readonly serverId: () => string | null;
	},
): WebUiServiceClient {
	let endpoint: URL;
	try {
		endpoint = new URL(options.endpoint);
	} catch {
		throw new Error("Invalid WebUI service endpoint");
	}
	if (
		!["http:", "https:"].includes(endpoint.protocol) ||
		endpoint.pathname !== WEBUI_SERVICE_PATH ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash ||
		(typeof globalThis.location !== "undefined" && globalThis.location.origin !== endpoint.origin)
	)
		throw new Error("Explicit same-origin WebUI service endpoint required");
	const timeoutMs = options.timeoutMs ?? 10000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
		throw new Error("Invalid service deadline");
	async function request<C extends WebUiCommand>(
		command: C,
		input: PocketRequestOptions = {},
	): Promise<WebUiResults[C["op"]]> {
		const requestId = input.requestId ?? globalThis.crypto.randomUUID();
		if (input.signal?.aborted) throw new PocketRemoteError("FORBIDDEN", "denied", requestId);
		const personId = options.personId();
		const expectedServer = options.serverId();
		if (!identity(personId) || !identity(expectedServer))
			throw new PocketRemoteError("FORBIDDEN", "denied", requestId);
		const encoded = decodeWebUiRequest({
			api: 1,
			requestId,
			binding: { personId, serverId: expectedServer },
			command,
		});
		const controller = new AbortController(),
			abort = () => controller.abort();
		input.signal?.addEventListener("abort", abort, { once: true });
		const timeout = setTimeout(abort, timeoutMs);
		try {
			const csrf = options.csrf?.() ?? null;
			if (csrf !== null && !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new Error("Invalid CSRF binding");
			const response = await fetch(endpoint.href, {
				method: "POST",
				credentials: "same-origin",
				redirect: "error",
				cache: "no-store",
				headers: { "Content-Type": "application/json", ...(csrf ? { "X-Pakka-CSRF": csrf } : {}) },
				body: JSON.stringify(encoded),
				signal: controller.signal,
			});
			const decoded = decodeWebUiResponse(await readBody(response), requestId);
			if (
				decoded.serverId !== expectedServer ||
				options.serverId() !== expectedServer ||
				options.personId() !== personId
			)
				throw new Error("Service identity changed");
			if ("error" in decoded)
				throw new PocketRemoteError(decoded.error.code, decoded.error.outcome, requestId);
			if (!response.ok || !correlate(command, decoded.result, personId))
				throw new Error("Uncorrelated service result");
			// SAFETY: the closed result decoder and correlate checked the command's exact result kind and identities.
			return decoded.result as WebUiResults[C["op"]];
		} catch (error) {
			if (error instanceof PocketRemoteError) throw error;
			throw new PocketRemoteError("UNKNOWN", "unknown", requestId);
		} finally {
			clearTimeout(timeout);
			input.signal?.removeEventListener("abort", abort);
		}
	}
	return Object.freeze({ request });
}
