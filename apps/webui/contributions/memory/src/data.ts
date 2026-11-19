import { decodeManifest, decodeValue, isRecord, type ExtensionOperation } from "@pakka/protocol/extensions";
import { decodeExtensionRequest, EXTENSION_VERSION } from "@pakka/protocol/extension-rpc";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { AgentRef } from "@pakka/protocol/pocket";
import definition from "../manifest.json" with { type: "json" };

const manifest = decodeManifest(definition);
export interface Proposal {
	readonly text: string | null;
	readonly authorName: string;
	readonly byAgent: boolean;
	readonly mine: boolean;
}
export interface Lesson {
	readonly id: string;
	readonly text: string;
	readonly scope: "project" | "global";
	readonly version: number;
	readonly pending: boolean;
	readonly authorName: string;
	readonly byAgent: boolean;
	readonly mine: boolean;
	readonly proposal: Proposal | null;
}
export interface View {
	readonly project: { readonly id: string; readonly name: string } | null;
	readonly enabled: boolean;
	readonly owner: boolean;
	readonly canWrite: boolean;
	readonly lessons: readonly Lesson[];
	readonly limits: { readonly text: number; readonly project: number; readonly global: number };
}
export interface Mutation {
	readonly state: "done" | "conflict";
	readonly lesson: Lesson | null;
	readonly enabled: boolean;
}
export type Command =
	| {
			readonly action: "add";
			readonly input: { readonly text: string; readonly scope: "project" | "global" };
	  }
	| {
			readonly action: "change";
			readonly input: {
				readonly id: string;
				readonly expectedVersion: number;
				readonly action: "edit" | "remove" | "approve" | "discard";
				readonly text?: string;
			};
	  }
	| { readonly action: "activation"; readonly input: { readonly enabled: boolean } };
export type Pending = Command & {
	readonly version: 1;
	readonly requestId: string;
	readonly target: AgentRef;
};
export type PendingState = Pending | "unreadable" | null;
const invalid = (): never => {
	throw new Error("记忆数据与原请求未能确认。");
};
export const failure = (reason: unknown) => (reason instanceof Error ? reason.message : "记忆操作未能确认。");
function declaration(action: string) {
	return manifest.actions.find((row) => row.id === action) ?? invalid();
}
function proposal(value: unknown): Proposal | null {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		(value.text !== null && typeof value.text !== "string") ||
		typeof value.authorName !== "string" ||
		typeof value.byAgent !== "boolean" ||
		typeof value.mine !== "boolean"
	)
		return invalid();
	return { text: value.text, authorName: value.authorName, byAgent: value.byAgent, mine: value.mine };
}
function lesson(value: unknown): Lesson {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.text !== "string" ||
		(value.scope !== "project" && value.scope !== "global") ||
		typeof value.version !== "number" ||
		typeof value.pending !== "boolean" ||
		typeof value.authorName !== "string" ||
		typeof value.byAgent !== "boolean" ||
		typeof value.mine !== "boolean"
	)
		return invalid();
	return {
		id: value.id,
		text: value.text,
		scope: value.scope,
		version: value.version,
		pending: value.pending,
		authorName: value.authorName,
		byAgent: value.byAgent,
		mine: value.mine,
		proposal: proposal(value.proposal),
	};
}
export async function read(binding: ExtensionServiceBinding, signal: AbortSignal): Promise<View> {
	const operation = await binding.call("read", {}, { signal });
	signal.throwIfAborted();
	if (operation.state !== "done") throw new Error("记忆读取尚未确认，请刷新。");
	const value = decodeValue(declaration("read").output, operation.value);
	if (
		!isRecord(value) ||
		typeof value.enabled !== "boolean" ||
		typeof value.owner !== "boolean" ||
		typeof value.canWrite !== "boolean" ||
		!Array.isArray(value.lessons) ||
		!isRecord(value.limits)
	)
		return invalid();
	const project = value.project,
		limits = value.limits;
	if (
		project !== null &&
		(!isRecord(project) || typeof project.id !== "string" || typeof project.name !== "string")
	)
		return invalid();
	if (
		typeof limits.text !== "number" ||
		typeof limits.project !== "number" ||
		typeof limits.global !== "number"
	)
		return invalid();
	return {
		project:
			isRecord(project) && typeof project.id === "string" && typeof project.name === "string"
				? { id: project.id, name: project.name }
				: null,
		enabled: value.enabled,
		owner: value.owner,
		canWrite: value.canWrite,
		lessons: value.lessons.map(lesson),
		limits: { text: limits.text, project: limits.project, global: limits.global },
	};
}
function mutation(action: string, value: unknown): Mutation {
	const row = decodeValue(declaration(action).output, value);
	if (
		!isRecord(row) ||
		(row.state !== "done" && row.state !== "conflict") ||
		typeof row.enabled !== "boolean"
	)
		return invalid();
	return { state: row.state, lesson: row.lesson === null ? null : lesson(row.lesson), enabled: row.enabled };
}
function command(action: unknown, input: unknown): Command {
	if (action !== "add" && action !== "change" && action !== "activation") return invalid();
	const value = decodeValue(declaration(action).input, input);
	if (!isRecord(value)) return invalid();
	if (
		action === "add" &&
		typeof value.text === "string" &&
		(value.scope === "project" || value.scope === "global")
	)
		return { action, input: { text: value.text, scope: value.scope } };
	if (action === "activation" && typeof value.enabled === "boolean")
		return { action, input: { enabled: value.enabled } };
	if (
		action === "change" &&
		typeof value.id === "string" &&
		typeof value.expectedVersion === "number" &&
		(value.action === "edit" ||
			value.action === "remove" ||
			value.action === "approve" ||
			value.action === "discard") &&
		(value.action === "edit" ? typeof value.text === "string" : value.text === undefined)
	)
		return {
			action,
			input: {
				id: value.id,
				expectedVersion: value.expectedVersion,
				action: value.action,
				...(typeof value.text === "string" ? { text: value.text } : {}),
			},
		};
	return invalid();
}
export function confirmed(
	binding: ExtensionServiceBinding,
	original: Pending,
	operation: ExtensionOperation,
): Mutation | null {
	if (
		operation.requestId !== original.requestId ||
		operation.action !== original.action ||
		operation.extension !== binding.extensionId ||
		operation.actorId !== binding.personId
	)
		return invalid();
	return operation.state === "done" ? mutation(original.action, operation.value) : null;
}
export async function reconcile(
	binding: ExtensionServiceBinding,
	original: Pending,
	signal: AbortSignal,
): Promise<Mutation | null> {
	const bound = binding.forConversation(original.target, { signal });
	const operation = await bound.operationByRequest(original.requestId, { signal });
	signal.throwIfAborted();
	const result = confirmed(binding, original, operation);
	if (result) return result;
	const inner = await bound.call("operation", { requestId: operation.id }, { signal });
	signal.throwIfAborted();
	return inner.state === "done" ? mutation("operation", inner.value) : null;
}
export function storageKey(binding: ExtensionServiceBinding) {
	if (!binding.target) throw new Error("记忆需要明确的原 Conversation。");
	return JSON.stringify([
		"pakka-memory-v1",
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
			typeof value.requestId !== "string" ||
			!/^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value.requestId)
		)
			return "unreadable";
		const decoded = decodeExtensionRequest({
			version: EXTENSION_VERSION,
			requestId: "memory-storage",
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
			...command(value.action, value.input),
			version: 1,
			requestId: value.requestId,
			target: decoded.target,
		};
	} catch {
		return "unreadable";
	}
}
const changed = "pakka:memory-request";
function notify(key: string) {
	window.dispatchEvent(new CustomEvent(changed, { detail: key }));
}
export function retain(key: string, original: Pending) {
	if (pending(key, original.target) !== null)
		throw new Error("此 Conversation 已有待核对的记忆操作，本次没有提交。");
	command(original.action, original.input);
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
