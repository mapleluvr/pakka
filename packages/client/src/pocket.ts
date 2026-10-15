import { decodePocketRequest, decodePocketResponse, POCKET_MAX_BYTES } from "@pakka/protocol/pocket";
import { identity } from "@pakka/protocol";
import type { AgentRef, PocketCommand, PocketResult, PocketErrorCode } from "@pakka/protocol/pocket";
export type * from "@pakka/protocol/pocket";
export interface PocketClientOptions {
	readonly endpoint: string;
	/** Supplied by the product's cookie binding; never discovers credentials or reads browser state at import. */
	readonly csrf?: () => string | null;
	readonly timeoutMs?: number;
}
export interface PocketRequestOptions {
	readonly requestId?: string;
	readonly signal?: AbortSignal;
}
export type PocketClientResult = PocketResult & { readonly serverId: string; readonly rpcRequestId: string };
export interface PocketClient {
	request(command: PocketCommand, options?: PocketRequestOptions): Promise<PocketClientResult>;
	/** Explicit fresh authorization read. Does not replay any earlier command. */
	reconnect(options?: PocketRequestOptions): Promise<Extract<PocketClientResult, { kind: "list" }>>;
}
export class PocketRemoteError extends Error {
	readonly code: PocketErrorCode;
	readonly outcome: "denied" | "unknown";
	readonly requestId: string;
	constructor(code: PocketErrorCode, outcome: "denied" | "unknown", requestId: string) {
		super(outcome === "denied" ? "Pocket request refused" : "Pocket operation outcome unconfirmed");
		this.name = "PocketRemoteError";
		this.code = code;
		this.outcome = outcome;
		this.requestId = requestId;
	}
}
const sameRef = (a: AgentRef, b: AgentRef): boolean =>
	a.key === b.key &&
	a.sessionId === b.sessionId &&
	a.conversationId === b.conversationId &&
	a.incarnation === b.incarnation &&
	a.profile === b.profile;
function correlated(command: PocketCommand, result: PocketResult, personId?: string): boolean {
	switch (command.op) {
		case "hello":
			return result.kind === "hello";
		case "list":
			return result.kind === "list";
		case "create":
			return result.kind === "reference" && result.ref.profile === command.profile;
		case "configure":
			return (
				result.kind === "reference" &&
				result.ref.key === command.target.key &&
				result.ref.sessionId === command.target.sessionId &&
				result.ref.conversationId === command.target.conversationId &&
				result.ref.profile === command.profile &&
				result.ref.incarnation !== command.target.incarnation
			);
		case "fork":
			return (
				result.kind === "reference" &&
				result.ref.sessionId === command.target.sessionId &&
				result.ref.conversationId !== command.target.conversationId &&
				result.ref.profile === command.profile
			);
		case "read":
			return result.kind === "conversation" && sameRef(command.target, result.snapshot.ref);
		case "display":
			return (
				result.kind === "display" &&
				sameRef(command.target, result.receipt.ref) &&
				result.receipt.requestId === command.requestId &&
				(!personId || result.receipt.actorId === personId)
			);
		case "submit":
			return (
				result.kind === "receipt" &&
				sameRef(command.target, result.receipt.target) &&
				result.receipt.requestId === command.input.requestId &&
				(!personId || result.receipt.actorId === personId)
			);
		case "receipt":
		case "wait":
		case "withdraw":
			return (
				result.kind === "receipt" &&
				result.receipt.id === command.id &&
				(!personId || result.receipt.actorId === personId)
			);
		case "invite":
			return result.kind === "invite";
		case "people":
			return result.kind === "people";
		case "session.rotate":
			return result.kind === "session" && (!personId || result.person.id === personId);
		case "abort":
		case "person.set":
		case "person.revoke":
		case "invite.revoke":
		case "session.logout":
			return result.kind === "updated";
	}
}
async function readBody(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing Pocket response");
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let bytes = 0,
		text = "";
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > POCKET_MAX_BYTES) {
				await reader.cancel();
				throw new Error("Pocket response capacity");
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}
/** Fetch-only, same-origin cookie client. No provider configuration, Node globals or automatic mutation replay. */
export function createPocketClient(options: PocketClientOptions): PocketClient {
	let endpoint: URL;
	try {
		endpoint = new URL(options.endpoint);
	} catch {
		throw new Error("Invalid Pocket endpoint");
	}
	if (
		!["http:", "https:"].includes(endpoint.protocol) ||
		endpoint.pathname !== "/pocket/rpc" ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash ||
		(typeof globalThis.location !== "undefined" && globalThis.location.origin !== endpoint.origin)
	)
		throw new Error("Explicit same-origin Pocket endpoint required");
	const timeoutMs = options.timeoutMs ?? 10000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
		throw new Error("Invalid finite Pocket deadline");
	const url = endpoint.href;
	let serverId: string | undefined, personId: string | undefined;
	async function request(
		command: PocketCommand,
		input: PocketRequestOptions = {},
	): Promise<PocketClientResult> {
		const requestId = input.requestId ?? globalThis.crypto.randomUUID();
		if (!identity(requestId)) throw new Error("Invalid Pocket request identity");
		const encoded = decodePocketRequest({ version: 2, requestId, command });
		if (input.signal?.aborted) throw new PocketRemoteError("FORBIDDEN", "denied", requestId);
		const controller = new AbortController(),
			abort = () => controller.abort();
		input.signal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(abort, timeoutMs);
		try {
			const csrf = options.csrf?.() ?? null;
			if (csrf !== null && !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new Error("Invalid CSRF binding");
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(csrf ? { "X-Pakka-CSRF": csrf } : {}) },
				body: JSON.stringify(encoded),
				signal: controller.signal,
				redirect: "error",
				credentials: "same-origin",
				cache: "no-store",
			});
			let raw: unknown;
			try {
				raw = JSON.parse(await readBody(response));
			} catch {
				throw new PocketRemoteError("UNKNOWN", "unknown", requestId);
			}
			const decoded = decodePocketResponse(raw, requestId);
			if (command.op !== "hello" && serverId && decoded.serverId !== serverId)
				throw new PocketRemoteError("UNKNOWN", "unknown", requestId);
			if ("error" in decoded)
				throw new PocketRemoteError(decoded.error.code, decoded.error.outcome, requestId);
			if (!response.ok || !correlated(command, decoded.result, personId))
				throw new PocketRemoteError("UNKNOWN", "unknown", requestId);
			if (decoded.result.kind === "hello") {
				serverId = decoded.serverId;
				personId = decoded.result.person.id;
			}
			return Object.freeze({ ...decoded.result, serverId: decoded.serverId, rpcRequestId: requestId });
		} catch (error) {
			if (error instanceof PocketRemoteError) throw error;
			throw new PocketRemoteError("UNKNOWN", "unknown", requestId);
		} finally {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", abort);
		}
	}
	return Object.freeze({
		request,
		reconnect: async (options: PocketRequestOptions = {}) => {
			const hello = await request({ op: "hello" }, options);
			if (hello.kind !== "hello")
				throw new PocketRemoteError("UNKNOWN", "unknown", options.requestId ?? "reconnect");
			const list = await request({ op: "list" }, options);
			if (
				list.kind !== "list" ||
				list.serverId !== hello.serverId ||
				list.conversations.some((ref) => ref.sessionId !== hello.sessionId)
			)
				throw new PocketRemoteError("UNKNOWN", "unknown", options.requestId ?? "reconnect");
			return list;
		},
	});
}
