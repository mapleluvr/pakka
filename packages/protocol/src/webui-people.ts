import { identity } from "./index.ts";
import { decodePocketRequest, POCKET_VERSION, type PocketCommand } from "./pocket.ts";
import { frozen, isRecord } from "./extensions.ts";

export type PeopleAction = Extract<PocketCommand, { op: "person.set" | "person.revoke" | "invite.revoke" }>;
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
export function decodePeopleChange(value: unknown): PeopleChange {
	shape(value, ["requestId", "action"]);
	if (!identity(value.requestId)) throw new Error("Invalid people request identity");
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
	return action.op === "person.set"
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
