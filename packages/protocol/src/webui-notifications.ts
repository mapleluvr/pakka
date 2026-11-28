import { identity } from "./index.ts";
import {
	isPocketAgentRef,
	isPocketNotificationCommand,
	isPocketNotificationStatus,
	type AgentRef,
	type PocketNotificationCommand,
	type PocketNotificationStatus,
} from "./pocket.ts";
import { frozen, isRecord } from "./extensions.ts";

/** Same-origin, currently authorized event lookup. Push transports only NotificationWake. */
export const WEBUI_NOTIFICATION_EVENT_PATH = "/pakka-webui/notifications/event";
export type NotificationRequest = Exclude<PocketNotificationCommand, { readonly op: "notification.status" }>;
export interface NotificationWake {
	readonly eventId: string;
	readonly deviceId: string;
}
export interface NotificationEvent {
	readonly id: string;
	readonly kind: "done" | "approval" | "chat" | "mention";
	readonly preview: string;
	readonly target: AgentRef;
	readonly createdAt: number;
}
export interface NotificationOperation {
	readonly kind: "notification-operation";
	readonly actorId: string;
	readonly original: NotificationRequest;
	/** Historical result of this request, separate from current preferences and device state. */
	readonly status: PocketNotificationStatus | null;
}

function shape(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== fields.length ||
		fields.some((field) => !Object.hasOwn(value, field))
	)
		throw new Error("Invalid notification value");
}
function eventId(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function decodeNotificationRequest(value: unknown): NotificationRequest {
	if (!isPocketNotificationCommand(value) || value.op === "notification.status")
		throw new Error("Invalid notification original request");
	return frozen(value);
}
/** Canonical complete intent; target and preference property insertion order is not an identity. */
export function notificationIntent(original: NotificationRequest): string {
	const value = decodeNotificationRequest(original);
	const target = Object.entries(value.target).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const head = [value.op, target, value.input.requestId];
	switch (value.op) {
		case "notification.subscribe":
			return JSON.stringify([
				...head,
				value.input.subscription.endpoint,
				value.input.subscription.keys.p256dh,
				value.input.subscription.keys.auth,
			]);
		case "notification.unsubscribe":
			return JSON.stringify([...head, value.input.deviceId]);
		case "notification.preferences":
			return JSON.stringify([
				...head,
				Object.entries(value.input.preferences).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
			]);
	}
}
export function decodeNotificationOperation(value: unknown): NotificationOperation {
	shape(value, ["kind", "actorId", "original", "status"]);
	if (value.kind !== "notification-operation" || !identity(value.actorId))
		throw new Error("Invalid notification operation identity");
	const original = decodeNotificationRequest(value.original),
		status = value.status;
	if (status !== null && !isPocketNotificationStatus(status))
		throw new Error("Invalid notification operation result");
	if (status !== null) {
		if (
			original.op === "notification.preferences" &&
			(["done", "approval", "chat", "mention"] as const).some(
				(key) =>
					Object.hasOwn(original.input.preferences, key) &&
					status.preferences[key] !== original.input.preferences[key],
			)
		)
			throw new Error("Wrong notification preference result");
		if (
			original.op === "notification.unsubscribe" &&
			status.devices.some((device) => device.id === original.input.deviceId)
		)
			throw new Error("Wrong notification deactivation result");
		if (original.op === "notification.subscribe" && status.devices.length === 0)
			throw new Error("Missing notification registration result");
	}
	return frozen({ kind: "notification-operation", actorId: value.actorId, original, status });
}
export function decodeNotificationWake(value: unknown): NotificationWake {
	shape(value, ["eventId", "deviceId"]);
	if (!eventId(value.eventId) || !identity(value.deviceId)) throw new Error("Invalid notification wake");
	return frozen({ eventId: value.eventId, deviceId: value.deviceId });
}
export function decodeNotificationEvent(value: unknown): NotificationEvent {
	shape(value, ["id", "kind", "preview", "target", "createdAt"]);
	if (
		!eventId(value.id) ||
		(value.kind !== "done" &&
			value.kind !== "approval" &&
			value.kind !== "chat" &&
			value.kind !== "mention") ||
		typeof value.preview !== "string" ||
		value.preview.length > 512 ||
		!isPocketAgentRef(value.target) ||
		typeof value.createdAt !== "number" ||
		!Number.isSafeInteger(value.createdAt) ||
		value.createdAt < 0
	)
		throw new Error("Invalid notification event");
	return frozen({
		id: value.id,
		kind: value.kind,
		preview: value.preview,
		target: value.target,
		createdAt: value.createdAt,
	});
}
