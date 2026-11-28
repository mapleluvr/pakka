import type { AgentRef } from "@pakka/protocol/pocket";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import { command, requireTarget, sameTarget, target, type Command } from "./data.ts";

export type Pending = Command & {
	readonly version: 1;
	readonly requestId: string;
	readonly target: AgentRef;
};
export type PendingState = readonly Pending[] | "unreadable";
export const slot = (value: Command) => (value.action === "create" ? "create" : "hook:" + value.input.id);
export function same(first: Pending, second: Pending) {
	if (
		first.requestId !== second.requestId ||
		first.version !== second.version ||
		!sameTarget(first.target, second.target)
	)
		return false;
	if (first.action === "create")
		return (
			second.action === "create" &&
			first.input.name === second.input.name &&
			first.input.instructions === second.input.instructions &&
			first.input.signed === second.input.signed &&
			first.input.allowOutside === second.input.allowOutside
		);
	return (
		second.action !== "create" &&
		second.action === first.action &&
		first.input.id === second.input.id &&
		first.input.expectedVersion === second.input.expectedVersion
	);
}
export function key(binding: ExtensionServiceBinding) {
	const ref = requireTarget(binding);
	return JSON.stringify([
		"pakka-hooks-v1",
		binding.personId,
		binding.extensionId,
		ref.sessionId,
		ref.conversationId,
	]);
}
export function read(key: string, current: AgentRef): PendingState {
	try {
		const raw = sessionStorage.getItem(key);
		if (raw === null) return [];
		const values: unknown = JSON.parse(raw);
		if (!Array.isArray(values) || values.length > 257) return "unreadable";
		const rows = values.map((value): Pending => {
			if (
				!value ||
				typeof value !== "object" ||
				Array.isArray(value) ||
				Object.keys(value).sort().join(",") !== "action,input,requestId,target,version" ||
				!("version" in value) ||
				value.version !== 1 ||
				!("requestId" in value) ||
				typeof value.requestId !== "string" ||
				!/^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value.requestId) ||
				!("target" in value)
			)
				throw new Error("原请求不可读取。");
			const scope = target(value.target);
			if (scope.sessionId !== current.sessionId || scope.conversationId !== current.conversationId)
				throw new Error("原请求绑定不符。");
			return { ...command(value), version: 1, requestId: value.requestId, target: scope };
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
const eventName = "pakka:hook-request";
const notify = (key: string) => window.dispatchEvent(new CustomEvent(eventName, { detail: key }));
export function retain(key: string, original: Pending) {
	const current = read(key, original.target);
	if (
		current === "unreadable" ||
		current.length >= 257 ||
		current.some((row) => slot(row) === slot(original) || row.requestId === original.requestId)
	)
		throw new Error("此操作已有待核对记录，本次没有提交。");
	command(original);
	sessionStorage.setItem(key, JSON.stringify([...current, original]));
	notify(key);
}
export function clear(key: string, original: Pending) {
	const current = read(key, original.target);
	if (
		current === "unreadable" ||
		current.some(
			(row) =>
				(slot(row) === slot(original) && row.requestId !== original.requestId) ||
				(row.requestId === original.requestId && !same(row, original)),
		)
	)
		throw new Error("原请求记录已变化，保留当前记录。");
	sessionStorage.setItem(key, JSON.stringify(current.filter((row) => row.requestId !== original.requestId)));
	notify(key);
}
export function watch(key: string, update: () => void) {
	const local = (event: Event) => {
		if ("detail" in event && event.detail === key) update();
	};
	const stored = (event: StorageEvent) => {
		if (event.storageArea === sessionStorage && event.key === key) update();
	};
	window.addEventListener(eventName, local);
	window.addEventListener("storage", stored);
	return () => {
		window.removeEventListener(eventName, local);
		window.removeEventListener("storage", stored);
	};
}
