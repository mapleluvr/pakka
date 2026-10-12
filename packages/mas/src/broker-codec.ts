import { createHash } from "node:crypto";
import type { BrokerAgentRef } from "./broker-types.ts";

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
