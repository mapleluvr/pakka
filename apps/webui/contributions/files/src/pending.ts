import { decodeExtensionRequest, EXTENSION_VERSION } from "@pakka/protocol/extension-rpc";
import { isRecord, type ExtensionJson, type ExtensionOperation } from "@pakka/protocol/extensions";
import type { AgentRef } from "@pakka/protocol/pocket";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import { fileReceipt, inputFor, isMutation, read, type FileMutation, type FileReceipt } from "./service.ts";

export type PendingFile = {
	version: 1;
	requestId: string;
	action: FileMutation;
	target: AgentRef;
	input: ExtensionJson;
};
export type PendingState = PendingFile | "unreadable" | null;
export type FileDraft = { root: string; path: string; sha256: string; original: string; text: string };
const changed = "pakka:files-state";
export function storageKey(service: ExtensionServiceBinding) {
	if (!service.target) throw new Error("文件界面需要明确的 Conversation。");
	return JSON.stringify([
		"pakka-files-v1",
		service.personId,
		service.extensionId,
		service.target.sessionId,
		service.target.conversationId,
	]);
}
function target(value: unknown): AgentRef {
	const result = decodeExtensionRequest({
		version: EXTENSION_VERSION,
		requestId: "files-storage",
		command: { op: "list", target: value },
	}).command;
	if (result.op !== "list" || !result.target) throw new Error("原请求缺少目标。");
	return result.target;
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
			!isMutation(value.action) ||
			typeof value.requestId !== "string" ||
			!/^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value.requestId)
		)
			return "unreadable";
		const ref = target(value.target);
		if (ref.sessionId !== current.sessionId || ref.conversationId !== current.conversationId)
			return "unreadable";
		return {
			version: 1,
			requestId: value.requestId,
			action: value.action,
			target: ref,
			input: inputFor(value.action, value.input),
		};
	} catch {
		return "unreadable";
	}
}
const notify = (key: string) => window.dispatchEvent(new CustomEvent(changed, { detail: key }));
export function retain(key: string, value: PendingFile) {
	if (pending(key, value.target) !== null)
		throw new Error("此 Conversation 已有待核对的文件操作，本次没有提交。");
	inputFor(value.action, value.input);
	sessionStorage.setItem(key, JSON.stringify(value));
	notify(key);
}
export function clear(key: string, value: PendingFile) {
	const current = pending(key, value.target);
	if (current === "unreadable" || (current && current.requestId !== value.requestId))
		throw new Error("原请求记录已变化，保留当前记录。");
	sessionStorage.removeItem(key);
	notify(key);
}
export function draft(key: string): FileDraft | "unreadable" | null {
	try {
		const raw = sessionStorage.getItem(key + ":draft");
		if (raw === null) return null;
		const value: unknown = JSON.parse(raw);
		if (
			!isRecord(value) ||
			Object.keys(value).sort().join(",") !== "original,path,root,sha256,text" ||
			typeof value.root !== "string" ||
			typeof value.path !== "string" ||
			typeof value.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(value.sha256) ||
			typeof value.original !== "string" ||
			typeof value.text !== "string"
		)
			return "unreadable";
		return {
			root: value.root,
			path: value.path,
			sha256: value.sha256,
			original: value.original,
			text: value.text,
		};
	} catch {
		return "unreadable";
	}
}
export function saveDraft(key: string, value: FileDraft | null) {
	if (value === null) sessionStorage.removeItem(key + ":draft");
	else sessionStorage.setItem(key + ":draft", JSON.stringify(value));
	notify(key);
}
export function watch(key: string, update: () => void) {
	const local = (event: Event) => {
		if ("detail" in event && event.detail === key) update();
	};
	const storage = (event: StorageEvent) => {
		if (event.storageArea === sessionStorage && [key, key + ":draft"].includes(event.key ?? "")) update();
	};
	window.addEventListener(changed, local);
	window.addEventListener("storage", storage);
	return () => {
		window.removeEventListener(changed, local);
		window.removeEventListener("storage", storage);
	};
}
export function confirmed(original: PendingFile, operation: ExtensionOperation, value: FileReceipt) {
	if (
		operation.action !== original.action ||
		operation.requestId !== original.requestId ||
		value.requestId !== operation.id
	)
		throw new Error("文件回执与原请求不符。");
	if (value.state === "done" && isRecord(original.input)) {
		const fields = original.action === "switch-branch" ? [] : (["path", "name", "branch"] as const);
		for (const field of fields) {
			if (typeof original.input[field] === "string" && value.value?.[field] !== original.input[field])
				throw new Error("文件效果与原请求目标不符。");
		}
		if (original.action === "switch-branch" && value.value?.branch !== original.input.name)
			throw new Error("分支回执与原请求不符。");
	}
	return value;
}
export async function reconcile(
	service: ExtensionServiceBinding,
	original: PendingFile,
	signal: AbortSignal,
) {
	const bound = service.forConversation(original.target, { signal });
	const operation = await bound.operationByRequest(original.requestId, { signal });
	if (operation.action !== original.action || operation.requestId !== original.requestId)
		throw new Error("原操作与文件请求不符。");
	let value = operation.state === "done" ? fileReceipt(original.action, operation.value) : null;
	if (!value || value.state === "unknown") {
		if (!isRecord(original.input) || typeof original.input.root !== "string")
			throw new Error("原请求缺少文件根目录。");
		value = fileReceipt(
			"receipt",
			await read(bound, "receipt", { root: original.input.root, requestId: operation.id }, signal),
		);
	}
	signal.throwIfAborted();
	return confirmed(original, operation, value);
}
