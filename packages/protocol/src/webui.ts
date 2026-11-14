import { identity } from "./index.ts";
import type { AgentRef, PocketFailure, PocketThinkingLevel } from "./pocket.ts";
import { decodeJson, decodeTarget } from "./extension-rpc.ts";
import { frozen, isRecord, type ExtensionJson } from "./extensions.ts";

/** Service API, not the UI SDK/renderer version or an artifact identity. */
export const WEBUI_SERVICE_API = 1;
export const WEBUI_SERVICE_PATH = "/pakka-webui/services";
export const WEBUI_SERVICE_MAX_BYTES = 2_097_152;

export interface ConversationReference {
	readonly kind: "conversation";
	readonly sessionId: string;
	readonly conversationId: string;
}
export type ConversationResolution =
	| { readonly status: "loaded"; readonly reference: ConversationReference; readonly target: AgentRef }
	| {
			readonly status: "unloaded" | "unavailable" | "forbidden" | "identity-mismatch";
			readonly reference: ConversationReference;
			/** This result does not grant a writer or silently reopen a Session. */
			readonly history: "unsupported";
	  };
export interface WebUiCapabilities {
	readonly services: 1;
	readonly workbench: 2;
	readonly extensions: 2;
	readonly features: readonly string[];
}
export interface ModelIdentity {
	readonly provider: string;
	readonly id: string;
}
/** Native JSON location, including numeric array indices; never a filesystem path. */
export type ModelConfigurationPath = readonly (string | number)[];
export type ModelConfigurationEdit =
	| { readonly path: ModelConfigurationPath; readonly value: ExtensionJson }
	| { readonly path: ModelConfigurationPath; readonly remove: true };
export interface ModelConfigurationChange {
	readonly requestId: string;
	readonly expectedVersion: string;
	readonly edits: readonly ModelConfigurationEdit[];
}
export interface ModelConfigurationView {
	readonly version: string;
	readonly source: "models.json";
	/** Redacted native document. Missing protected values are not empty or deleted values. */
	readonly document: Readonly<Record<string, ExtensionJson>>;
	readonly protectedPaths: readonly ModelConfigurationPath[];
	readonly load: "ready" | "unavailable";
}
export interface ModelConfigurationReceipt {
	readonly requestId: string;
	readonly actorId: string;
	readonly state: "saved" | "unknown";
	readonly version: string;
	/** Persistence and native reload are separate effects. Never an inference/capability check. */
	readonly reload: "ready" | "unavailable" | "not-confirmed";
}
export interface ModelDefaults {
	readonly version: number;
	readonly model: ModelIdentity | null;
	readonly thinkingLevel: PocketThinkingLevel | null;
}
export interface ModelDefaultsChange {
	readonly requestId: string;
	readonly expectedVersion: number;
	readonly model: ModelIdentity | null;
	readonly thinkingLevel: PocketThinkingLevel | null;
}
export interface ModelDefaultsReceipt {
	readonly requestId: string;
	readonly actorId: string;
	readonly defaults: ModelDefaults;
}
export interface ModelCatalogQuery {
	readonly type?: "chat" | "image" | "classifier";
	readonly provider?: string;
	readonly query?: string;
	readonly offset?: number;
	readonly limit?: number;
	readonly revision?: string;
}
export interface ModelCatalogItem extends ModelIdentity {
	readonly name: string;
	readonly type: "chat" | "image" | "classifier";
	readonly api: string;
	readonly input: readonly string[];
	readonly thinkingLevels: readonly PocketThinkingLevel[];
	/** Provider configuration only; not model authorization or observed endpoint health. */
	readonly authentication: "configured" | "unconfigured" | "unknown";
	/** Native non-secret capability metadata, not observed endpoint capabilities. */
	readonly parameters: Readonly<Record<string, ExtensionJson>>;
}
export interface ModelCatalogPage {
	readonly revision: string;
	readonly status: "ready" | "unavailable";
	readonly models: readonly ModelCatalogItem[];
	readonly total: number;
	readonly nextOffset: number | null;
}
export type WebUiCommand =
	| { readonly op: "capabilities" }
	| { readonly op: "resource.resolve"; readonly reference: ConversationReference }
	| { readonly op: "model-connections.read" | "model-connections.reload" }
	| { readonly op: "model-connections.validate"; readonly change: ModelConfigurationChange }
	| { readonly op: "model-connections.write"; readonly change: ModelConfigurationChange }
	| { readonly op: "model-connections.lookup"; readonly original: ModelConfigurationChange }
	| { readonly op: "model-catalog.read"; readonly query: ModelCatalogQuery }
	| { readonly op: "model-catalog.refresh"; readonly provider?: string; readonly allowNetwork: boolean }
	| { readonly op: "model-defaults.read" }
	| { readonly op: "model-defaults.write"; readonly change: ModelDefaultsChange }
	| { readonly op: "model-defaults.lookup"; readonly original: ModelDefaultsChange };
export interface WebUiResults {
	capabilities: { readonly kind: "capabilities"; readonly capabilities: WebUiCapabilities };
	"resource.resolve": { readonly kind: "resource"; readonly resolution: ConversationResolution };
	"model-connections.read": {
		readonly kind: "model-configuration";
		readonly configuration: ModelConfigurationView;
	};
	"model-connections.reload": { readonly kind: "model-reload"; readonly load: "ready" | "unavailable" };
	"model-connections.validate": {
		readonly kind: "model-validation";
		readonly valid: boolean;
		/** Native loader validation may accept unrecognized properties; no per-field effect claim. */
		readonly validator: "pi-coding-agent-model-runtime";
	};
	"model-connections.write": {
		readonly kind: "model-configuration-receipt";
		readonly receipt: ModelConfigurationReceipt;
	};
	"model-connections.lookup": {
		readonly kind: "model-configuration-operation";
		readonly receipt: ModelConfigurationReceipt | null;
	};
	"model-catalog.read": { readonly kind: "model-catalog"; readonly page: ModelCatalogPage };
	"model-catalog.refresh": {
		readonly kind: "model-catalog-refresh";
		readonly status: "ready" | "unavailable";
	};
	"model-defaults.read": { readonly kind: "model-defaults"; readonly defaults: ModelDefaults };
	"model-defaults.write": { readonly kind: "model-defaults-receipt"; readonly receipt: ModelDefaultsReceipt };
	"model-defaults.lookup": {
		readonly kind: "model-defaults-operation";
		readonly receipt: ModelDefaultsReceipt | null;
	};
}
export type WebUiResult = WebUiResults[keyof WebUiResults];
export interface WebUiRequest {
	readonly api: 1;
	readonly requestId: string;
	/** Expected identity from the workbench handshake; checked before any service effect. */
	readonly binding: { readonly personId: string; readonly serverId: string };
	readonly command: WebUiCommand;
}
export type WebUiResponse = {
	readonly api: 1;
	readonly requestId: string;
	readonly serverId: string;
} & ({ readonly result: WebUiResult } | { readonly error: PocketFailure });

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
		throw new Error("Invalid closed WebUI service value");
}
function text(value: unknown, maximum = 256): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value)
	);
}
function count(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function member(value: unknown, choices: readonly string[]): boolean {
	return typeof value === "string" && choices.includes(value);
}
const thinking = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function model(value: unknown): void {
	if (value === null) return;
	shape(value, ["provider", "id"]);
	if (!text(value.provider) || !text(value.id)) throw new Error("Invalid native model identity");
}
function configurationPath(value: unknown): asserts value is ModelConfigurationPath {
	if (
		!Array.isArray(value) ||
		value.length < 1 ||
		value.length > 16 ||
		!value.every(
			(part) =>
				(typeof part === "string" &&
					text(part, 512) &&
					!["__proto__", "constructor", "prototype"].includes(part)) ||
				count(part, 8191),
		)
	)
		throw new Error("Invalid model configuration path");
}
export function decodeConversationReference(value: unknown): ConversationReference {
	shape(value, ["kind", "sessionId", "conversationId"]);
	if (value.kind !== "conversation" || !identity(value.sessionId) || !identity(value.conversationId))
		throw new Error("Invalid stable Conversation reference");
	// SAFETY: The closed reference has the conversation discriminator and two validated persistent identities.
	return frozen(structuredClone(value)) as unknown as ConversationReference;
}
export function decodeModelConfigurationChange(value: unknown): ModelConfigurationChange {
	shape(value, ["requestId", "expectedVersion", "edits"]);
	if (
		!identity(value.requestId) ||
		!text(value.expectedVersion) ||
		!Array.isArray(value.edits) ||
		value.edits.length < 1 ||
		value.edits.length > 64
	)
		throw new Error("Invalid model configuration change");
	for (const edit of value.edits) {
		if (!isRecord(edit)) throw new Error("Invalid configuration edit");
		if (Object.hasOwn(edit, "value")) {
			shape(edit, ["path", "value"]);
			decodeJson(edit.value);
		} else {
			shape(edit, ["path", "remove"]);
			if (edit.remove !== true) throw new Error("Invalid removal");
		}
		configurationPath(edit.path);
		if (edit.path[0] !== "providers") throw new Error("Only native provider configuration is editable");
	}
	// SAFETY: The closed change has a valid request/version and each bounded native JSON edit/path was checked.
	return frozen(structuredClone(value)) as unknown as ModelConfigurationChange;
}
export function decodeModelDefaults(value: unknown): ModelDefaults {
	shape(value, ["version", "model", "thinkingLevel"]);
	if (!count(value.version) || (value.thinkingLevel !== null && !member(value.thinkingLevel, thinking)))
		throw new Error("Invalid person model defaults");
	model(value.model);
	// SAFETY: The closed value has a bounded version, exact model identity or null, and a supported thinking level or null.
	return frozen(structuredClone(value)) as unknown as ModelDefaults;
}
export function decodeModelDefaultsChange(value: unknown): ModelDefaultsChange {
	shape(value, ["requestId", "expectedVersion", "model", "thinkingLevel"]);
	if (!identity(value.requestId)) throw new Error("Invalid original defaults request");
	decodeModelDefaults({
		version: value.expectedVersion,
		model: value.model,
		thinkingLevel: value.thinkingLevel,
	});
	// SAFETY: The closed original request and its complete defaults payload were checked.
	return frozen(structuredClone(value)) as unknown as ModelDefaultsChange;
}
export function decodeModelConfigurationReceipt(value: unknown): ModelConfigurationReceipt {
	shape(value, ["requestId", "actorId", "state", "version", "reload"]);
	if (
		!identity(value.requestId) ||
		!identity(value.actorId) ||
		!text(value.version) ||
		!member(value.state, ["saved", "unknown"]) ||
		!member(value.reload, ["ready", "unavailable", "not-confirmed"])
	)
		throw new Error("Invalid model configuration receipt");
	if (value.state === "unknown" && value.reload !== "not-confirmed")
		throw new Error("Unconfirmed persistence cannot claim a reload");
	// SAFETY: The closed receipt identities, version, persistence state and compatible reload state were checked.
	return frozen(structuredClone(value)) as unknown as ModelConfigurationReceipt;
}
export function decodeModelDefaultsReceipt(value: unknown): ModelDefaultsReceipt {
	shape(value, ["requestId", "actorId", "defaults"]);
	if (!identity(value.requestId) || !identity(value.actorId))
		throw new Error("Invalid defaults receipt identity");
	decodeModelDefaults(value.defaults);
	// SAFETY: The closed receipt identities and full nested defaults value were checked.
	return frozen(structuredClone(value)) as unknown as ModelDefaultsReceipt;
}
export function decodeWebUiCommand(command: unknown): WebUiCommand {
	if (!isRecord(command)) throw new Error("Invalid WebUI service command");
	switch (command.op) {
		case "capabilities":
		case "model-connections.read":
		case "model-connections.reload":
		case "model-defaults.read":
			shape(command, ["op"]);
			break;
		case "resource.resolve":
			shape(command, ["op", "reference"]);
			decodeConversationReference(command.reference);
			break;
		case "model-connections.validate":
		case "model-connections.write":
			shape(command, ["op", "change"]);
			decodeModelConfigurationChange(command.change);
			break;
		case "model-connections.lookup":
			shape(command, ["op", "original"]);
			decodeModelConfigurationChange(command.original);
			break;
		case "model-defaults.write":
			shape(command, ["op", "change"]);
			decodeModelDefaultsChange(command.change);
			break;
		case "model-defaults.lookup":
			shape(command, ["op", "original"]);
			decodeModelDefaultsChange(command.original);
			break;
		case "model-catalog.read": {
			shape(command, ["op", "query"]);
			const query = command.query;
			shape(query, [], ["type", "provider", "query", "offset", "limit", "revision"]);
			if (
				(query.type !== undefined && !member(query.type, ["chat", "image", "classifier"])) ||
				(query.provider !== undefined && !text(query.provider)) ||
				(query.query !== undefined && (typeof query.query !== "string" || query.query.length > 256)) ||
				(query.offset !== undefined && !count(query.offset)) ||
				(query.limit !== undefined && (!count(query.limit, 100) || query.limit === 0)) ||
				(query.revision !== undefined && !text(query.revision))
			)
				throw new Error("Invalid bounded model catalog query");
			break;
		}
		case "model-catalog.refresh":
			shape(command, ["op", "allowNetwork"], ["provider"]);
			if (
				typeof command.allowNetwork !== "boolean" ||
				(command.provider !== undefined && !text(command.provider))
			)
				throw new Error("Invalid catalog refresh");
			break;
		default:
			throw new Error("Unsupported WebUI service operation");
	}
	if (new TextEncoder().encode(JSON.stringify(command)).byteLength > WEBUI_SERVICE_MAX_BYTES)
		throw new Error("WebUI service capacity exceeded");
	// SAFETY: Every closed command variant, nested payload and overall byte bound were checked.
	return frozen(structuredClone(command)) as unknown as WebUiCommand;
}
export function decodeWebUiRequest(value: unknown): WebUiRequest {
	shape(value, ["api", "requestId", "binding", "command"]);
	if (value.api !== WEBUI_SERVICE_API || !identity(value.requestId))
		throw new Error("Invalid WebUI service version/request");
	shape(value.binding, ["personId", "serverId"]);
	if (!identity(value.binding.personId) || !identity(value.binding.serverId))
		throw new Error("Invalid expected service identity");
	decodeWebUiCommand(value.command);
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > WEBUI_SERVICE_MAX_BYTES)
		throw new Error("WebUI service capacity exceeded");
	// SAFETY: The closed envelope, expected identities, complete command and byte bound were checked.
	return frozen(structuredClone(value)) as unknown as WebUiRequest;
}
export function decodeWebUiResult(value: unknown): WebUiResult {
	if (!isRecord(value)) throw new Error("Invalid WebUI result");
	switch (value.kind) {
		case "capabilities": {
			shape(value, ["kind", "capabilities"]);
			const caps = value.capabilities;
			shape(caps, ["services", "workbench", "extensions", "features"]);
			if (
				caps.services !== 1 ||
				caps.workbench !== 2 ||
				caps.extensions !== 2 ||
				!Array.isArray(caps.features) ||
				caps.features.length > 64 ||
				!caps.features.every((feature) => text(feature, 128)) ||
				new Set(caps.features).size !== caps.features.length
			)
				throw new Error("Unsupported service combination");
			break;
		}
		case "resource": {
			shape(value, ["kind", "resolution"]);
			const resolution = value.resolution;
			if (!isRecord(resolution)) throw new Error("Invalid resource resolution");
			const reference = decodeConversationReference(resolution.reference);
			if (resolution.status === "loaded") {
				shape(resolution, ["status", "reference", "target"]);
				const target = decodeTarget(resolution.target);
				if (target.sessionId !== reference.sessionId || target.conversationId !== reference.conversationId)
					throw new Error("Resource identity mismatch");
			} else {
				shape(resolution, ["status", "reference", "history"]);
				if (
					!member(resolution.status, ["unloaded", "unavailable", "forbidden", "identity-mismatch"]) ||
					resolution.history !== "unsupported"
				)
					throw new Error("Invalid unavailable resource");
			}
			break;
		}
		case "model-configuration": {
			shape(value, ["kind", "configuration"]);
			const config = value.configuration;
			shape(config, ["version", "source", "document", "protectedPaths", "load"]);
			if (
				!text(config.version) ||
				config.source !== "models.json" ||
				!isRecord(config.document) ||
				!Array.isArray(config.protectedPaths) ||
				config.protectedPaths.length > 8192 ||
				!member(config.load, ["ready", "unavailable"])
			)
				throw new Error("Invalid configuration view");
			decodeJson(config.document);
			for (const path of config.protectedPaths) configurationPath(path);
			break;
		}
		case "model-validation":
			shape(value, ["kind", "valid", "validator"]);
			if (typeof value.valid !== "boolean" || value.validator !== "pi-coding-agent-model-runtime")
				throw new Error("Invalid configuration validation");
			break;
		case "model-reload":
			shape(value, ["kind", "load"]);
			if (!member(value.load, ["ready", "unavailable"])) throw new Error("Invalid reload status");
			break;
		case "model-configuration-receipt":
		case "model-configuration-operation":
			shape(value, ["kind", "receipt"]);
			if (value.kind !== "model-configuration-operation" || value.receipt !== null)
				decodeModelConfigurationReceipt(value.receipt);
			break;
		case "model-defaults":
			shape(value, ["kind", "defaults"]);
			decodeModelDefaults(value.defaults);
			break;
		case "model-defaults-receipt":
		case "model-defaults-operation":
			shape(value, ["kind", "receipt"]);
			if (value.kind !== "model-defaults-operation" || value.receipt !== null)
				decodeModelDefaultsReceipt(value.receipt);
			break;
		case "model-catalog-refresh":
			shape(value, ["kind", "status"]);
			if (!member(value.status, ["ready", "unavailable"])) throw new Error("Invalid catalog refresh status");
			break;
		case "model-catalog": {
			shape(value, ["kind", "page"]);
			const page = value.page;
			shape(page, ["revision", "status", "models", "total", "nextOffset"]);
			if (
				!member(page.status, ["ready", "unavailable"]) ||
				!text(page.revision) ||
				!Array.isArray(page.models) ||
				page.models.length > 100 ||
				!count(page.total) ||
				(page.nextOffset !== null && (!count(page.nextOffset) || page.nextOffset >= page.total))
			)
				throw new Error("Invalid model catalog page");
			for (const item of page.models) {
				shape(item, [
					"provider",
					"id",
					"name",
					"type",
					"api",
					"input",
					"thinkingLevels",
					"authentication",
					"parameters",
				]);
				model({ provider: item.provider, id: item.id });
				if (
					!member(item.authentication, ["configured", "unconfigured", "unknown"]) ||
					!text(item.name, 512) ||
					!member(item.type, ["chat", "image", "classifier"]) ||
					!text(item.api) ||
					!Array.isArray(item.input) ||
					item.input.length > 16 ||
					!item.input.every((input) => text(input, 64)) ||
					!Array.isArray(item.thinkingLevels) ||
					item.thinkingLevels.length > 7 ||
					!item.thinkingLevels.every((level) => member(level, thinking)) ||
					!isRecord(item.parameters)
				)
					throw new Error("Invalid model catalog entry");
				decodeJson(item.parameters);
			}
			break;
		}
		default:
			throw new Error("Unsupported WebUI service result");
	}
	// SAFETY: Every closed result variant and its nested identity, bounded data and state fields were checked.
	return frozen(structuredClone(value)) as unknown as WebUiResult;
}
export function decodeWebUiResponse(value: unknown, requestId: string): WebUiResponse {
	if (!isRecord(value)) throw new Error("Invalid WebUI service response");
	if ("error" in value) {
		shape(value, ["api", "requestId", "serverId", "error"]);
		const error = value.error;
		shape(error, ["code", "outcome", "message"]);
		if (
			!member(error.code, [
				"INVALID_REQUEST",
				"VERSION_MISMATCH",
				"UNAUTHORIZED",
				"FORBIDDEN",
				"CONFLICT",
				"CAPACITY",
				"UNKNOWN",
				"UNSUPPORTED",
			]) ||
			!member(error.outcome, ["denied", "unknown"]) ||
			!text(error.message)
		)
			throw new Error("Invalid service failure");
	} else {
		shape(value, ["api", "requestId", "serverId", "result"]);
		decodeWebUiResult(value.result);
	}
	if (value.api !== WEBUI_SERVICE_API || value.requestId !== requestId || !identity(value.serverId))
		throw new Error("Uncorrelated WebUI service response");
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > WEBUI_SERVICE_MAX_BYTES)
		throw new Error("WebUI service capacity exceeded");
	// SAFETY: The complete closed result/failure, version, server/request correlation and byte bound were checked.
	return frozen(structuredClone(value)) as unknown as WebUiResponse;
}
