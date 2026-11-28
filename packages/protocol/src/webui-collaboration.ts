import { identity } from "./index.ts";
import { frozen, isRecord } from "./extensions.ts";
import { decodeTarget } from "./extension-rpc.ts";
import {
	decodePocketRequest,
	isPocketCollaborationView,
	POCKET_VERSION,
	type AgentRef,
	type PocketCollaborationView,
} from "./pocket.ts";

export type CollaborationAction =
	| {
			readonly kind: "post";
			readonly text: string;
			readonly quoteId?: string;
			readonly mentions?: readonly string[];
	  }
	| { readonly kind: "note"; readonly expectedVersion: number; readonly text: string }
	| { readonly kind: "react"; readonly messageId: string; readonly emoji: string; readonly active: boolean }
	| { readonly kind: "pin"; readonly messageId: string; readonly pinned: boolean }
	| {
			readonly kind: "driver";
			readonly expectedVersion: number;
			readonly action: "claim" | "release" | "take";
			readonly ttlMs?: number;
	  };
export interface CollaborationRequest {
	readonly requestId: string;
	readonly target: AgentRef;
	readonly action: CollaborationAction;
}
export type CollaborationOutcome =
	| { readonly kind: "post"; readonly messageId: string }
	| { readonly kind: "note"; readonly version: number }
	| { readonly kind: "react" }
	| { readonly kind: "pin" }
	| { readonly kind: "driver"; readonly driver: PocketCollaborationView["driver"] };
export interface CollaborationReceipt {
	readonly actorId: string;
	readonly original: CollaborationRequest;
	/** Historical commit, independent of later shared edits and lease changes. */
	readonly version: number;
	readonly at: number;
	readonly result: CollaborationOutcome;
}
export interface CollaborationView {
	readonly target: AgentRef;
	readonly snapshot: PocketCollaborationView;
	readonly canEditNote: boolean;
	readonly canPin: boolean;
	readonly canControl: boolean;
	readonly canTake: boolean;
}
function shape(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
	if (
		!isRecord(value) ||
		required.some((key) => !Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
	)
		throw new Error("Invalid closed collaboration value");
}
const count = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function decodeCollaborationRequest(value: unknown): CollaborationRequest {
	shape(value, ["requestId", "target", "action"]);
	if (!identity(value.requestId)) throw new Error("Invalid original collaboration identity");
	const target = decodeTarget(value.target),
		action = value.action;
	if (!isRecord(action)) throw new Error("Invalid collaboration action");
	let command: unknown;
	switch (action.kind) {
		case "post":
			shape(action, ["kind", "text"], ["quoteId", "mentions"]);
			command = {
				op: "collaboration.post",
				target,
				input: {
					requestId: value.requestId,
					text: action.text,
					...(Object.hasOwn(action, "quoteId") ? { quoteId: action.quoteId } : {}),
					...(Object.hasOwn(action, "mentions") ? { mentions: action.mentions } : {}),
				},
			};
			break;
		case "note":
			shape(action, ["kind", "expectedVersion", "text"]);
			command = {
				op: "collaboration.note",
				target,
				input: { expectedVersion: action.expectedVersion, text: action.text },
			};
			break;
		case "react":
			shape(action, ["kind", "messageId", "emoji", "active"]);
			command = {
				op: "collaboration.react",
				target,
				input: { messageId: action.messageId, emoji: action.emoji, active: action.active },
			};
			break;
		case "pin":
			shape(action, ["kind", "messageId", "pinned"]);
			command = {
				op: "collaboration.pin",
				target,
				input: { messageId: action.messageId, pinned: action.pinned },
			};
			break;
		case "driver":
			shape(action, ["kind", "expectedVersion", "action"], ["ttlMs"]);
			command = {
				op: "collaboration.driver",
				target,
				input: {
					expectedVersion: action.expectedVersion,
					action: action.action,
					...(Object.hasOwn(action, "ttlMs") ? { ttlMs: action.ttlMs } : {}),
				},
			};
			break;
		default:
			throw new Error("Unsupported collaboration action");
	}
	const decoded = decodePocketRequest({
		version: POCKET_VERSION,
		requestId: value.requestId,
		command,
	}).command;
	let checked: CollaborationAction;
	switch (decoded.op) {
		case "collaboration.post":
			checked = {
				kind: "post",
				text: decoded.input.text,
				...(decoded.input.quoteId !== undefined ? { quoteId: decoded.input.quoteId } : {}),
				...(decoded.input.mentions !== undefined ? { mentions: decoded.input.mentions } : {}),
			};
			break;
		case "collaboration.note":
			checked = { kind: "note", ...decoded.input };
			break;
		case "collaboration.react":
			checked = { kind: "react", ...decoded.input };
			break;
		case "collaboration.pin":
			checked = { kind: "pin", ...decoded.input };
			break;
		case "collaboration.driver":
			checked = { kind: "driver", ...decoded.input };
			break;
		default:
			throw new Error("Invalid native collaboration action");
	}
	return frozen({ requestId: value.requestId, target, action: checked });
}

/** Fixed field order, complete original binding and parameters; no mutable current-state values. */
export function collaborationIntent(request: CollaborationRequest): string {
	const { target, action } = request;
	const binding = [target.key, target.sessionId, target.conversationId, target.incarnation, target.profile];
	let parameters: readonly unknown[];
	switch (action.kind) {
		case "post":
			parameters = [action.kind, action.text, action.quoteId ?? null, action.mentions ?? null];
			break;
		case "note":
			parameters = [action.kind, action.expectedVersion, action.text];
			break;
		case "react":
			parameters = [action.kind, action.messageId, action.emoji, action.active];
			break;
		case "pin":
			parameters = [action.kind, action.messageId, action.pinned];
			break;
		case "driver":
			parameters = [action.kind, action.expectedVersion, action.action, action.ttlMs ?? null];
			break;
	}
	return JSON.stringify([request.requestId, binding, parameters]);
}
export function decodeCollaborationOutcome(value: unknown): CollaborationOutcome {
	if (!isRecord(value)) throw new Error("Invalid collaboration outcome");
	switch (value.kind) {
		case "post":
			shape(value, ["kind", "messageId"]);
			if (!identity(value.messageId)) throw new Error("Invalid committed human message");
			return frozen({ kind: "post", messageId: value.messageId });
		case "note":
			shape(value, ["kind", "version"]);
			if (!count(value.version) || value.version < 1) throw new Error("Invalid committed note version");
			return frozen({ kind: "note", version: value.version });
		case "react":
			shape(value, ["kind"]);
			return frozen({ kind: "react" });
		case "pin":
			shape(value, ["kind"]);
			return frozen({ kind: "pin" });
		case "driver": {
			shape(value, ["kind", "driver"]);
			const driver = value.driver;
			shape(driver, ["version", "personId", "expiresAt"]);
			if (
				!count(driver.version) ||
				driver.version < 1 ||
				!(
					(driver.personId === null && driver.expiresAt === null) ||
					(identity(driver.personId) && count(driver.expiresAt))
				)
			)
				throw new Error("Invalid committed driver lease");
			if (driver.personId === null && driver.expiresAt === null)
				return frozen({
					kind: "driver",
					driver: { version: driver.version, personId: null, expiresAt: null },
				});
			if (identity(driver.personId) && count(driver.expiresAt))
				return frozen({
					kind: "driver",
					driver: { version: driver.version, personId: driver.personId, expiresAt: driver.expiresAt },
				});
			throw new Error("Invalid driver result");
		}
		default:
			throw new Error("Unsupported collaboration outcome");
	}
}
export function decodeCollaborationReceipt(value: unknown): CollaborationReceipt {
	shape(value, ["actorId", "original", "version", "at", "result"]);
	const original = decodeCollaborationRequest(value.original),
		result = decodeCollaborationOutcome(value.result);
	if (
		!identity(value.actorId) ||
		!count(value.version) ||
		value.version < 1 ||
		!count(value.at) ||
		result.kind !== original.action.kind
	)
		throw new Error("Invalid collaboration receipt binding");
	if (
		original.action.kind === "note" &&
		result.kind === "note" &&
		result.version !== original.action.expectedVersion + 1
	)
		throw new Error("Wrong historical note version");
	if (
		original.action.kind === "driver" &&
		result.kind === "driver" &&
		(result.driver.version !== original.action.expectedVersion + 1 ||
			(original.action.action === "release"
				? result.driver.personId !== null
				: result.driver.personId !== value.actorId))
	)
		throw new Error("Wrong historical driver lease");
	return frozen({ actorId: value.actorId, original, version: value.version, at: value.at, result });
}
export function matchesCollaborationReceipt(
	receipt: CollaborationReceipt,
	original: CollaborationRequest,
	actorId: string,
): boolean {
	return (
		receipt.actorId === actorId && collaborationIntent(receipt.original) === collaborationIntent(original)
	);
}
export function decodeCollaborationView(value: unknown): CollaborationView {
	shape(value, ["target", "snapshot", "canEditNote", "canPin", "canControl", "canTake"]);
	const target = decodeTarget(value.target);
	if (!isPocketCollaborationView(value.snapshot)) throw new Error("Invalid collaboration snapshot");
	const snapshot = value.snapshot;
	if (
		snapshot.conversationId !== target.conversationId ||
		(snapshot.sessionId !== undefined && snapshot.sessionId !== target.sessionId) ||
		typeof value.canEditNote !== "boolean" ||
		typeof value.canPin !== "boolean" ||
		typeof value.canControl !== "boolean" ||
		typeof value.canTake !== "boolean"
	)
		throw new Error("Wrong collaboration view binding");
	return frozen({
		target,
		snapshot,
		canEditNote: value.canEditNote,
		canPin: value.canPin,
		canControl: value.canControl,
		canTake: value.canTake,
	});
}
