import { createHash } from "node:crypto";
import type { BrokerAgentRef } from "./broker-types.ts";
import type { DeliveryReceipt } from "@pakka/agent";

export const validIdentity = (value: unknown): value is string =>
	typeof value === "string" &&
	!["constructor", "prototype", "__proto__"].includes(value) &&
	/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
export function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function agentRef(value: unknown): value is BrokerAgentRef {
	if (
		!record(value) ||
		![value.key, value.placement, value.sessionId].every(validIdentity) ||
		!record(value.conversation)
	)
		return false;
	const c = value.conversation;
	return (
		[c.key, c.sessionId, c.conversationId, c.incarnation, c.profile].every(validIdentity) &&
		c.sessionId === value.sessionId
	);
}
/** Shape/correlation only; neither serialized fields nor a hash establish actual delivery. */
export function nativeReceipt(
	value: unknown,
	relayId: string,
	target: BrokerAgentRef,
): value is DeliveryReceipt {
	if (
		!record(value) ||
		!validIdentity(value.id) ||
		value.requestId !== "relay." + relayId ||
		typeof value.principal !== "string" ||
		!/^relay\.[0-9a-f]{64}$/.test(value.principal) ||
		value.source !== null ||
		!record(value.target) ||
		digest(value.target) !== digest(target.conversation) ||
		!["queued", "placed", "done", "unanswered", "unknown"].includes(String(value.status)) ||
		(value.entryId !== undefined && !validIdentity(value.entryId)) ||
		(value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 65536))
	)
		return false;
	return true;
}
export function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function immutable<T>(value: T): T {
	const result = structuredClone(value);
	function freeze(object: unknown): void {
		if (object && typeof object === "object") {
			for (const child of Object.values(object)) freeze(child);
			Object.freeze(object);
		}
	}
	freeze(result);
	return result;
}
