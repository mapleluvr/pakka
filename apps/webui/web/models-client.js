import { POCKET_MAX_BYTES, decodePocketResponse } from "@pakka/protocol/pocket";

const resultKinds = {
	status: "status",
	refresh: "status",
	catalog: "catalog",
	"auth.prepare": "auth",
	"auth.start": "auth",
	"auth.state": "auth",
	"auth.cancel": "auth",
	"auth.answer": "updated",
	"auth.logout": "updated",
	"budget.read": "budget",
	"budget.history": "budget.history",
	"budget.receipt": "budget.receipt",
	"budget.change": "budget.receipt",
};
const failure = (requestId, code = "UNKNOWN", outcome = "unknown") =>
	Object.assign(
		new Error(outcome === "denied" ? "Configuration request refused" : "Configuration result unconfirmed"),
		{ requestId, code, outcome },
	);
async function read(response) {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing configuration response");
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let text = "",
		bytes = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > POCKET_MAX_BYTES) {
				await reader.cancel();
				throw new Error("Configuration response capacity");
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} finally {
		reader.releaseLock();
	}
}

/** Private, same-origin configuration transport. Never caches or retries mutations. */
export function createModelsClient({ serverId, csrf }) {
	if (typeof serverId !== "string" || !serverId) throw new Error("A current WebUI handshake is required");
	return Object.freeze({
		async request(command, { requestId = crypto.randomUUID(), signal } = {}) {
			if (!Object.hasOwn(resultKinds, command.op)) throw failure(requestId, "INVALID_REQUEST", "denied");
			if (signal?.aborted) throw failure(requestId, "FORBIDDEN", "denied");
			const controller = new AbortController(),
				abort = () => controller.abort();
			signal?.addEventListener("abort", abort, { once: true });
			const timeout = setTimeout(abort, 15000);
			try {
				const token = csrf();
				if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
					throw failure(requestId, "UNAUTHORIZED", "denied");
				const body = JSON.stringify({ version: 2, requestId, command });
				if (new TextEncoder().encode(body).byteLength > POCKET_MAX_BYTES)
					throw failure(requestId, "INVALID_REQUEST", "denied");
				const response = await fetch("/pocket/models/rpc", {
					method: "POST",
					headers: { "Content-Type": "application/json", "X-Pakka-CSRF": token },
					body,
					credentials: "same-origin",
					cache: "no-store",
					redirect: "error",
					signal: controller.signal,
				});
				const value = await read(response);
				if (!value || value.version !== 2 || value.requestId !== requestId || value.serverId !== serverId)
					throw failure(requestId);
				if (value.error) {
					const decoded = decodePocketResponse(value, requestId);
					throw failure(requestId, decoded.error.code, decoded.error.outcome);
				}
				if (
					!response.ok ||
					Object.keys(value).some((key) => !["version", "requestId", "serverId", "result"].includes(key)) ||
					value.result?.kind !== resultKinds[command.op]
				)
					throw failure(requestId);
				if (command.op.startsWith("budget.") && value.result.sessionId !== command.sessionId)
					throw failure(requestId);
				if (
					["auth.start", "auth.state", "auth.cancel"].includes(command.op) &&
					value.result.flow?.id !== command.id
				)
					throw failure(requestId);
				if (
					command.op === "auth.prepare" &&
					(value.result.flow?.provider !== command.provider || value.result.flow?.type !== command.type)
				)
					throw failure(requestId);
				return Object.freeze({ ...value.result, serverId, rpcRequestId: requestId });
			} catch (error) {
				if (error?.requestId === requestId && ["denied", "unknown"].includes(error.outcome)) throw error;
				throw failure(requestId);
			} finally {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", abort);
			}
		},
	});
}
