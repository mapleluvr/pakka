import { decodeValue, isRecord, type ExtensionJson, type Schema } from "@pakka/protocol/extensions";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import { empty, receiptInput, referenceSchema, replyInput, steerInput, textInput } from "./contract.ts";
import type { MemberRef } from "./dto.ts";

export type MemberAction = "send" | "steer" | "reply" | "withdraw" | "abort" | "retire";
export interface PendingMemberAction {
	readonly version: 1;
	readonly requestId: string;
	readonly action: MemberAction;
	readonly target: MemberRef;
	readonly input: ExtensionJson;
}
export type PendingMemberState = PendingMemberAction | "unreadable" | null;
const schemas: Record<MemberAction, Schema> = {
	send: textInput,
	steer: steerInput,
	reply: replyInput,
	withdraw: receiptInput,
	abort: empty,
	retire: empty,
};
const changed = "pakka:mas-member-pending";
const resource = (target: MemberRef) => JSON.stringify([target.sessionId, target.conversationId]);
export const memberPendingKey = (service: ExtensionServiceBinding, target: MemberRef) =>
	JSON.stringify(["pakka-mas-member-v1", service.personId, service.extensionId, resource(target)]);

export function readMemberPending(key: string, target: MemberRef): PendingMemberState {
	try {
		const raw = sessionStorage.getItem(key);
		if (raw === null) return null;
		const value: unknown = JSON.parse(raw);
		if (
			!isRecord(value) ||
			Object.keys(value).sort().join(",") !== "action,input,requestId,target,version" ||
			value.version !== 1 ||
			typeof value.requestId !== "string" ||
			!/^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value.requestId) ||
			typeof value.action !== "string" ||
			!Object.hasOwn(schemas, value.action)
		)
			return "unreadable";
		// SAFETY: the closed referenceSchema validates all five required identity strings before this DTO is used.
		const saved = decodeValue(referenceSchema, value.target) as unknown as MemberRef;
		if (resource(saved) !== resource(target)) return "unreadable";
		const action = value.action as MemberAction;
		return {
			version: 1,
			requestId: value.requestId,
			action,
			target: saved,
			input: decodeValue(schemas[action], value.input),
		};
	} catch {
		return "unreadable";
	}
}
export function retainMemberAction(key: string, value: PendingMemberAction) {
	if (readMemberPending(key, value.target) !== null) throw new Error("此成员已有待核对请求，本次没有提交。");
	decodeValue(schemas[value.action], value.input);
	decodeValue(referenceSchema, value.target);
	sessionStorage.setItem(key, JSON.stringify(value));
	window.dispatchEvent(new CustomEvent(changed, { detail: key }));
}
export function clearMemberAction(key: string, original: PendingMemberAction) {
	const saved = readMemberPending(key, original.target);
	if (saved === "unreadable" || (saved && saved.requestId !== original.requestId))
		throw new Error("待核对记录已变化，保留当前记录。");
	sessionStorage.removeItem(key);
	window.dispatchEvent(new CustomEvent(changed, { detail: key }));
}
export function watchMemberAction(key: string, update: () => void) {
	const local = (event: Event) => {
		if ("detail" in event && event.detail === key) update();
	};
	const storage = (event: StorageEvent) => {
		if (event.storageArea === sessionStorage && event.key === key) update();
	};
	window.addEventListener(changed, local);
	window.addEventListener("storage", storage);
	return () => {
		window.removeEventListener(changed, local);
		window.removeEventListener("storage", storage);
	};
}
