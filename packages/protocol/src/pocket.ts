/** Pocket v2 is an explicit, browser-safe product protocol. Headless v1 stays in index.ts. */
import { identity } from "./index.ts";
import type { AgentRef } from "./index.ts";
export type { AgentRef } from "./index.ts";
export const POCKET_VERSION = 2 as const;
export const POCKET_MAX_BYTES = 2 * 1024 * 1024;
export type PocketRole = "viewer" | "sender" | "driver" | "admin";
export type PocketResources = "*" | readonly string[];
export interface PocketPerson {
	readonly id: string;
	readonly name: string;
	readonly role: PocketRole;
	readonly resources: PocketResources;
	readonly active: boolean;
}
export interface PocketInvite {
	readonly id: string;
	readonly role: PocketRole;
	readonly resources: PocketResources;
	readonly expiresAt: number;
	readonly status: "pending" | "redeemed" | "revoked";
}
export interface PocketJsonObject {
	readonly [key: string]: PocketJson;
}
export type PocketJson = null | string | number | boolean | readonly PocketJson[] | PocketJsonObject;
export type PocketPart =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "thinking"; readonly thinking: string }
	| { readonly type: "image"; readonly data: string; readonly mimeType: string }
	| {
			readonly type: "toolCall";
			readonly id: string;
			readonly name: string;
			readonly arguments: PocketJsonObject;
	  };
export interface PocketMessage {
	readonly role: "user" | "assistant" | "toolResult";
	readonly content: string | readonly PocketPart[];
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly isError?: boolean;
	readonly stopReason?: string;
}
export interface PocketDisplay {
	readonly namespace: string;
	readonly actorId: string;
	readonly requestId: string;
	readonly kind: "card" | "chat";
	readonly text: string;
}
export interface PocketSnapshot {
	readonly ref: AgentRef;
	readonly entries: readonly {
		readonly id: string;
		readonly conversationId: string;
		readonly kind: string;
		readonly taskId?: string;
		readonly messages: readonly PocketMessage[];
		readonly display?: PocketDisplay;
	}[];
	readonly entriesTruncated: boolean;
	readonly olderBeforeId?: string;
	readonly live: {
		readonly busy: boolean;
		readonly message?: PocketMessage;
		readonly tools: readonly {
			readonly callId: string;
			readonly name: string;
			readonly status: "pending" | "running" | "done";
			readonly taskId?: string;
			readonly output?: string;
		}[];
	};
	readonly usage: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly totalTokens: number;
		readonly cost: number | null;
	};
}
export interface PocketConfiguration {
	readonly ref: AgentRef;
	readonly choices: readonly { readonly id: string; readonly model: string }[];
	readonly canConfigure: boolean;
	readonly usage: PocketSnapshot["usage"];
	readonly session: {
		readonly limits: {
			readonly maxConversations: number;
			readonly maxPrimaryAttempts: number;
			readonly maxAuxiliaryAttempts: number;
		};
		readonly budget: { readonly primaryAttempts: number; readonly auxiliaryAttempts: number };
	} | null;
}
export interface PocketCredentialStatus {
	readonly version: number;
	readonly configured: boolean;
}
export interface PocketInputReceipt {
	readonly id: string;
	readonly requestId: string;
	readonly actorId: string;
	readonly target: AgentRef;
	readonly status: "queued" | "placed" | "done" | "unanswered" | "unknown";
	readonly entryId?: string;
}
export interface PocketChatMessage {
	readonly id: string;
	readonly requestId: string;
	readonly authorId: string;
	readonly authorName: string;
	readonly text: string;
	readonly createdAt: number;
	readonly quoteId: string | null;
	readonly mentions: readonly string[];
	readonly pinned: boolean;
	readonly reactions: readonly { readonly emoji: string; readonly people: readonly string[] }[];
}
export interface PocketCollaborationView {
	readonly conversationId: string;
	readonly version: number;
	readonly messages: readonly PocketChatMessage[];
	readonly note: {
		readonly version: number;
		readonly text: string;
		readonly authorId: string | null;
		readonly updatedAt: number | null;
	};
	readonly driver: {
		readonly version: number;
		readonly personId: string | null;
		readonly expiresAt: number | null;
	};
	readonly presence: readonly {
		readonly personId: string;
		readonly name: string;
		readonly state: "here" | "typing";
		readonly expiresAt: number;
	}[];
}
export type PocketCollaborationCommand =
	| { readonly op: "collaboration.read"; readonly target: AgentRef }
	| {
			readonly op: "collaboration.post";
			readonly target: AgentRef;
			readonly input: {
				readonly requestId: string;
				readonly text: string;
				readonly quoteId?: string;
				readonly mentions?: readonly string[];
			};
	  }
	| {
			readonly op: "collaboration.note";
			readonly target: AgentRef;
			readonly input: { readonly expectedVersion: number; readonly text: string };
	  }
	| {
			readonly op: "collaboration.react";
			readonly target: AgentRef;
			readonly input: { readonly messageId: string; readonly emoji: string; readonly active: boolean };
	  }
	| {
			readonly op: "collaboration.pin";
			readonly target: AgentRef;
			readonly input: { readonly messageId: string; readonly pinned: boolean };
	  }
	| {
			readonly op: "collaboration.driver";
			readonly target: AgentRef;
			readonly input: {
				readonly expectedVersion: number;
				readonly action: "claim" | "release" | "take";
				readonly ttlMs?: number;
			};
	  }
	| {
			readonly op: "collaboration.presence";
			readonly target: AgentRef;
			readonly input: { readonly state: "here" | "typing" | "away" | "leave" };
	  };
export interface PocketNotificationStatus {
	readonly publicKey: string;
	readonly preferences: {
		readonly done: boolean;
		readonly approval: boolean;
		readonly chat: boolean;
		readonly mention: boolean;
	};
	readonly devices: readonly { readonly id: string; readonly subscriptionKey: string }[];
}
export type PocketNotificationCommand =
	| { readonly op: "notification.status"; readonly target: AgentRef }
	| {
			readonly op: "notification.subscribe";
			readonly target: AgentRef;
			readonly input: {
				readonly requestId: string;
				readonly subscription: {
					readonly endpoint: string;
					readonly keys: { readonly p256dh: string; readonly auth: string };
				};
			};
	  }
	| {
			readonly op: "notification.unsubscribe";
			readonly target: AgentRef;
			readonly input: { readonly requestId: string; readonly deviceId: string };
	  }
	| {
			readonly op: "notification.preferences";
			readonly target: AgentRef;
			readonly input: {
				readonly requestId: string;
				readonly preferences: Partial<PocketNotificationStatus["preferences"]>;
			};
	  };
export type PocketCommand =
	| PocketNotificationCommand
	| PocketCollaborationCommand
	| { readonly op: "configuration"; readonly target: AgentRef }
	| { readonly op: "credential.status" }
	| {
			readonly op: "credential.replace";
			readonly input: {
				readonly requestId: string;
				readonly expectedVersion: number;
				readonly secret: string;
			};
	  }
	| {
			readonly op: "credential.clear";
			readonly input: { readonly requestId: string; readonly expectedVersion: number };
	  }
	| { readonly op: "hello" | "list" | "people" | "session.rotate" | "session.logout" }
	| { readonly op: "create"; readonly requestId: string; readonly name: string; readonly profile: string }
	| { readonly op: "configure"; readonly target: AgentRef; readonly profile: string }
	| {
			readonly op: "fork";
			readonly target: AgentRef;
			readonly requestId: string;
			readonly name: string;
			readonly profile: string;
			readonly entryId: string;
	  }
	| {
			readonly op: "read";
			readonly target: AgentRef;
			readonly page?: { readonly limit?: number; readonly beforeEntryId?: string };
	  }
	| {
			readonly op: "display";
			readonly target: AgentRef;
			readonly requestId: string;
			readonly kind: "card" | "chat";
			readonly text: string;
	  }
	| {
			readonly op: "submit";
			readonly target: AgentRef;
			readonly input: {
				readonly requestId: string;
				readonly text: string;
				readonly mode: "prompt" | "steer" | "followUp";
			};
	  }
	| { readonly op: "receipt" | "wait" | "withdraw"; readonly id: string }
	| { readonly op: "abort"; readonly target: AgentRef }
	| {
			readonly op: "invite";
			readonly requestId: string;
			readonly personId?: string;
			readonly role: PocketRole;
			readonly resources: PocketResources;
			readonly ttlMs: number;
	  }
	| { readonly op: "invite.revoke" | "person.revoke"; readonly id: string }
	| {
			readonly op: "person.set";
			readonly personId: string;
			readonly role: PocketRole;
			readonly resources: PocketResources;
	  };
export interface PocketRequest {
	readonly version: 2;
	readonly requestId: string;
	readonly command: PocketCommand;
}
export type PocketResult =
	| {
			readonly kind: "hello";
			readonly versions: readonly [2];
			readonly person: PocketPerson;
			readonly sessionId: string;
	  }
	| {
			readonly kind: "list";
			readonly conversations: readonly AgentRef[];
			readonly titles?: Readonly<Record<string, string>>;
	  }
	| { readonly kind: "reference"; readonly ref: AgentRef }
	| { readonly kind: "configuration"; readonly configuration: PocketConfiguration }
	| { readonly kind: "notification"; readonly target: AgentRef; readonly status: PocketNotificationStatus }
	| { readonly kind: "credential"; readonly status: PocketCredentialStatus }
	| { readonly kind: "collaboration"; readonly snapshot: PocketCollaborationView }
	| { readonly kind: "conversation"; readonly snapshot: PocketSnapshot }
	| {
			readonly kind: "people";
			readonly people: readonly PocketPerson[];
			readonly invites: readonly PocketInvite[];
	  }
	| {
			readonly kind: "invite";
			readonly invite: PocketInvite;
			readonly token: string | null;
			readonly qr?: string;
	  }
	| {
			readonly kind: "display";
			readonly receipt: {
				readonly ref: AgentRef;
				readonly namespace: string;
				readonly actorId: string;
				readonly requestId: string;
				readonly entryId: string;
			};
	  }
	| { readonly kind: "receipt"; readonly receipt: PocketInputReceipt }
	| { readonly kind: "session"; readonly person: PocketPerson; readonly expiresAt: number }
	| { readonly kind: "updated" };
export type PocketErrorCode =
	| "INVALID_REQUEST"
	| "VERSION_MISMATCH"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "CONFLICT"
	| "CAPACITY"
	| "UNKNOWN"
	| "UNSUPPORTED";
export interface PocketFailure {
	readonly code: PocketErrorCode;
	readonly outcome: "denied" | "unknown";
	readonly message: string;
}
export type PocketResponse = {
	readonly version: 2;
	readonly requestId: string;
	readonly serverId: string;
} & ({ readonly result: PocketResult } | { readonly error: PocketFailure });
export type PocketEvent = {
	readonly version: 2;
	readonly serverId: string;
	readonly streamId: string;
	readonly sequence: number;
} & (
	| { readonly kind: "conversation"; readonly snapshot: PocketSnapshot }
	| { readonly kind: "collaboration"; readonly snapshot: PocketCollaborationView }
	| { readonly kind: "resnapshot" | "invalidated" }
);

function record(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}
function shape(
	v: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): v is Record<string, unknown> {
	return (
		record(v) &&
		required.every((key) => Object.hasOwn(v, key)) &&
		Object.keys(v).every((key) => required.includes(key) || optional.includes(key))
	);
}
const string = (v: unknown, max = 65536): v is string => typeof v === "string" && v.length <= max;
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
	Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const role = (v: unknown): v is PocketRole => ["viewer", "sender", "driver", "admin"].includes(v as string);
const resources = (v: unknown): v is PocketResources =>
	v === "*" ||
	(Array.isArray(v) && v.length > 0 && v.length <= 128 && v.every(identity) && new Set(v).size === v.length);
const secret = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
const ref = (v: unknown): v is AgentRef =>
	shape(v, ["key", "sessionId", "conversationId", "incarnation", "profile"]) &&
	Object.values(v).every(identity);
const person = (v: unknown): v is PocketPerson =>
	shape(v, ["id", "name", "role", "resources", "active"]) &&
	identity(v.id) &&
	string(v.name, 80) &&
	!!v.name.trim() &&
	!/[\x00-\x1f\x7f]/.test(v.name) &&
	role(v.role) &&
	resources(v.resources) &&
	typeof v.active === "boolean";
const invite = (v: unknown): v is PocketInvite =>
	shape(v, ["id", "role", "resources", "expiresAt", "status"]) &&
	identity(v.id) &&
	role(v.role) &&
	resources(v.resources) &&
	integer(v.expiresAt, 1) &&
	["pending", "redeemed", "revoked"].includes(v.status as string);
const entryId = (v: unknown): v is string =>
	typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v);
const part = (v: unknown): v is PocketPart => {
	if (!record(v)) return false;
	switch (v.type) {
		case "text":
			return shape(v, ["type", "text"]) && string(v.text);
		case "thinking":
			return shape(v, ["type", "thinking"]) && string(v.thinking);
		case "image":
			return (
				shape(v, ["type", "data", "mimeType"]) &&
				string(v.data, 1024 * 1024) &&
				string(v.mimeType, 100) &&
				/^image\/[a-zA-Z0-9.+-]+$/.test(v.mimeType)
			);
		case "toolCall":
			return (
				shape(v, ["type", "id", "name", "arguments"]) &&
				entryId(v.id) &&
				entryId(v.name) &&
				record(v.arguments)
			);
		default:
			return false;
	}
};
const message = (v: unknown): v is PocketMessage => {
	if (!record(v)) return false;
	const content =
		string(v.content) || (Array.isArray(v.content) && v.content.length <= 256 && v.content.every(part));
	if (!content) return false;
	if (v.role === "user") return shape(v, ["role", "content"]);
	if (v.role === "assistant")
		return (
			shape(v, ["role", "content"], ["stopReason"]) &&
			(v.stopReason === undefined ||
				["stop", "length", "toolUse", "error", "aborted"].includes(v.stopReason as string))
		);
	return (
		v.role === "toolResult" &&
		shape(v, ["role", "content", "toolCallId", "toolName", "isError"]) &&
		entryId(v.toolCallId) &&
		entryId(v.toolName) &&
		typeof v.isError === "boolean"
	);
};
const display = (v: unknown): v is PocketDisplay =>
	shape(v, ["namespace", "actorId", "requestId", "kind", "text"]) &&
	identity(v.namespace) &&
	identity(v.actorId) &&
	identity(v.requestId) &&
	["chat", "card"].includes(v.kind as string) &&
	string(v.text, 16384);
function snapshot(v: unknown): v is PocketSnapshot {
	if (
		!shape(v, ["ref", "entries", "entriesTruncated", "live", "usage"], ["olderBeforeId"]) ||
		!ref(v.ref) ||
		!Array.isArray(v.entries) ||
		v.entries.length > 256 ||
		typeof v.entriesTruncated !== "boolean" ||
		(v.olderBeforeId !== undefined && (!v.entriesTruncated || !entryId(v.olderBeforeId))) ||
		!shape(v.live, ["busy", "tools"], ["message"]) ||
		typeof v.live.busy !== "boolean" ||
		!Array.isArray(v.live.tools) ||
		v.live.tools.length > 256 ||
		(v.live.message !== undefined && !message(v.live.message)) ||
		!shape(v.usage, ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"])
	)
		return false;
	const id = v.ref.conversationId;
	if (
		!v.entries.every(
			(e) =>
				shape(e, ["id", "conversationId", "kind", "messages"], ["taskId", "display"]) &&
				entryId(e.id) &&
				e.conversationId === id &&
				entryId(e.kind) &&
				(e.taskId === undefined || entryId(e.taskId)) &&
				Array.isArray(e.messages) &&
				e.messages.length <= 256 &&
				e.messages.every(message) &&
				(e.display === undefined || display(e.display)),
		)
	)
		return false;
	if (
		!v.live.tools.every(
			(t) =>
				shape(t, ["callId", "name", "status"], ["taskId", "output"]) &&
				entryId(t.callId) &&
				entryId(t.name) &&
				["pending", "running", "done"].includes(t.status as string) &&
				(t.taskId === undefined || entryId(t.taskId)) &&
				(t.output === undefined || string(t.output)),
		)
	)
		return false;
	return (
		[v.usage.input, v.usage.output, v.usage.cacheRead, v.usage.cacheWrite, v.usage.totalTokens].every((n) =>
			integer(n),
		) &&
		(v.usage.cost === null ||
			(typeof v.usage.cost === "number" && Number.isFinite(v.usage.cost) && v.usage.cost >= 0))
	);
}
function configuration(v: unknown): v is PocketConfiguration {
	if (
		!shape(v, ["ref", "choices", "canConfigure", "usage", "session"]) ||
		!ref(v.ref) ||
		typeof v.canConfigure !== "boolean" ||
		!Array.isArray(v.choices) ||
		v.choices.length > 64 ||
		!v.choices.every(
			(choice) =>
				shape(choice, ["id", "model"]) &&
				identity(choice.id) &&
				string(choice.model, 256) &&
				!!choice.model &&
				choice.model.trim() === choice.model &&
				!/[\x00-\x1f\x7f]/.test(choice.model),
		) ||
		new Set(v.choices.map((choice) => choice.id)).size !== v.choices.length ||
		!shape(v.usage, ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"]) ||
		![v.usage.input, v.usage.output, v.usage.cacheRead, v.usage.cacheWrite, v.usage.totalTokens].every((n) =>
			integer(n),
		) ||
		!(
			v.usage.cost === null ||
			(typeof v.usage.cost === "number" && Number.isFinite(v.usage.cost) && v.usage.cost >= 0)
		)
	)
		return false;
	if (v.session === null) return true;
	return (
		shape(v.session, ["limits", "budget"]) &&
		shape(v.session.limits, ["maxConversations", "maxPrimaryAttempts", "maxAuxiliaryAttempts"]) &&
		Object.values(v.session.limits).every((n) => integer(n, 1)) &&
		shape(v.session.budget, ["primaryAttempts", "auxiliaryAttempts"]) &&
		Object.values(v.session.budget).every((n) => integer(n))
	);
}
const humanText = (v: unknown, max: number): v is string =>
	string(v, max) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const humanIds = (v: unknown, max: number): v is string[] =>
	Array.isArray(v) && v.length <= max && v.every(identity) && new Set(v).size === v.length;
const reactionEmoji = (v: unknown): boolean =>
	typeof v === "string" && ["👍", "👎", "❤️", "🎉", "👀", "✅"].includes(v);
function collaboration(v: unknown): v is PocketCollaborationView {
	if (
		!shape(v, ["conversationId", "version", "messages", "note", "driver", "presence"]) ||
		!identity(v.conversationId) ||
		!integer(v.version)
	)
		return false;
	const { messages, note, driver, presence } = v;
	if (
		!Array.isArray(messages) ||
		messages.length > 256 ||
		!messages.every(
			(m) =>
				shape(m, [
					"id",
					"requestId",
					"authorId",
					"authorName",
					"text",
					"createdAt",
					"quoteId",
					"mentions",
					"pinned",
					"reactions",
				]) &&
				identity(m.id) &&
				identity(m.requestId) &&
				identity(m.authorId) &&
				humanText(m.authorName, 80) &&
				!!m.authorName.trim() &&
				humanText(m.text, 8192) &&
				!!m.text.trim() &&
				integer(m.createdAt) &&
				(m.quoteId === null || identity(m.quoteId)) &&
				humanIds(m.mentions, 16) &&
				typeof m.pinned === "boolean" &&
				Array.isArray(m.reactions) &&
				m.reactions.length <= 6 &&
				m.reactions.every(
					(r) => shape(r, ["emoji", "people"]) && reactionEmoji(r.emoji) && humanIds(r.people, 128),
				) &&
				new Set(m.reactions.map((r) => r.emoji)).size === m.reactions.length,
		)
	)
		return false;
	return (
		new Set(messages.map((m) => m.id)).size === messages.length &&
		messages.every((m, i) => m.quoteId === null || messages.slice(0, i).some((q) => q.id === m.quoteId)) &&
		shape(note, ["version", "text", "authorId", "updatedAt"]) &&
		integer(note.version) &&
		humanText(note.text, 32768) &&
		((note.version === 0 && note.text === "" && note.authorId === null && note.updatedAt === null) ||
			(note.version > 0 && identity(note.authorId) && integer(note.updatedAt))) &&
		shape(driver, ["version", "personId", "expiresAt"]) &&
		integer(driver.version) &&
		((driver.personId === null && driver.expiresAt === null) ||
			(identity(driver.personId) && integer(driver.expiresAt))) &&
		Array.isArray(presence) &&
		presence.length <= 128 &&
		presence.every(
			(p) =>
				shape(p, ["personId", "name", "state", "expiresAt"]) &&
				identity(p.personId) &&
				humanText(p.name, 80) &&
				!!p.name.trim() &&
				["here", "typing"].includes(p.state as string) &&
				integer(p.expiresAt),
		) &&
		new Set(presence.map((p) => p.personId)).size === presence.length
	);
}
function collaborationCommand(v: Record<string, unknown>): boolean {
	if (v.op === "collaboration.read") return shape(v, ["op", "target"]) && ref(v.target);
	if (!shape(v, ["op", "target", "input"]) || !ref(v.target)) return false;
	const i = v.input;
	switch (v.op) {
		case "collaboration.post":
			return (
				shape(i, ["requestId", "text"], ["quoteId", "mentions"]) &&
				identity(i.requestId) &&
				humanText(i.text, 8192) &&
				!!i.text.trim() &&
				(i.quoteId === undefined || identity(i.quoteId)) &&
				(i.mentions === undefined || humanIds(i.mentions, 16))
			);
		case "collaboration.note":
			return shape(i, ["expectedVersion", "text"]) && integer(i.expectedVersion) && humanText(i.text, 32768);
		case "collaboration.react":
			return (
				shape(i, ["messageId", "emoji", "active"]) &&
				identity(i.messageId) &&
				reactionEmoji(i.emoji) &&
				typeof i.active === "boolean"
			);
		case "collaboration.pin":
			return shape(i, ["messageId", "pinned"]) && identity(i.messageId) && typeof i.pinned === "boolean";
		case "collaboration.driver":
			return (
				shape(i, ["expectedVersion", "action"], ["ttlMs"]) &&
				integer(i.expectedVersion) &&
				(i.action === "release"
					? i.ttlMs === undefined
					: (i.action === "claim" || i.action === "take") && integer(i.ttlMs, 1000, 300000))
			);
		case "collaboration.presence":
			return (
				shape(i, ["state"]) &&
				typeof i.state === "string" &&
				["here", "typing", "away", "leave"].includes(i.state)
			);
		default:
			return false;
	}
}
function notificationStatus(v: unknown): v is PocketNotificationStatus {
	return (
		shape(v, ["publicKey", "preferences", "devices"]) &&
		typeof v.publicKey === "string" &&
		/^[A-Za-z0-9_-]{87}$/.test(v.publicKey) &&
		shape(v.preferences, ["done", "approval", "chat", "mention"]) &&
		Object.values(v.preferences).every((value) => typeof value === "boolean") &&
		Array.isArray(v.devices) &&
		v.devices.length <= 10 &&
		v.devices.every(
			(row) =>
				shape(row, ["id", "subscriptionKey"]) &&
				identity(row.id) &&
				typeof row.subscriptionKey === "string" &&
				/^[a-f0-9]{64}$/.test(row.subscriptionKey),
		) &&
		new Set(v.devices.map((row) => row.id)).size === v.devices.length
	);
}
function notificationCommand(
	v: Record<string, unknown>,
): v is Record<string, unknown> & PocketNotificationCommand {
	if (v.op === "notification.status") return shape(v, ["op", "target"]) && ref(v.target);
	if (
		!shape(v, ["op", "target", "input"]) ||
		!ref(v.target) ||
		!record(v.input) ||
		!identity(v.input.requestId)
	)
		return false;
	if (v.op === "notification.unsubscribe")
		return shape(v.input, ["requestId", "deviceId"]) && identity(v.input.deviceId);
	if (v.op === "notification.preferences")
		return (
			shape(v.input, ["requestId", "preferences"]) &&
			record(v.input.preferences) &&
			Object.keys(v.input.preferences).length > 0 &&
			Object.entries(v.input.preferences).every(
				([field, value]) =>
					["done", "approval", "chat", "mention"].includes(field) && typeof value === "boolean",
			)
		);
	if (
		v.op !== "notification.subscribe" ||
		!shape(v.input, ["requestId", "subscription"]) ||
		!shape(v.input.subscription, ["endpoint", "keys"]) ||
		!shape(v.input.subscription.keys, ["p256dh", "auth"])
	)
		return false;
	const subscription = v.input.subscription;
	const keys = v.input.subscription.keys;
	if (
		typeof subscription.endpoint !== "string" ||
		subscription.endpoint.length > 4096 ||
		typeof keys.p256dh !== "string" ||
		!/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) ||
		typeof keys.auth !== "string" ||
		!/^[A-Za-z0-9_-]{22}$/.test(keys.auth)
	)
		return false;
	try {
		const url = new URL(subscription.endpoint);
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.hash &&
			url.href === subscription.endpoint
		);
	} catch {
		return false;
	}
}
function command(v: unknown): v is PocketCommand {
	if (!record(v)) return false;
	if (typeof v.op === "string" && v.op.startsWith("notification.")) return notificationCommand(v);
	if (typeof v.op === "string" && v.op.startsWith("collaboration.")) return collaborationCommand(v);
	switch (v.op) {
		case "hello":
		case "list":
		case "people":
		case "session.rotate":
		case "session.logout":
			return shape(v, ["op"]);
		case "create":
			return (
				shape(v, ["op", "requestId", "name", "profile"]) &&
				identity(v.requestId) &&
				identity(v.profile) &&
				string(v.name, 80) &&
				!!v.name.trim() &&
				!/[\x00-\x1f\x7f]/.test(v.name)
			);
		case "configure":
			return shape(v, ["op", "target", "profile"]) && ref(v.target) && identity(v.profile);
		case "fork":
			return (
				shape(v, ["op", "target", "requestId", "name", "profile", "entryId"]) &&
				ref(v.target) &&
				identity(v.requestId) &&
				identity(v.profile) &&
				string(v.name, 80) &&
				!!v.name.trim() &&
				!/[\x00-\x1f\x7f]/.test(v.name) &&
				entryId(v.entryId) &&
				/^[0-9]+$/.test(v.entryId)
			);
		case "credential.status":
			return shape(v, ["op"]);
		case "credential.replace":
			return (
				shape(v, ["op", "input"]) &&
				shape(v.input, ["requestId", "expectedVersion", "secret"]) &&
				identity(v.input.requestId) &&
				integer(v.input.expectedVersion) &&
				typeof v.input.secret === "string" &&
				v.input.secret.length > 0 &&
				v.input.secret.length <= 4096 &&
				v.input.secret.trim() === v.input.secret &&
				!/[\x00-\x1f\x7f]/.test(v.input.secret)
			);
		case "credential.clear":
			return (
				shape(v, ["op", "input"]) &&
				shape(v.input, ["requestId", "expectedVersion"]) &&
				identity(v.input.requestId) &&
				integer(v.input.expectedVersion)
			);
		case "configuration":
			return shape(v, ["op", "target"]) && ref(v.target);
		case "read":
			return (
				shape(v, ["op", "target"], ["page"]) &&
				ref(v.target) &&
				(v.page === undefined ||
					(shape(v.page, [], ["limit", "beforeEntryId"]) &&
						(v.page.limit === undefined || integer(v.page.limit, 1, 256)) &&
						(v.page.beforeEntryId === undefined || entryId(v.page.beforeEntryId))))
			);
		case "display":
			return (
				shape(v, ["op", "target", "requestId", "kind", "text"]) &&
				ref(v.target) &&
				identity(v.requestId) &&
				["card", "chat"].includes(v.kind as string) &&
				string(v.text, 16384)
			);
		case "submit":
			return (
				shape(v, ["op", "target", "input"]) &&
				ref(v.target) &&
				shape(v.input, ["requestId", "text", "mode"]) &&
				identity(v.input.requestId) &&
				string(v.input.text, 65536) &&
				!!v.input.text.trim() &&
				!v.input.text.startsWith("/") &&
				["prompt", "steer", "followUp"].includes(v.input.mode as string)
			);
		case "receipt":
		case "wait":
		case "withdraw":
		case "invite.revoke":
		case "person.revoke":
			return shape(v, ["op", "id"]) && identity(v.id);
		case "abort":
			return shape(v, ["op", "target"]) && ref(v.target);
		case "invite":
			return (
				shape(v, ["op", "requestId", "role", "resources", "ttlMs"], ["personId"]) &&
				identity(v.requestId) &&
				role(v.role) &&
				resources(v.resources) &&
				integer(v.ttlMs, 1, 604800000) &&
				(v.personId === undefined || identity(v.personId))
			);
		case "person.set":
			return (
				shape(v, ["op", "personId", "role", "resources"]) &&
				identity(v.personId) &&
				role(v.role) &&
				resources(v.resources)
			);
		default:
			return false;
	}
}
function receipt(v: unknown): v is PocketInputReceipt {
	return (
		shape(v, ["id", "requestId", "actorId", "target", "status"], ["entryId"]) &&
		identity(v.id) &&
		identity(v.requestId) &&
		identity(v.actorId) &&
		ref(v.target) &&
		["queued", "placed", "done", "unanswered", "unknown"].includes(v.status as string) &&
		(v.entryId === undefined || entryId(v.entryId))
	);
}
function result(v: unknown): v is PocketResult {
	if (!record(v)) return false;
	switch (v.kind) {
		case "hello":
			return (
				shape(v, ["kind", "versions", "person", "sessionId"]) &&
				Array.isArray(v.versions) &&
				v.versions.length === 1 &&
				v.versions[0] === 2 &&
				person(v.person) &&
				identity(v.sessionId)
			);
		case "list":
			return (
				shape(v, ["kind", "conversations"], ["titles"]) &&
				Array.isArray(v.conversations) &&
				v.conversations.length <= 256 &&
				v.conversations.every(ref) &&
				(v.titles === undefined ||
					(record(v.titles) &&
						Object.keys(v.titles).length === v.conversations.length &&
						Object.entries(v.titles).every(
							([id, title]) =>
								identity(id) &&
								string(title, 80) &&
								!!title.trim() &&
								(v.conversations as AgentRef[]).some((row) => row.conversationId === id),
						)))
			);
		case "reference":
			return shape(v, ["kind", "ref"]) && ref(v.ref);
		case "notification":
			return shape(v, ["kind", "target", "status"]) && ref(v.target) && notificationStatus(v.status);
		case "credential":
			return (
				shape(v, ["kind", "status"]) &&
				shape(v.status, ["version", "configured"]) &&
				integer(v.status.version) &&
				typeof v.status.configured === "boolean"
			);
		case "configuration":
			return shape(v, ["kind", "configuration"]) && configuration(v.configuration);
		case "conversation":
			return shape(v, ["kind", "snapshot"]) && snapshot(v.snapshot);
		case "collaboration":
			return shape(v, ["kind", "snapshot"]) && collaboration(v.snapshot);
		case "people":
			return (
				shape(v, ["kind", "people", "invites"]) &&
				Array.isArray(v.people) &&
				v.people.length <= 128 &&
				v.people.every(person) &&
				Array.isArray(v.invites) &&
				v.invites.length <= 512 &&
				v.invites.every(invite)
			);
		case "invite":
			return (
				shape(v, ["kind", "invite", "token"], ["qr"]) &&
				invite(v.invite) &&
				(v.token === null || secret(v.token)) &&
				(v.qr === undefined ||
					(secret(v.token) && string(v.qr, 131072) && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v.qr)))
			);
		case "display":
			return (
				shape(v, ["kind", "receipt"]) &&
				shape(v.receipt, ["ref", "namespace", "actorId", "requestId", "entryId"]) &&
				ref(v.receipt.ref) &&
				identity(v.receipt.namespace) &&
				identity(v.receipt.actorId) &&
				identity(v.receipt.requestId) &&
				entryId(v.receipt.entryId)
			);
		case "receipt":
			return shape(v, ["kind", "receipt"]) && receipt(v.receipt);
		case "session":
			return shape(v, ["kind", "person", "expiresAt"]) && person(v.person) && integer(v.expiresAt, 1);
		case "updated":
			return shape(v, ["kind"]);
		default:
			return false;
	}
}
function failure(v: unknown): v is PocketFailure {
	return (
		shape(v, ["code", "outcome", "message"]) &&
		[
			"INVALID_REQUEST",
			"VERSION_MISMATCH",
			"UNAUTHORIZED",
			"FORBIDDEN",
			"CONFLICT",
			"CAPACITY",
			"UNKNOWN",
			"UNSUPPORTED",
		].includes(v.code as string) &&
		["denied", "unknown"].includes(v.outcome as string) &&
		string(v.message, 512)
	);
}
function finite(value: unknown, depth: number, budget: { nodes: number }): boolean {
	if (depth > 16 || --budget.nodes < 0) return false;
	if (value === null || typeof value === "boolean") return true;
	if (typeof value === "string") return value.length <= 1024 * 1024;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.length <= 8192 && value.every((v) => finite(v, depth + 1, budget));
	if (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
	return Object.entries(value).every(([key, child]) => key.length <= 256 && finite(child, depth + 1, budget));
}
function frozen<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.values(value).forEach(frozen);
		Object.freeze(value);
	}
	return value;
}
function decode<T>(value: unknown, validate: (v: unknown) => v is T): T {
	if (!finite(value, 0, { nodes: 16384 }) || !validate(value))
		throw new Error("Invalid finite Pocket protocol");
	let encoded: string;
	try {
		encoded = JSON.stringify(value);
	} catch {
		throw new Error("Invalid Pocket JSON");
	}
	if (new TextEncoder().encode(encoded).byteLength > POCKET_MAX_BYTES)
		throw new Error("Pocket wire capacity exceeded");
	try {
		return frozen(JSON.parse(encoded) as T);
	} catch {
		throw new Error("Invalid Pocket JSON");
	}
}
export function decodePocketRequest(value: unknown): PocketRequest {
	return decode(
		value,
		(v): v is PocketRequest =>
			shape(v, ["version", "requestId", "command"]) &&
			v.version === 2 &&
			identity(v.requestId) &&
			command(v.command),
	);
}
export function decodePocketResponse(value: unknown, expectedRequestId: string): PocketResponse {
	return decode(
		value,
		(v): v is PocketResponse =>
			(shape(v, ["version", "requestId", "serverId", "result"]) &&
				v.version === 2 &&
				v.requestId === expectedRequestId &&
				identity(v.requestId) &&
				identity(v.serverId) &&
				result(v.result)) ||
			(shape(v, ["version", "requestId", "serverId", "error"]) &&
				v.version === 2 &&
				v.requestId === expectedRequestId &&
				identity(v.requestId) &&
				identity(v.serverId) &&
				failure(v.error)),
	);
}
export function decodePocketEvent(value: unknown): PocketEvent {
	return decode(
		value,
		(v): v is PocketEvent =>
			shape(v, ["version", "serverId", "streamId", "sequence", "kind"], ["snapshot"]) &&
			v.version === 2 &&
			identity(v.serverId) &&
			identity(v.streamId) &&
			integer(v.sequence) &&
			(v.kind === "conversation"
				? snapshot(v.snapshot)
				: v.kind === "collaboration"
					? collaboration(v.snapshot)
					: ["resnapshot", "invalidated"].includes(v.kind as string) && v.snapshot === undefined),
	);
}
