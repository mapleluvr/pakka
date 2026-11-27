import { identity } from "./index.ts";
import { decodePocketRequest, POCKET_VERSION, type PocketCommand } from "./pocket.ts";
import { frozen, isRecord } from "./extensions.ts";

export type PeopleMode = "personal" | "collaboration";
export interface PeopleSettings {
	readonly version: number;
	readonly mode: PeopleMode;
	readonly canManage: boolean;
	readonly devices: readonly { readonly id: string; readonly current: boolean; readonly expiresAt: number }[];
}
export type PeopleAction =
	| Extract<PocketCommand, { op: "person.set" | "person.revoke" | "invite.revoke" }>
	| { readonly op: "mode.set"; readonly mode: PeopleMode; readonly expectedVersion: number }
	| { readonly op: "device.revoke"; readonly id: string };
export interface PeopleChange {
	readonly requestId: string;
	readonly action: PeopleAction;
}
export interface PeopleReceipt extends PeopleChange {
	readonly actorId: string;
	readonly sessionId: string;
	readonly version: number;
	readonly at: number;
}
function shape(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== fields.length ||
		fields.some((key) => !Object.hasOwn(value, key))
	)
		throw new Error("Invalid closed people operation");
}
export function decodePeopleSettings(value: unknown): PeopleSettings {
	shape(value, ["version", "mode", "canManage", "devices"]);
	if (typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 0 ||
		(value.mode !== "personal" && value.mode !== "collaboration") || typeof value.canManage !== "boolean" ||
		!Array.isArray(value.devices) || value.devices.length > 512 || (!value.canManage && value.devices.length))
		throw new Error("Invalid people settings");
	const devices = value.devices.map(device => {
		shape(device, ["id", "current", "expiresAt"]);
		if (!identity(device.id) || typeof device.current !== "boolean" || typeof device.expiresAt !== "number" ||
			!Number.isSafeInteger(device.expiresAt) || device.expiresAt < 1) throw new Error("Invalid device view");
		return { id: device.id, current: device.current, expiresAt: device.expiresAt };
	});
	if (new Set(devices.map(d => d.id)).size !== devices.length || devices.filter(d => d.current).length > 1)
		throw new Error("Invalid device identities");
	return frozen({ version: value.version, mode: value.mode, canManage: value.canManage, devices });
}
export function decodePeopleChange(value: unknown): PeopleChange {
	shape(value, ["requestId", "action"]);
	if (!identity(value.requestId)) throw new Error("Invalid people request identity");
	if (isRecord(value.action) && value.action.op === "mode.set") {
		shape(value.action, ["op", "mode", "expectedVersion"]);
		if ((value.action.mode !== "personal" && value.action.mode !== "collaboration") ||
			typeof value.action.expectedVersion !== "number" || !Number.isSafeInteger(value.action.expectedVersion) || value.action.expectedVersion < 0)
			throw new Error("Invalid people mode change");
		return frozen({ requestId: value.requestId, action: { op: "mode.set", mode: value.action.mode, expectedVersion: value.action.expectedVersion } });
	}
	if (isRecord(value.action) && value.action.op === "device.revoke") {
		shape(value.action, ["op", "id"]);
		if (!identity(value.action.id)) throw new Error("Invalid device identity");
		return frozen({ requestId: value.requestId, action: { op: "device.revoke", id: value.action.id } });
	}
	const action = decodePocketRequest({
		version: POCKET_VERSION,
		requestId: "people-validation",
		command: value.action,
	}).command;
	if (action.op !== "person.set" && action.op !== "person.revoke" && action.op !== "invite.revoke")
		throw new Error("Unsupported people operation");
	return frozen({ requestId: value.requestId, action });
}
export function decodePeopleReceipt(value: unknown): PeopleReceipt {
	shape(value, ["requestId", "action", "actorId", "sessionId", "version", "at"]);
	const change = decodePeopleChange({ requestId: value.requestId, action: value.action });
	if (
		!identity(value.actorId) ||
		!identity(value.sessionId) ||
		typeof value.version !== "number" ||
		!Number.isSafeInteger(value.version) ||
		value.version < 1 ||
		typeof value.at !== "number" ||
		!Number.isSafeInteger(value.at) ||
		value.at < 1
	)
		throw new Error("Invalid people receipt");
	return frozen({
		...change,
		actorId: value.actorId,
		sessionId: value.sessionId,
		version: value.version,
		at: value.at,
	});
}
/** Canonical intent for native persistence and public receipt correlation. Resource order has no meaning. */
export function peopleIntent(action: PeopleAction): string {
	return action.op === "mode.set"
		? JSON.stringify([action.op, action.mode, action.expectedVersion])
		: action.op === "person.set"
		? JSON.stringify([
				action.op,
				action.personId,
				action.role,
				action.resources === "*" ? "*" : [...action.resources].sort(),
			])
		: JSON.stringify([action.op, action.id]);
}
export function matchesPeopleReceipt(
	receipt: PeopleReceipt,
	original: PeopleChange,
	actorId: string,
): boolean {
	return (
		receipt.actorId === actorId &&
		receipt.requestId === original.requestId &&
		peopleIntent(receipt.action) === peopleIntent(original.action)
	);
}
