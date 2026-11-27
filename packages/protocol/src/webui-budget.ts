import { identity } from "./index.ts";
import { frozen, isRecord } from "./extensions.ts";

/** Session admission limits. Zero means unlimited per dimension. These are durable attempt counts, not token or currency quotas. */
export interface SessionBudgetLimits {
	readonly maxConversations: number;
	readonly maxPrimaryAttempts: number;
	readonly maxAuxiliaryAttempts: number;
}
export interface SessionBudgetSnapshot {
	readonly version: number;
	readonly limits: SessionBudgetLimits;
	readonly budget: { readonly primaryAttempts: number; readonly auxiliaryAttempts: number };
	readonly conversationCount: number;
}
export interface SessionBudgetChange {
	readonly requestId: string;
	readonly expectedVersion: number;
	readonly limits: SessionBudgetLimits;
	readonly reason: string;
}
export interface SessionBudgetReceipt {
	readonly version: number;
	readonly source: "bootstrap" | "management";
	readonly actorId: string;
	readonly requestId: string;
	readonly reason: string;
	readonly at: number;
	readonly before: SessionBudgetLimits;
	readonly after: SessionBudgetLimits;
	readonly budget: SessionBudgetSnapshot["budget"];
	readonly conversationCount: number;
	readonly addedProfiles: readonly string[];
}
export interface SessionBudgetPage {
	readonly items: readonly SessionBudgetReceipt[];
	readonly nextBeforeVersion?: number;
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
		throw new Error("Invalid closed Session budget value");
}
const count = (value: unknown, minimum = 0): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const reason = (value: unknown): value is string =>
	typeof value === "string" && !!value.trim() && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
function limits(value: unknown) {
	shape(value, ["maxConversations", "maxPrimaryAttempts", "maxAuxiliaryAttempts"]);
	if (!Object.values(value).every((item) => count(item))) throw new Error("Invalid Session budget limits");
}
function consumed(value: unknown) {
	shape(value, ["primaryAttempts", "auxiliaryAttempts"]);
	if (!Object.values(value).every((item) => count(item))) throw new Error("Invalid consumed Session budget");
}
export function decodeSessionBudgetChange(value: unknown): SessionBudgetChange {
	shape(value, ["requestId", "expectedVersion", "limits", "reason"]);
	if (!identity(value.requestId) || !count(value.expectedVersion) || !reason(value.reason))
		throw new Error("Invalid Session budget change");
	limits(value.limits);
	// SAFETY: Closed shape, identity, version, limits and reason were checked.
	return frozen(structuredClone(value)) as unknown as SessionBudgetChange;
}
export function decodeSessionBudgetSnapshot(value: unknown): SessionBudgetSnapshot {
	shape(value, ["version", "limits", "budget", "conversationCount"]);
	if (!count(value.version) || !count(value.conversationCount))
		throw new Error("Invalid Session budget snapshot");
	limits(value.limits);
	consumed(value.budget);
	// SAFETY: Closed snapshot and both nested values were checked.
	return frozen(structuredClone(value)) as unknown as SessionBudgetSnapshot;
}
export function decodeSessionBudgetReceipt(value: unknown): SessionBudgetReceipt {
	shape(value, [
		"version",
		"source",
		"actorId",
		"requestId",
		"reason",
		"at",
		"before",
		"after",
		"budget",
		"conversationCount",
		"addedProfiles",
	]);
	if (
		!count(value.version, 1) ||
		(value.source !== "bootstrap" && value.source !== "management") ||
		!identity(value.actorId) ||
		!identity(value.requestId) ||
		!reason(value.reason) ||
		!count(value.at) ||
		!count(value.conversationCount) ||
		!Array.isArray(value.addedProfiles) ||
		!value.addedProfiles.every(identity)
	)
		throw new Error("Invalid Session budget receipt");
	limits(value.before);
	limits(value.after);
	consumed(value.budget);
	// SAFETY: Closed receipt, identities and complete nested policy/counters were checked.
	return frozen(structuredClone(value)) as unknown as SessionBudgetReceipt;
}
export function decodeSessionBudgetPage(value: unknown): SessionBudgetPage {
	shape(value, ["items"], ["nextBeforeVersion"]);
	if (
		!Array.isArray(value.items) ||
		value.items.length > 100 ||
		(value.nextBeforeVersion !== undefined && (!count(value.nextBeforeVersion, 1) || !value.items.length))
	)
		throw new Error("Invalid Session budget page");
	const items = value.items.map(decodeSessionBudgetReceipt);
	if (
		items.some((row, index) => index > 0 && row.version !== items[index - 1]!.version - 1) ||
		(value.nextBeforeVersion !== undefined &&
			(value.nextBeforeVersion !== items.at(-1)?.version || value.nextBeforeVersion <= 1))
	)
		throw new Error("Invalid Session budget cursor");
	// SAFETY: Closed bounded page, nested receipts and contiguous descending versions were checked.
	return frozen(structuredClone(value)) as unknown as SessionBudgetPage;
}
/** Receipt correlation is independent of transport success and a matching JSON shape. */
export function matchesSessionBudgetReceipt(
	receipt: SessionBudgetReceipt,
	original: SessionBudgetChange,
	actorId: string,
): boolean {
	return (
		receipt.source === "management" &&
		receipt.actorId === actorId &&
		receipt.requestId === original.requestId &&
		receipt.version === original.expectedVersion + 1 &&
		receipt.reason === original.reason &&
		receipt.addedProfiles.length === 0 &&
		receipt.after.maxConversations === original.limits.maxConversations &&
		receipt.after.maxPrimaryAttempts === original.limits.maxPrimaryAttempts &&
		receipt.after.maxAuxiliaryAttempts === original.limits.maxAuxiliaryAttempts
	);
}
