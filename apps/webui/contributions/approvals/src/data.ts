import { decodeManifest, decodeValue, isRecord, type ExtensionOperation } from "@pakka/protocol/extensions";
import { decodeExtensionRequest, EXTENSION_VERSION } from "@pakka/protocol/extension-rpc";
import type { AgentRef } from "@pakka/protocol/pocket";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import definition from "../manifest.json" with { type: "json" };

const manifest = decodeManifest(definition);
export type ApprovalState = "pending" | "allowed" | "denied" | "running" | "done" | "unknown";
export interface Approval {
	readonly id: string;
	readonly tool: string;
	readonly argumentsText: string;
	readonly createdAt: number;
	readonly expiresAt: number;
	readonly state: ApprovalState;
	readonly decidedBy?: string;
}
export interface Decision {
	readonly id: string;
	readonly allow: boolean;
}
export interface PendingDecision {
	readonly version: 1;
	readonly requestId: string;
	readonly target: AgentRef;
	readonly input: Decision;
}
export type Pending = readonly PendingDecision[] | "unreadable";
const invalid = (): never => {
	throw new Error("审批数据未能确认。");
};
const text = (value: unknown): string => (typeof value === "string" ? value : invalid());
const number = (value: unknown): number => (typeof value === "number" ? value : invalid());
function declaration(action: string) {
	const result = manifest.actions.find((item) => item.id === action);
	if (!result) return invalid();
	return result;
}
function row(value: unknown): Approval {
	if (!isRecord(value)) return invalid();
	const state = value.state;
	if (
		state !== "pending" &&
		state !== "allowed" &&
		state !== "denied" &&
		state !== "running" &&
		state !== "done" &&
		state !== "unknown"
	)
		return invalid();
	return {
		id: text(value.id),
		tool: text(value.tool),
		argumentsText: text(value.argumentsText),
		createdAt: number(value.createdAt),
		expiresAt: number(value.expiresAt),
		state,
		...(value.decidedBy === undefined ? {} : { decidedBy: text(value.decidedBy) }),
	};
}
function output(action: string, value: unknown) {
	return decodeValue(declaration(action).output, value);
}
export async function list(binding: ExtensionServiceBinding, signal: AbortSignal) {
	const result = await binding.call("list", {}, { signal });
	signal.throwIfAborted();
	if (result.state !== "done") throw new Error("本次审批读取未确认，请重新读取。");
	const value = output("list", result.value);
	if (!isRecord(value) || !Array.isArray(value.approvals) || typeof value.canDecide !== "boolean")
		return invalid();
	return { approvals: value.approvals.map(row), canDecide: value.canDecide };
}
export function confirmed(
	binding: ExtensionServiceBinding,
	original: PendingDecision,
	operation: ExtensionOperation,
): Approval | null {
	if (
		operation.requestId !== original.requestId ||
		operation.action !== "decide" ||
		operation.actorId !== binding.personId ||
		operation.extension !== binding.extensionId
	)
		return invalid();
	if (operation.state !== "done") return null;
	const result = row(output("decide", operation.value));
	if (
		result.id !== original.input.id ||
		result.decidedBy !== binding.personId ||
		result.state === "pending" ||
		(original.input.allow ? result.state === "denied" : result.state !== "denied")
	)
		return invalid();
	return result;
}
export function storageKey(binding: ExtensionServiceBinding) {
	if (!binding.target) throw new Error("审批需要明确的原 Conversation。");
	return JSON.stringify([
		"pakka-approvals-v1",
		binding.personId,
		binding.extensionId,
		binding.target.sessionId,
		binding.target.conversationId,
	]);
}
export function pending(key: string, current: AgentRef): Pending {
	try {
		const raw = sessionStorage.getItem(key);
		if (raw === null) return [];
		const values: unknown = JSON.parse(raw);
		if (!Array.isArray(values) || values.length > 512) return "unreadable";
		const rows = values.map((value): PendingDecision => {
			if (
				!isRecord(value) ||
				Object.keys(value).sort().join(",") !== "input,requestId,target,version" ||
				value.version !== 1 ||
				typeof value.requestId !== "string" ||
				!/^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value.requestId)
			)
				return invalid();
			const request = decodeExtensionRequest({
				version: EXTENSION_VERSION,
				requestId: "approval-storage",
				command: { op: "list", target: value.target },
			});
			if (request.command.op !== "list" || !request.command.target) return invalid();
			const target = request.command.target;
			if (target.sessionId !== current.sessionId || target.conversationId !== current.conversationId)
				return invalid();
			const input = decodeValue(declaration("decide").input, value.input);
			if (!isRecord(input) || typeof input.id !== "string" || typeof input.allow !== "boolean")
				return invalid();
			return { version: 1, requestId: value.requestId, target, input: { id: input.id, allow: input.allow } };
		});
		if (
			new Set(rows.map((row) => row.input.id)).size !== rows.length ||
			new Set(rows.map((row) => row.requestId)).size !== rows.length
		)
			return "unreadable";
		return rows;
	} catch {
		return "unreadable";
	}
}
const changed = "pakka:approval-requests";
function save(key: string, rows: readonly PendingDecision[]) {
	if (rows.length) sessionStorage.setItem(key, JSON.stringify(rows));
	else sessionStorage.removeItem(key);
	window.dispatchEvent(new CustomEvent(changed, { detail: key }));
}
export function retain(key: string, original: PendingDecision) {
	const rows = pending(key, original.target);
	if (rows === "unreadable" || rows.some((row) => row.input.id === original.input.id))
		throw new Error("此审批已有待核对请求，本次没有提交。");
	save(key, [...rows, original]);
}
export function clear(key: string, original: PendingDecision) {
	const rows = pending(key, original.target);
	if (
		rows === "unreadable" ||
		rows.some((row) => row.input.id === original.input.id && row.requestId !== original.requestId)
	)
		throw new Error("本地原请求已变化，保留当前记录。");
	save(
		key,
		rows.filter((row) => row.requestId !== original.requestId),
	);
}
export function watch(key: string, refresh: () => void) {
	const local = (event: Event) => {
		if ("detail" in event && event.detail === key) refresh();
	};
	const stored = (event: StorageEvent) => {
		if (event.storageArea === sessionStorage && event.key === key) refresh();
	};
	window.addEventListener(changed, local);
	window.addEventListener("storage", stored);
	return () => {
		window.removeEventListener(changed, local);
		window.removeEventListener("storage", stored);
	};
}
