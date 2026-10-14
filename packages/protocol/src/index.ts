/** Versioned DTO/validation only. No runtime, credentials, filesystem or authority objects. */
export const PROTOCOL_VERSION = 1 as const;
export const MAX_WIRE_BYTES = 131072;
export interface AgentRef {
	readonly key: string;
	readonly sessionId: string;
	readonly conversationId: string;
	readonly incarnation: string;
	readonly profile: string;
}
export type Phase =
	| "preparing"
	| "ready"
	| "active"
	| "stopping"
	| "retired"
	| "failed"
	| "unknown"
	| "ended";
export interface Member {
	readonly key: string;
	readonly ref: AgentRef;
	readonly owner: string;
	readonly lifetime: "persistent" | "task-bound" | "temporary" | "background";
	readonly phase: Phase;
	readonly reason?: string;
}
export interface Receipt {
	readonly id: string;
	readonly requestId: string;
	readonly principal: string;
	readonly source: AgentRef | null;
	readonly target: AgentRef;
	readonly status: "queued" | "placed" | "done" | "unanswered" | "unknown";
	readonly entryId?: string;
	readonly reason?: string;
}
export interface SendInput {
	readonly requestId: string;
	readonly text: string;
	readonly mode?: "prompt" | "steer" | "followUp";
}
export type Command =
	| { readonly op: "hello" | "snapshot" }
	| { readonly op: "spawn"; readonly key: string; readonly profile?: string }
	| { readonly op: "send"; readonly target: AgentRef; readonly input: SendInput }
	| { readonly op: "reply"; readonly receiptId: string; readonly input: SendInput }
	| { readonly op: "receipt" | "wait" | "withdraw"; readonly id: string }
	| { readonly op: "inspect" | "abort" | "retire"; readonly target: AgentRef }
	| { readonly op: "configure"; readonly target: AgentRef; readonly profile: string }
	| { readonly op: "fork"; readonly target: AgentRef; readonly key: string; readonly entryId: string }
	| { readonly op: "revoke"; readonly principal: string };
export interface Request {
	readonly version: 1;
	readonly requestId: string;
	readonly command: Command;
}
export type Result =
	| {
			readonly kind: "hello";
			readonly principal: string;
			readonly sessionId: string;
			readonly versions: readonly number[];
	  }
	| {
			readonly kind: "snapshot";
			readonly sessionId: string;
			readonly namespace: string;
			readonly version: number;
			readonly phase: Phase;
			readonly members: readonly Member[];
	  }
	| { readonly kind: "member"; readonly member: Member }
	| { readonly kind: "receipt"; readonly receipt: Receipt }
	| { readonly kind: "revoked"; readonly principal: string };
export type ErrorCode =
	| "INVALID_REQUEST"
	| "VERSION_MISMATCH"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "CAPACITY"
	| "UNKNOWN"
	| "UNSUPPORTED";
export interface Failure {
	readonly code: ErrorCode;
	readonly outcome: "denied" | "unknown";
	readonly message: string;
}
export type Response = { readonly version: 1; readonly requestId: string; readonly serverId: string } & (
	| { readonly result: Result }
	| { readonly error: Failure }
);

export function identity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		!["constructor", "prototype", "__proto__"].includes(value) &&
		/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
	);
}
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function shape(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): value is Record<string, unknown> {
	return (
		record(value) &&
		required.every((key) => Object.hasOwn(value, key)) &&
		Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
	);
}
function boundedString(value: unknown, max = 65536): value is string {
	return typeof value === "string" && value.length <= max;
}
function ref(value: unknown): value is AgentRef {
	return (
		shape(value, ["key", "sessionId", "conversationId", "incarnation", "profile"]) &&
		Object.values(value).every(identity)
	);
}
function send(value: unknown): value is SendInput {
	return (
		shape(value, ["requestId", "text"], ["mode"]) &&
		identity(value.requestId) &&
		boundedString(value.text) &&
		!!value.text.trim() &&
		!value.text.startsWith("/") &&
		(value.mode === undefined || ["prompt", "steer", "followUp"].includes(String(value.mode)))
	);
}
function command(value: unknown): value is Command {
	if (!record(value)) return false;
	switch (value.op) {
		case "hello":
		case "snapshot":
			return shape(value, ["op"]);
		case "spawn":
			return (
				shape(value, ["op", "key"], ["profile"]) &&
				identity(value.key) &&
				(value.profile === undefined || identity(value.profile))
			);
		case "send":
			return shape(value, ["op", "target", "input"]) && ref(value.target) && send(value.input);
		case "reply":
			return shape(value, ["op", "receiptId", "input"]) && identity(value.receiptId) && send(value.input);
		case "receipt":
		case "wait":
		case "withdraw":
			return shape(value, ["op", "id"]) && identity(value.id);
		case "inspect":
		case "abort":
		case "retire":
			return shape(value, ["op", "target"]) && ref(value.target);
		case "configure":
			return shape(value, ["op", "target", "profile"]) && ref(value.target) && identity(value.profile);
		case "fork":
			return (
				shape(value, ["op", "target", "key", "entryId"]) &&
				ref(value.target) &&
				identity(value.key) &&
				identity(value.entryId)
			);
		case "revoke":
			return shape(value, ["op", "principal"]) && identity(value.principal);
		default:
			return false;
	}
}
const phases: readonly string[] = [
	"preparing",
	"ready",
	"active",
	"stopping",
	"retired",
	"failed",
	"unknown",
	"ended",
];
function member(value: unknown): value is Member {
	return (
		shape(value, ["key", "ref", "owner", "lifetime", "phase"], ["reason"]) &&
		identity(value.key) &&
		ref(value.ref) &&
		identity(value.owner) &&
		["persistent", "task-bound", "temporary", "background"].includes(String(value.lifetime)) &&
		phases.includes(String(value.phase)) &&
		(value.reason === undefined || boundedString(value.reason))
	);
}
function receipt(value: unknown): value is Receipt {
	return (
		shape(value, ["id", "requestId", "principal", "source", "target", "status"], ["entryId", "reason"]) &&
		identity(value.id) &&
		identity(value.requestId) &&
		identity(value.principal) &&
		(value.source === null || ref(value.source)) &&
		ref(value.target) &&
		["queued", "placed", "done", "unanswered", "unknown"].includes(String(value.status)) &&
		(value.entryId === undefined || identity(value.entryId)) &&
		(value.reason === undefined || boundedString(value.reason))
	);
}
function result(value: unknown): value is Result {
	if (!record(value)) return false;
	switch (value.kind) {
		case "hello":
			return (
				shape(value, ["kind", "principal", "sessionId", "versions"]) &&
				identity(value.principal) &&
				identity(value.sessionId) &&
				Array.isArray(value.versions) &&
				value.versions.length === 1 &&
				value.versions[0] === 1
			);
		case "snapshot":
			return (
				shape(value, ["kind", "sessionId", "namespace", "version", "phase", "members"]) &&
				identity(value.sessionId) &&
				identity(value.namespace) &&
				Number.isSafeInteger(value.version) &&
				Number(value.version) >= 0 &&
				phases.includes(String(value.phase)) &&
				Array.isArray(value.members) &&
				value.members.length <= 512 &&
				value.members.every((item) => member(item) && item.ref.sessionId === value.sessionId) &&
				new Set(value.members.map((item) => item.key)).size === value.members.length
			);
		case "member":
			return shape(value, ["kind", "member"]) && member(value.member);
		case "receipt":
			return shape(value, ["kind", "receipt"]) && receipt(value.receipt);
		case "revoked":
			return shape(value, ["kind", "principal"]) && identity(value.principal);
		default:
			return false;
	}
}
function failure(value: unknown): value is Failure {
	return (
		shape(value, ["code", "outcome", "message"]) &&
		[
			"INVALID_REQUEST",
			"VERSION_MISMATCH",
			"UNAUTHORIZED",
			"FORBIDDEN",
			"CAPACITY",
			"UNKNOWN",
			"UNSUPPORTED",
		].includes(String(value.code)) &&
		["denied", "unknown"].includes(String(value.outcome)) &&
		boundedString(value.message, 512)
	);
}
type WireValue =
	| null
	| string
	| boolean
	| number
	| readonly WireValue[]
	| { readonly [key: string]: WireValue };
function detached(value: unknown): WireValue {
	const seen = new Set<object>();
	function finite(item: unknown, depth: number): void {
		if (depth > 32) throw new Error("Protocol depth limit");
		if (item === null || typeof item === "boolean" || typeof item === "string") return;
		if (typeof item === "number" && Number.isFinite(item)) return;
		if (!item || typeof item !== "object" || seen.has(item)) throw new Error("Invalid protocol JSON");
		const proto = Object.getPrototypeOf(item);
		if (!Array.isArray(item) && proto !== Object.prototype && proto !== null)
			throw new Error("Invalid protocol object");
		seen.add(item);
		for (const [key, child] of Object.entries(item)) {
			if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid protocol key");
			finite(child, depth + 1);
		}
		seen.delete(item);
	}
	finite(value, 0);
	let encoded: string;
	try {
		encoded = JSON.stringify(value);
	} catch {
		throw new Error("Invalid protocol JSON");
	}
	if (new TextEncoder().encode(encoded).byteLength > MAX_WIRE_BYTES)
		throw new Error("Protocol byte size limit");
	try {
		return JSON.parse(encoded);
	} catch {
		throw new Error("Invalid protocol JSON");
	}
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
export function decodeRequest(input: unknown): Request {
	const value = detached(input);
	if (
		!shape(value, ["version", "requestId", "command"]) ||
		value.version !== 1 ||
		!identity(value.requestId) ||
		!command(value.command)
	)
		throw new Error("Invalid protocol request schema/version");
	// SAFETY: complete closed version, identity and command discriminants validated above.
	return freeze(value as unknown as Request);
}
export function decodeResponse(input: unknown, requestId: string): Response {
	const value = detached(input);
	if (
		!record(value) ||
		value.version !== 1 ||
		value.requestId !== requestId ||
		!identity(value.requestId) ||
		!identity(value.serverId) ||
		!(
			(shape(value, ["version", "requestId", "serverId", "result"]) && result(value.result)) ||
			(shape(value, ["version", "requestId", "serverId", "error"]) && failure(value.error))
		)
	)
		throw new Error("Invalid protocol response schema/request identity");
	// SAFETY: exactly one fully validated closed result/error plus correlated envelope fields.
	return freeze(value as unknown as Response);
}
