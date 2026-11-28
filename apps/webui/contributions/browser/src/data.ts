import {
	decodeManifest,
	decodeValue,
	isRecord,
	type ExtensionJson,
	type ExtensionOperation,
} from "@pakka/protocol/extensions";
import { decodeExtensionRequest, EXTENSION_VERSION } from "@pakka/protocol/extension-rpc";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { AgentRef } from "@pakka/protocol/pocket";
import definition from "../manifest.json" with { type: "json" };

const manifest = decodeManifest(definition);
export type Action = "navigate" | "click" | "fill";
export interface View {
	readonly open: boolean;
	readonly url: string;
	readonly title: string;
	readonly text: string;
	readonly canAct: boolean;
	readonly frame?: string;
}
export interface Receipt {
	readonly requestId: string;
	readonly state: "done" | "unknown";
}
export interface Pending {
	readonly version: 1;
	readonly requestId: string;
	readonly action: Action;
	readonly input: ExtensionJson;
	readonly target: AgentRef;
}
export type PendingState = Pending | "unreadable" | null;
const invalid = (): never => {
	throw new Error("浏览器数据与原请求未能确认。");
};
export const failure = (reason: unknown) =>
	reason instanceof Error ? reason.message : "浏览器操作未能确认。";
const isAction = (value: unknown): value is Action =>
	value === "navigate" || value === "click" || value === "fill";
function declaration(action: string) {
	const found = manifest.actions.find((row) => row.id === action);
	return found ?? invalid();
}
export const inputFor = (action: Action, value: unknown) => decodeValue(declaration(action).input, value);
function output(action: string, value: unknown) {
	return decodeValue(declaration(action).output, value);
}
export async function view(binding: ExtensionServiceBinding, signal: AbortSignal): Promise<View> {
	const operation = await binding.call("view", {}, { signal });
	signal.throwIfAborted();
	if (operation.state !== "done") throw new Error("当前页面读取未确认，请重新读取。");
	const value = output("view", operation.value);
	if (!isRecord(value) || !isRecord(value.view) || typeof value.canAct !== "boolean") return invalid();
	const row = value.view;
	if (
		typeof row.open !== "boolean" ||
		typeof row.url !== "string" ||
		typeof row.title !== "string" ||
		typeof row.text !== "string"
	)
		return invalid();
	const frame = value.frame;
	if (
		frame !== undefined &&
		(!isRecord(frame) ||
			frame.type !== "image/png" ||
			typeof frame.base64 !== "string" ||
			!/^iVBOR[A-Za-z0-9+/]*={0,2}$/.test(frame.base64))
	)
		return invalid();
	return {
		open: row.open,
		url: row.url,
		title: row.title,
		text: row.text,
		canAct: value.canAct,
		...(isRecord(frame) && typeof frame.base64 === "string" ? { frame: frame.base64 } : {}),
	};
}
function receipt(action: string, value: unknown): Receipt {
	const row = output(action, value);
	if (
		!isRecord(row) ||
		typeof row.requestId !== "string" ||
		(row.state !== "done" && row.state !== "unknown")
	)
		return invalid();
	return { requestId: row.requestId, state: row.state };
}
function correlate(binding: ExtensionServiceBinding, original: Pending, operation: ExtensionOperation) {
	if (
		operation.requestId !== original.requestId ||
		operation.action !== original.action ||
		operation.extension !== binding.extensionId ||
		operation.actorId !== binding.personId
	)
		return invalid();
}
export function confirmed(
	binding: ExtensionServiceBinding,
	original: Pending,
	operation: ExtensionOperation,
): Receipt | null {
	correlate(binding, original, operation);
	if (operation.state !== "done") return null;
	const result = receipt(original.action, operation.value);
	if (result.requestId !== operation.id) return invalid();
	return result;
}
export async function reconcile(
	binding: ExtensionServiceBinding,
	original: Pending,
	signal: AbortSignal,
): Promise<Receipt> {
	const bound = binding.forConversation(original.target, { signal });
	const operation = await bound.operationByRequest(original.requestId, { signal });
	let result = confirmed(binding, original, operation);
	if (!result || result.state === "unknown") {
		const inner = await bound.call("receipt", { requestId: operation.id }, { signal });
		signal.throwIfAborted();
		if (inner.state !== "done") throw new Error("原浏览器动作回执仍未确认，保留原请求。");
		result = receipt("receipt", inner.value);
		if (result.requestId !== operation.id) return invalid();
	}
	signal.throwIfAborted();
	return result;
}
export function storageKey(binding: ExtensionServiceBinding) {
	if (!binding.target) throw new Error("浏览器需要明确的原 Conversation。");
	return JSON.stringify([
		"pakka-browser-v1",
		binding.personId,
		binding.extensionId,
		binding.target.sessionId,
		binding.target.conversationId,
	]);
}
export function pending(key: string, current: AgentRef): PendingState {
	try {
		const raw = sessionStorage.getItem(key);
		if (raw === null) return null;
		const value: unknown = JSON.parse(raw);
		if (
			!isRecord(value) ||
			Object.keys(value).sort().join(",") !== "action,input,requestId,target,version" ||
			value.version !== 1 ||
			!isAction(value.action) ||
			typeof value.requestId !== "string" ||
			!/^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value.requestId)
		)
			return "unreadable";
		const decoded = decodeExtensionRequest({
			version: EXTENSION_VERSION,
			requestId: "browser-storage",
			command: { op: "list", target: value.target },
		}).command;
		if (
			decoded.op !== "list" ||
			!decoded.target ||
			decoded.target.sessionId !== current.sessionId ||
			decoded.target.conversationId !== current.conversationId
		)
			return "unreadable";
		return {
			version: 1,
			requestId: value.requestId,
			action: value.action,
			target: decoded.target,
			input: inputFor(value.action, value.input),
		};
	} catch {
		return "unreadable";
	}
}
const changed = "pakka:browser-request";
function notify(key: string) {
	window.dispatchEvent(new CustomEvent(changed, { detail: key }));
}
export function retain(key: string, original: Pending) {
	if (pending(key, original.target) !== null)
		throw new Error("此 Conversation 已有待核对的浏览器操作，本次没有提交。");
	inputFor(original.action, original.input);
	sessionStorage.setItem(key, JSON.stringify(original));
	notify(key);
}
export function clear(key: string, original: Pending) {
	const current = pending(key, original.target);
	if (current === "unreadable" || (current && current.requestId !== original.requestId))
		throw new Error("原请求记录已变化，保留当前记录。");
	sessionStorage.removeItem(key);
	notify(key);
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
