import { decodeRequest, decodeResponse, MAX_WIRE_BYTES, identity } from "@pakka/protocol";
import type { Command, Result, ErrorCode } from "@pakka/protocol";
export type { AgentRef, Command, Result, Member, Receipt } from "@pakka/protocol";
export interface ClientOptions {
	readonly endpoint: string;
	readonly token: string;
	readonly timeoutMs?: number;
}
export interface RequestOptions {
	readonly requestId?: string;
	readonly signal?: AbortSignal;
}
/** Descriptive correlation/instance fields; never authority or a global revision. */
export type ClientResult = Result & { readonly serverId: string; readonly rpcRequestId: string };
export interface Client {
	request(command: Command, options?: RequestOptions): Promise<ClientResult>;
	/** Explicit fresh scope read; never replays a prior mutation automatically. */
	reconnect(options?: RequestOptions): Promise<Extract<ClientResult, { kind: "snapshot" }>>;
}
export class RemoteError extends Error {
	readonly code: ErrorCode;
	readonly outcome: "denied" | "unknown";
	readonly requestId: string;
	constructor(code: ErrorCode, outcome: "denied" | "unknown", requestId: string) {
		super(outcome === "denied" ? "Remote request refused" : "Remote operation outcome unconfirmed");
		this.name = "RemoteError";
		this.code = code;
		this.outcome = outcome;
		this.requestId = requestId;
	}
}
/** Browser/Node fetch only. Import and construction have no I/O or credential discovery. */
export function createClient(options: ClientOptions): Client {
	let endpoint: URL;
	try {
		endpoint = new URL(options.endpoint);
	} catch {
		throw new Error("Invalid client endpoint");
	}
	if (
		endpoint.protocol !== "http:" ||
		endpoint.hostname !== "127.0.0.1" ||
		endpoint.pathname !== "/rpc" ||
		endpoint.username ||
		endpoint.password ||
		endpoint.hash ||
		endpoint.search
	)
		throw new Error("Only the approved loopback RPC endpoint is supported");
	if (typeof options.token !== "string" || !/^[-a-zA-Z0-9._]{32,256}$/.test(options.token))
		throw new Error("Invalid dedicated client credential");
	const timeoutMs = options.timeoutMs ?? 10000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
		throw new Error("Invalid finite client deadline");
	const url = endpoint.href,
		credential = options.token;
	async function readBody(response: globalThis.Response): Promise<string> {
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing protocol body");
		const decoder = new TextDecoder("utf-8", { fatal: true });
		let bytes = 0,
			text = "";
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > MAX_WIRE_BYTES) {
					await reader.cancel();
					throw new Error("Protocol response size limit");
				}
				text += decoder.decode(value, { stream: true });
			}
			return text + decoder.decode();
		} finally {
			reader.releaseLock();
		}
	}
	async function request(command: Command, requestOptions: RequestOptions = {}): Promise<ClientResult> {
		const requestId = requestOptions.requestId ?? globalThis.crypto.randomUUID();
		if (!identity(requestId)) throw new Error("Invalid RPC request identity");
		// Validation is before fetch: no-effect local refusal cannot have issued work.
		const encoded = decodeRequest({ version: 1, requestId, command });
		if (requestOptions.signal?.aborted) throw new RemoteError("FORBIDDEN", "denied", requestId);
		const controller = new AbortController(),
			abort = () => controller.abort();
		requestOptions.signal?.addEventListener("abort", abort, { once: true });
		const deadline = setTimeout(abort, timeoutMs);
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + credential },
				body: JSON.stringify(encoded),
				signal: controller.signal,
				redirect: "error",
				credentials: "omit",
				cache: "no-store",
			});
			let raw: unknown;
			try {
				raw = JSON.parse(await readBody(response));
			} catch {
				throw new RemoteError("UNKNOWN", "unknown", requestId);
			}
			const decoded = decodeResponse(raw, requestId);
			if ("error" in decoded) throw new RemoteError(decoded.error.code, decoded.error.outcome, requestId);
			if (!response.ok) throw new RemoteError("UNKNOWN", "unknown", requestId);
			return Object.freeze({
				...decoded.result,
				serverId: decoded.serverId,
				rpcRequestId: decoded.requestId,
			});
		} catch (error) {
			if (error instanceof RemoteError) throw error;
			// Disconnect/timeout/invalid reply are not evidence that admission had no effects.
			throw new RemoteError("UNKNOWN", "unknown", requestId);
		} finally {
			clearTimeout(deadline);
			requestOptions.signal?.removeEventListener("abort", abort);
		}
	}
	return Object.freeze({
		request,
		reconnect: async (requestOptions: RequestOptions = {}) => {
			const hello = await request({ op: "hello" }, requestOptions);
			if (hello.kind !== "hello")
				throw new RemoteError("UNKNOWN", "unknown", requestOptions.requestId ?? "reconnect");
			const snapshot = await request({ op: "snapshot" }, requestOptions);
			if (
				snapshot.kind !== "snapshot" ||
				snapshot.sessionId !== hello.sessionId ||
				snapshot.serverId !== hello.serverId
			)
				throw new RemoteError("UNKNOWN", "unknown", requestOptions.requestId ?? "reconnect");
			return snapshot;
		},
	});
}
