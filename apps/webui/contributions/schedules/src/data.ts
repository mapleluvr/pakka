import { decodeManifest, decodeValue, isRecord, type ExtensionOperation } from "@pakka/protocol/extensions";
import { decodeExtensionRequest, EXTENSION_VERSION } from "@pakka/protocol/extension-rpc";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { AgentRef } from "@pakka/protocol/pocket";
import definition from "../manifest.json" with { type: "json" };

const manifest = decodeManifest(definition);
export interface Schedule {
	readonly id: string;
	readonly requestId: string;
	readonly actorId: string;
	readonly actorName: string;
	readonly text: string;
	readonly dueAt: number;
	readonly intervalMs: number | null;
	readonly maxRuns: number;
	readonly completed: number;
	readonly state: "waiting" | "running" | "done" | "cancelled" | "unknown";
	readonly jobId: string | null;
	readonly cancellationRequested: boolean;
	readonly nativeTerminal?: "aborted" | "completed";
	readonly deliveryId?: string;
}
export interface View {
	readonly schedules: readonly Schedule[];
	readonly canWrite: boolean;
}
export type Command =
	| {
			readonly action: "add";
			readonly delaySeconds: number;
			readonly input: {
				readonly text: string;
				readonly dueAt: number;
				readonly intervalMs?: number;
				readonly maxRuns?: number;
			};
	  }
	| { readonly action: "cancel"; readonly input: { readonly id: string } };
export type Pending = Command & {
	readonly version: 1;
	readonly requestId: string;
	readonly target: AgentRef;
};
export type PendingState = readonly Pending[] | "unreadable";
export const states = {
	waiting: "等待投递",
	running: "正在调度",
	done: "输入已投递",
	cancelled: "已取消",
	unknown: "执行结果未知",
} as const;
export const failure = (reason: unknown) => (reason instanceof Error ? reason.message : "定时输入未能确认。");
const invalid = (): never => {
	throw new Error("定时输入数据与原请求未能确认。");
};
const text = (value: unknown): string => (typeof value === "string" ? value : invalid());
const number = (value: unknown): number => (typeof value === "number" ? value : invalid());
function declaration(action: string) {
	return manifest.actions.find((row) => row.id === action) ?? invalid();
}
function row(value: unknown): Schedule {
	if (!isRecord(value) || typeof value.cancellationRequested !== "boolean") return invalid();
	const state = value.state,
		terminal = value.nativeTerminal;
	if (
		(state !== "waiting" &&
			state !== "running" &&
			state !== "done" &&
			state !== "cancelled" &&
			state !== "unknown") ||
		(terminal !== undefined && terminal !== "aborted" && terminal !== "completed")
	)
		return invalid();
	return {
		id: text(value.id),
		requestId: text(value.requestId),
		actorId: text(value.actorId),
		actorName: text(value.actorName),
		text: text(value.text),
		dueAt: number(value.dueAt),
		intervalMs: value.intervalMs === null ? null : number(value.intervalMs),
		maxRuns: number(value.maxRuns),
		completed: number(value.completed),
		state,
		jobId: value.jobId === null ? null : text(value.jobId),
		cancellationRequested: value.cancellationRequested,
		...(terminal ? { nativeTerminal: terminal } : {}),
		...(value.deliveryId === undefined ? {} : { deliveryId: text(value.deliveryId) }),
	};
}
export async function list(binding: ExtensionServiceBinding, signal: AbortSignal): Promise<View> {
	const operation = await binding.call("list", {}, { signal });
	signal.throwIfAborted();
	if (operation.state !== "done") throw new Error("本次计划读取未确认，请刷新。");
	const value = decodeValue(declaration("list").output, operation.value);
	if (!isRecord(value) || !Array.isArray(value.schedules) || typeof value.canWrite !== "boolean")
		return invalid();
	return { schedules: value.schedules.map(row), canWrite: value.canWrite };
}
function command(value: Record<string, unknown>): Command {
	const action = value.action;
	if (action !== "add" && action !== "cancel") return invalid();
	const input = decodeValue(declaration(action).input, value.input);
	if (!isRecord(input)) return invalid();
	if (action === "cancel" && typeof input.id === "string") return { action, input: { id: input.id } };
	if (
		action === "add" &&
		typeof input.text === "string" &&
		typeof input.dueAt === "number" &&
		(input.intervalMs === undefined || typeof input.intervalMs === "number") &&
		(input.maxRuns === undefined || typeof input.maxRuns === "number") &&
		typeof value.delaySeconds === "number" &&
		Number.isSafeInteger(value.delaySeconds) &&
		value.delaySeconds >= 1 &&
		value.delaySeconds <= 31622400
	) {
		const intervalMs = input.intervalMs,
			maxRuns = input.maxRuns;
		if (
			!input.text.trim() ||
			/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text) ||
			((maxRuns ?? 1) > 1 ? intervalMs === undefined : intervalMs !== undefined)
		)
			return invalid();
		return {
			action,
			delaySeconds: value.delaySeconds,
			input: {
				text: input.text,
				dueAt: input.dueAt,
				...(intervalMs === undefined ? {} : { intervalMs }),
				...(maxRuns === undefined ? {} : { maxRuns }),
			},
		};
	}
	return invalid();
}
export function confirmed(
	binding: ExtensionServiceBinding,
	original: Pending,
	operation: ExtensionOperation,
): Schedule | null {
	if (
		operation.requestId !== original.requestId ||
		operation.action !== original.action ||
		operation.extension !== binding.extensionId ||
		operation.actorId !== binding.personId
	)
		return invalid();
	if (operation.state !== "done") return null;
	const result = row(decodeValue(declaration(original.action).output, operation.value));
	if (original.action === "add") {
		const input = original.input;
		if (
			result.requestId !== operation.id ||
			result.actorId !== binding.personId ||
			result.text !== input.text ||
			result.dueAt !== input.dueAt ||
			result.intervalMs !== (input.intervalMs ?? null) ||
			result.maxRuns !== (input.maxRuns ?? 1)
		)
			return invalid();
		// A known job confirms registration; its current execution outcome is shown separately.
		return result.jobId === null ? null : result;
	}
	if (result.id !== original.input.id || !result.cancellationRequested) return invalid();
	// The done operation confirms the persisted request, not that native abort cleanup has finished.
	return result;
}
export async function reconcile(binding: ExtensionServiceBinding, original: Pending, signal: AbortSignal) {
	const operation = await binding
		.forConversation(original.target, { signal })
		.operationByRequest(original.requestId, { signal });
	signal.throwIfAborted();
	return confirmed(binding, original, operation);
}
export function storageKey(binding: ExtensionServiceBinding) {
	if (!binding.target) throw new Error("定时输入需要明确的原 Conversation。");
	return JSON.stringify([
		"pakka-schedules-v1",
		binding.personId,
		binding.extensionId,
		binding.target.sessionId,
		binding.target.conversationId,
	]);
}
export const slot = (value: Command) => (value.action === "add" ? "add" : "cancel:" + value.input.id);
export function pending(key: string, current: AgentRef): PendingState {
	try {
		const raw = sessionStorage.getItem(key);
		if (raw === null) return [];
		const values: unknown = JSON.parse(raw);
		if (!Array.isArray(values) || values.length > 129) return "unreadable";
		const rows = values.map((value): Pending => {
			if (
				!isRecord(value) ||
				value.version !== 1 ||
				typeof value.requestId !== "string" ||
				!/^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value.requestId) ||
				Object.keys(value).sort().join(",") !==
					(value.action === "add"
						? "action,delaySeconds,input,requestId,target,version"
						: "action,input,requestId,target,version")
			)
				return invalid();
			const request = decodeExtensionRequest({
				version: EXTENSION_VERSION,
				requestId: "schedule-storage",
				command: { op: "list", target: value.target },
			}).command;
			if (
				request.op !== "list" ||
				!request.target ||
				request.target.sessionId !== current.sessionId ||
				request.target.conversationId !== current.conversationId
			)
				return invalid();
			return { ...command(value), version: 1, requestId: value.requestId, target: request.target };
		});
		if (
			new Set(rows.map(slot)).size !== rows.length ||
			new Set(rows.map((row) => row.requestId)).size !== rows.length
		)
			return "unreadable";
		return rows;
	} catch {
		return "unreadable";
	}
}
const eventName = "pakka:schedule-request";
function notify(key: string) {
	window.dispatchEvent(new CustomEvent(eventName, { detail: key }));
}
export function retain(key: string, original: Pending) {
	const current = pending(key, original.target);
	if (
		current === "unreadable" ||
		current.some((row) => slot(row) === slot(original)) ||
		current.length >= 129
	)
		throw new Error("此操作已有待核对记录，本次没有提交。");
	command(original);
	sessionStorage.setItem(key, JSON.stringify([...current, original]));
	notify(key);
}
export function clear(key: string, original: Pending) {
	const current = pending(key, original.target);
	if (
		current === "unreadable" ||
		current.some((row) => slot(row) === slot(original) && row.requestId !== original.requestId)
	)
		throw new Error("原请求记录已变化，保留当前记录。");
	sessionStorage.setItem(key, JSON.stringify(current.filter((row) => row.requestId !== original.requestId)));
	notify(key);
}
export function watch(key: string, refresh: () => void) {
	const local = (event: Event) => {
		if ("detail" in event && event.detail === key) refresh();
	};
	const stored = (event: StorageEvent) => {
		if (event.storageArea === sessionStorage && event.key === key) refresh();
	};
	window.addEventListener(eventName, local);
	window.addEventListener("storage", stored);
	return () => {
		window.removeEventListener(eventName, local);
		window.removeEventListener("storage", stored);
	};
}
