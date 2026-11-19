import { identity } from "./index.ts";
import { frozen, isRecord } from "./extensions.ts";
import { decodeTarget } from "./extension-rpc.ts";
import {
	decodePocketRequest,
	isPocketConfiguration,
	POCKET_VERSION,
	type AgentRef,
	type PocketConfiguration,
	type PocketConfigurationChange,
} from "./pocket.ts";

export interface ConversationConfigurationView {
	readonly configuration: PocketConfiguration;
	readonly presets: readonly { readonly id: string; readonly model: string; readonly cwd: string }[];
	readonly supportsRequests: boolean;
}
export function decodeConversationConfigurationView(value: unknown): ConversationConfigurationView {
	shape(value, ["configuration", "presets", "supportsRequests"]);
	if (
		!isPocketConfiguration(value.configuration) ||
		typeof value.supportsRequests !== "boolean" ||
		!Array.isArray(value.presets) ||
		value.presets.length > 65
	)
		throw new Error("Invalid Conversation configuration view");
	for (const row of value.presets) {
		shape(row, ["id", "model", "cwd"]);
		if (
			!identity(row.id) ||
			typeof row.model !== "string" ||
			row.model.length > 256 ||
			typeof row.cwd !== "string" ||
			!row.cwd ||
			row.cwd.length > 8192
		)
			throw new Error("Invalid allowed preset");
	}
	if (new Set(value.presets.map((row) => row.id)).size !== value.presets.length)
		throw new Error("Duplicate allowed preset");
	// SAFETY: Closed configuration, finite presets and capability flag were checked.
	return frozen(structuredClone(value)) as unknown as ConversationConfigurationView;
}
export type ConversationConfigurationSelection =
	| { readonly kind: "agent"; readonly change: PocketConfigurationChange }
	| { readonly kind: "profile"; readonly profile: string };
export interface ConversationConfigurationRequest {
	readonly requestId: string;
	readonly target: AgentRef;
	readonly selection: ConversationConfigurationSelection;
}
export interface ConversationConfigurationReceipt {
	readonly actorId: string;
	readonly original: ConversationConfigurationRequest;
	/** The historical result; resolve the resource again before using a live execution binding. */
	readonly ref: AgentRef;
	readonly at: number;
}
function shape(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
	if (
		!isRecord(value) ||
		keys.some((key) => !Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new Error("Invalid closed Conversation configuration value");
}
export function decodeConversationConfigurationRequest(value: unknown): ConversationConfigurationRequest {
	shape(value, ["requestId", "target", "selection"]);
	const target = decodeTarget(value.target),
		selection = value.selection;
	if (!identity(value.requestId) || !isRecord(selection))
		throw new Error("Invalid configuration request identity");
	if (selection.kind === "profile") {
		shape(selection, ["kind", "profile"]);
		decodePocketRequest({
			version: POCKET_VERSION,
			requestId: value.requestId,
			command: { op: "configure", target, profile: selection.profile },
		});
	} else if (selection.kind === "agent") {
		shape(selection, ["kind", "change"]);
		decodePocketRequest({
			version: POCKET_VERSION,
			requestId: value.requestId,
			command: { op: "configure.agent", target, change: selection.change },
		});
	} else throw new Error("Invalid configuration selection");
	// SAFETY: Closed original identity, target, selection and native public configuration were checked.
	return frozen(structuredClone(value)) as unknown as ConversationConfigurationRequest;
}
const sameTarget = (a: AgentRef, b: AgentRef) =>
	a.key === b.key &&
	a.sessionId === b.sessionId &&
	a.conversationId === b.conversationId &&
	a.incarnation === b.incarnation &&
	a.profile === b.profile;
export function sameConversationConfigurationRequest(
	a: ConversationConfigurationRequest,
	b: ConversationConfigurationRequest,
): boolean {
	if (a.requestId !== b.requestId || !sameTarget(a.target, b.target)) return false;
	return a.selection.kind === "profile" && b.selection.kind === "profile"
		? a.selection.profile === b.selection.profile
		: a.selection.kind === "agent" &&
				b.selection.kind === "agent" &&
				a.selection.change.model === b.selection.change.model &&
				a.selection.change.cwd === b.selection.change.cwd &&
				a.selection.change.thinkingLevel === b.selection.change.thinkingLevel;
}
export function decodeConversationConfigurationReceipt(value: unknown): ConversationConfigurationReceipt {
	shape(value, ["actorId", "original", "ref", "at"]);
	const original = decodeConversationConfigurationRequest(value.original),
		ref = decodeTarget(value.ref);
	if (
		!identity(value.actorId) ||
		typeof value.at !== "number" ||
		!Number.isSafeInteger(value.at) ||
		value.at < 0 ||
		ref.key !== original.target.key ||
		ref.sessionId !== original.target.sessionId ||
		ref.conversationId !== original.target.conversationId ||
		ref.incarnation === original.target.incarnation ||
		ref.profile !==
			(original.selection.kind === "profile" ? original.selection.profile : original.target.profile)
	)
		throw new Error("Invalid configuration receipt binding");
	// SAFETY: The closed receipt, original and resulting resource/profile binding were checked.
	return frozen(structuredClone(value)) as unknown as ConversationConfigurationReceipt;
}
export function matchesConversationConfigurationReceipt(
	receipt: ConversationConfigurationReceipt,
	original: ConversationConfigurationRequest,
	actorId: string,
): boolean {
	return receipt.actorId === actorId && sameConversationConfigurationRequest(receipt.original, original);
}
