import { isRecord } from "@pakka/protocol/extensions";
import type { ExtensionOperation } from "@pakka/protocol/extensions";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import { readTicketResult, ticketCall, TicketCallError, type TicketReceipt } from "./client.ts";

export interface PendingTicketWrite {
	readonly version: 1;
	readonly requestId: string;
	readonly action: "submit" | "edit";
	readonly ticketId: string | null;
}
export type PendingTicketState = PendingTicketWrite | "unreadable" | null;
const changed = "pakka:rsi-pending";

/** Browser origin + stable Person + app-scoped extension. HTTP server epochs may change on reopen. */
export function pendingTicketKey(service: ExtensionServiceBinding) {
	return JSON.stringify(["pakka-rsi-write-v1", service.personId, service.extensionId]);
}
export function readPendingTicket(key: string): PendingTicketState {
	try {
		const raw = sessionStorage.getItem(key);
		if (raw === null) return null;
		const value: unknown = JSON.parse(raw);
		if (
			!isRecord(value) ||
			Object.keys(value).sort().join(",") !== "action,requestId,ticketId,version" ||
			value.version !== 1 ||
			(value.action !== "submit" && value.action !== "edit") ||
			typeof value.requestId !== "string" ||
			!/^[a-zA-Z0-9-]{1,160}$/.test(value.requestId) ||
			(value.action === "submit"
				? value.ticketId !== null
				: typeof value.ticketId !== "string" || !value.ticketId)
		)
			return "unreadable";
		return {
			version: 1,
			requestId: value.requestId,
			action: value.action,
			ticketId: typeof value.ticketId === "string" ? value.ticketId : null,
		};
	} catch {
		return "unreadable";
	}
}
export function retainTicketWrite(key: string, value: PendingTicketWrite) {
	if (readPendingTicket(key) !== null) throw new Error("先核对尚未确认的工单请求。");
	// Failure to retain the original identity prevents admission, rather than allowing an untraceable write.
	sessionStorage.setItem(key, JSON.stringify(value));
	window.dispatchEvent(new CustomEvent(changed, { detail: key }));
}
export function clearTicketWrite(key: string, original: PendingTicketWrite) {
	const current = readPendingTicket(key);
	if (current === "unreadable" || (current && current.requestId !== original.requestId))
		throw new Error("待核对请求已经变化，保留当前记录。");
	sessionStorage.removeItem(key);
	window.dispatchEvent(new CustomEvent(changed, { detail: key }));
}
export function watchTicketWrite(key: string, listener: () => void) {
	const local = (event: Event) => {
		if ("detail" in event && event.detail === key) listener();
	};
	const storage = (event: StorageEvent) => {
		if (event.storageArea === sessionStorage && event.key === key) listener();
	};
	window.addEventListener(changed, local);
	window.addEventListener("storage", storage);
	return () => {
		window.removeEventListener(changed, local);
		window.removeEventListener("storage", storage);
	};
}
export function ticketWriteDenied(error: unknown): boolean {
	return error instanceof TicketCallError
		? error.status !== "unknown"
		: error instanceof Error && "outcome" in error && error.outcome === "denied";
}
export function checkTicketReceipt(
	original: PendingTicketWrite,
	operation: ExtensionOperation,
	receipt: TicketReceipt,
) {
	if (
		operation.action !== original.action ||
		operation.requestId !== original.requestId ||
		receipt.requestId !== operation.id ||
		(original.ticketId !== null && receipt.id !== original.ticketId)
	)
		throw new Error("工单回执与原请求身份不符。");
	return receipt;
}
/** An unknown outer operation is not a failed write: only read the inner ledger using that operation's identity. */
export async function reconcileTicketWrite(
	service: ExtensionServiceBinding,
	original: PendingTicketWrite,
	signal: AbortSignal,
): Promise<{ status: "saved"; receipt: TicketReceipt } | { status: "rejected"; message: string }> {
	const operation = await service.operationByRequest(original.requestId, { signal });
	if (operation.action !== original.action || operation.requestId !== original.requestId)
		throw new Error("原操作不是此工单请求。");
	let receipt: TicketReceipt | null = null;
	if (operation.state === "done") {
		try {
			receipt = readTicketResult(original.action, operation.value);
		} catch (error) {
			if (!(error instanceof TicketCallError)) throw error;
			if (error.status !== "unknown") return { status: "rejected", message: error.message };
		}
	}
	if (!receipt) receipt = await ticketCall(service, "lookup", { requestId: operation.id }, { signal });
	if (!receipt) throw new Error("原请求仍未确认；没有重新提交。");
	return { status: "saved", receipt: checkTicketReceipt(original, operation, receipt) };
}
