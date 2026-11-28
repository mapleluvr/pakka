import {
	decodeManifest,
	decodeValue,
	isRecord,
	type ExtensionJson,
	type ExtensionOperation,
} from "@pakka/protocol/extensions";
import { decodeExtensionRequest, EXTENSION_VERSION } from "@pakka/protocol/extension-rpc";
import type { AgentRef } from "@pakka/protocol/pocket";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import definition from "../manifest.json" with { type: "json" };

const manifest = decodeManifest(definition);
export interface Hook {
	readonly id: string;
	readonly target: AgentRef;
	readonly name: string;
	readonly instructions: string;
	readonly signed: boolean;
	readonly allowOutside: boolean;
	readonly active: boolean;
	readonly version: number;
	readonly received: number;
	readonly lastReceivedAt: number | null;
}
export interface View {
	readonly hooks: readonly Hook[];
	readonly canManage: boolean;
}
export interface Credentials {
	readonly id: string;
	readonly version: number;
	readonly signed: boolean;
	readonly secret: string;
}
export interface Admission {
	readonly id: string;
	readonly receivedAt: number;
	readonly result: {
		readonly state: "accepted" | "ignored" | "unknown" | "denied" | "conflict" | "capacity";
		readonly receipt: null | {
			readonly id: string;
			readonly requestId: string;
			readonly actorId: string;
			readonly target: AgentRef;
			readonly status: "queued" | "placed" | "done" | "unanswered" | "unknown";
			readonly entryId?: string;
		};
	};
}
export type Create = {
	readonly name: string;
	readonly instructions: string;
	readonly signed: boolean;
	readonly allowOutside: boolean;
};
export type Command =
	| { readonly action: "create"; readonly input: Create }
	| {
			readonly action: "rotate" | "remove";
			readonly input: { readonly id: string; readonly expectedVersion: number };
	  };
export interface Mutation {
	readonly state: "done" | "conflict";
	readonly hook: Hook | null;
}

export const problem = (reason: unknown) =>
	reason instanceof Error ? reason.message : "Webhook 操作未能确认。";
const invalid = (): never => {
	throw new Error("Webhook 数据与原请求未能确认。");
};
const text = (value: unknown): string => (typeof value === "string" ? value : invalid());
const number = (value: unknown): number => (typeof value === "number" ? value : invalid());
const boolean = (value: unknown): boolean => (typeof value === "boolean" ? value : invalid());
const declaration = (action: string) => manifest.actions.find((row) => row.id === action) ?? invalid();
export function target(value: unknown): AgentRef {
	const decoded = decodeExtensionRequest({
		version: EXTENSION_VERSION,
		requestId: "hook-target",
		command: { op: "list", target: value },
	}).command;
	return decoded.op === "list" && decoded.target ? decoded.target : invalid();
}
export function requireTarget(binding: ExtensionServiceBinding) {
	if (!binding.target) throw new Error("Webhook 需要明确的原 Conversation。");
	return binding.target;
}
export function sameConversation(first: AgentRef, second: AgentRef) {
	return first.sessionId === second.sessionId && first.conversationId === second.conversationId;
}
export function sameTarget(first: AgentRef, second: AgentRef) {
	return (
		first.sessionId === second.sessionId &&
		first.conversationId === second.conversationId &&
		first.key === second.key &&
		first.incarnation === second.incarnation &&
		first.profile === second.profile
	);
}
function hook(value: unknown): Hook {
	if (!isRecord(value)) return invalid();
	return {
		id: text(value.id),
		target: target(value.target),
		name: text(value.name),
		instructions: text(value.instructions),
		signed: boolean(value.signed),
		allowOutside: boolean(value.allowOutside),
		active: boolean(value.active),
		version: number(value.version),
		received: number(value.received),
		lastReceivedAt: value.lastReceivedAt === null ? null : number(value.lastReceivedAt),
	};
}
function mutation(value: unknown): Mutation {
	if (!isRecord(value) || (value.state !== "done" && value.state !== "conflict")) return invalid();
	return { state: value.state, hook: value.hook === null ? null : hook(value.hook) };
}
async function readValue(
	binding: ExtensionServiceBinding,
	action: string,
	input: ExtensionJson,
	signal: AbortSignal,
) {
	const operation = await binding.call(action, input, { signal });
	signal.throwIfAborted();
	if (
		operation.extension !== binding.extensionId ||
		operation.actorId !== binding.personId ||
		operation.action !== action
	)
		return invalid();
	if (operation.state !== "done") throw new Error("本次 Webhook 读取未确认，请刷新。");
	return decodeValue(declaration(action).output, operation.value);
}
export async function read(binding: ExtensionServiceBinding, signal: AbortSignal): Promise<View> {
	const value = await readValue(binding, "read", {}, signal),
		scope = requireTarget(binding);
	if (!isRecord(value) || !Array.isArray(value.hooks) || typeof value.canManage !== "boolean")
		return invalid();
	const hooks = value.hooks.map(hook);
	if (
		hooks.some((row) => !sameConversation(row.target, scope)) ||
		new Set(hooks.map((row) => row.id)).size !== hooks.length
	)
		return invalid();
	return { hooks, canManage: value.canManage };
}
export function command(value: unknown): Command {
	if (!isRecord(value)) return invalid();
	const action = value.action;
	if (action !== "create" && action !== "rotate" && action !== "remove") return invalid();
	const input = decodeValue(declaration(action).input, value.input);
	if (!isRecord(input)) return invalid();
	if (action === "create") {
		const name = text(input.name),
			instructions = text(input.instructions);
		if (!name.trim() || /[\r\n]/.test(name) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(name + instructions))
			return invalid();
		return {
			action,
			input: { name, instructions, signed: boolean(input.signed), allowOutside: boolean(input.allowOutside) },
		};
	}
	return { action, input: { id: text(input.id), expectedVersion: number(input.expectedVersion) } };
}
function correlated(
	binding: ExtensionServiceBinding,
	original: Command,
	result: Mutation,
	scope = requireTarget(binding),
): Mutation | null {
	const row = result.hook;
	if (
		row &&
		!(original.action === "create" ? sameTarget(row.target, scope) : sameConversation(row.target, scope))
	)
		return invalid();
	if (original.action !== "create" && row && row.id !== original.input.id) return invalid();
	if (result.state === "conflict") return result;
	if (!row) return null;
	if (original.action === "create") {
		const input = original.input;
		if (
			row.name !== input.name ||
			row.instructions !== input.instructions ||
			row.signed !== input.signed ||
			row.allowOutside !== input.allowOutside ||
			row.version !== 1 ||
			!row.active
		)
			return invalid();
	} else if (
		row.version !== original.input.expectedVersion + 1 ||
		row.active !== (original.action === "rotate")
	)
		return invalid();
	return result;
}
export function confirmed(
	binding: ExtensionServiceBinding,
	original: Command,
	requestId: string,
	operation: ExtensionOperation,
	scope = requireTarget(binding),
) {
	if (
		operation.requestId !== requestId ||
		operation.action !== original.action ||
		operation.extension !== binding.extensionId ||
		operation.actorId !== binding.personId
	)
		return invalid();
	if (operation.state !== "done") return null;
	return correlated(
		binding,
		original,
		mutation(decodeValue(declaration(original.action).output, operation.value)),
		scope,
	);
}
export async function change(
	binding: ExtensionServiceBinding,
	original: Command,
	requestId: string,
	signal: AbortSignal,
) {
	const operation = await binding.call(original.action, original.input, { requestId, signal });
	signal.throwIfAborted();
	return confirmed(binding, original, requestId, operation);
}
export async function reconcile(
	binding: ExtensionServiceBinding,
	original: Command,
	requestId: string,
	signal: AbortSignal,
	originalTarget = requireTarget(binding),
) {
	if (!sameConversation(originalTarget, requireTarget(binding))) return invalid();
	const operation = await binding
		.forConversation(originalTarget, { signal })
		.operationByRequest(requestId, { signal });
	signal.throwIfAborted();
	const result = confirmed(binding, original, requestId, operation, originalTarget);
	if (operation.state === "done") return result;
	// Query the old outer identity, but use the current authorized binding for the inner read-only lookup.
	const value = await readValue(binding, "operation", { requestId: operation.id }, signal);
	return correlated(binding, original, mutation(value), originalTarget);
}
export async function credentials(
	binding: ExtensionServiceBinding,
	selected: Hook,
	signal: AbortSignal,
): Promise<Credentials> {
	if (!sameTarget(selected.target, requireTarget(binding)))
		throw new Error("原运行配置已变更，旧地址不能接收。请在当前配置新建 Webhook。");
	const value = await readValue(binding, "credentials", { id: selected.id }, signal);
	if (
		!isRecord(value) ||
		value.id !== selected.id ||
		value.version !== selected.version ||
		value.signed !== selected.signed ||
		typeof value.secret !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(value.secret)
	)
		throw new Error("连接设置已变化，请刷新 Webhook 后重新读取。");
	return { id: selected.id, version: selected.version, signed: selected.signed, secret: value.secret };
}
export function address(binding: ExtensionServiceBinding, value: Credentials) {
	return (
		location.origin +
		"/pakka-webui/ingress/" +
		encodeURIComponent(binding.extensionId) +
		"/hooks/" +
		encodeURIComponent(value.id) +
		(value.signed ? "" : "/" + value.secret)
	);
}
export async function deliveries(
	binding: ExtensionServiceBinding,
	selected: Hook,
	signal: AbortSignal,
): Promise<readonly Admission[]> {
	const value = await readValue(binding, "deliveries", { id: selected.id }, signal);
	if (!Array.isArray(value)) return invalid();
	return value.map((item): Admission => {
		if (!isRecord(item) || !isRecord(item.result)) return invalid();
		const result = item.result,
			state = result.state;
		if (
			state !== "accepted" &&
			state !== "ignored" &&
			state !== "unknown" &&
			state !== "denied" &&
			state !== "conflict" &&
			state !== "capacity"
		)
			return invalid();
		let receipt: Admission["result"]["receipt"] = null;
		if (result.receipt !== null) {
			const saved = result.receipt;
			if (!isRecord(saved)) return invalid();
			const status = saved.status;
			if (
				status !== "queued" &&
				status !== "placed" &&
				status !== "done" &&
				status !== "unanswered" &&
				status !== "unknown"
			)
				return invalid();
			const ref = target(saved.target);
			if (!sameTarget(ref, selected.target)) return invalid();
			receipt = {
				id: text(saved.id),
				requestId: text(saved.requestId),
				actorId: text(saved.actorId),
				target: ref,
				status,
				...(saved.entryId === undefined ? {} : { entryId: text(saved.entryId) }),
			};
		}
		return { id: text(item.id), receivedAt: number(item.receivedAt), result: { state, receipt } };
	});
}
