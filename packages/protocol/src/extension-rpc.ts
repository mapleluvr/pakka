import { identity } from "./index.ts";
import { POCKET_VERSION, decodePocketRequest } from "./pocket.ts";
import type { AgentRef, PocketFailure } from "./pocket.ts";
import { decodeManifest, frozen, isRecord, extensionId } from "./extensions.ts";
import type {
	ExtensionCall,
	ExtensionFacet,
	ExtensionJson,
	ExtensionOperation,
	ExtensionOperationRequest,
	ExtensionRegistration,
	ExtensionFacetControl,
	ExtensionControlIdentity,
	ExtensionControlReceipt,
} from "./extensions.ts";

export const EXTENSION_VERSION = 3;

export type ExtensionCommandEnvelope =
	| { readonly op: "list"; readonly target?: AgentRef }
	| { readonly op: "call"; readonly call: ExtensionCall }
	| { readonly op: "operation"; readonly id: string }
	| { readonly op: "operationByRequest"; readonly request: ExtensionOperationRequest }
	| { readonly op: "control"; readonly change: ExtensionFacetControl }
	| { readonly op: "controlByRequest"; readonly original: ExtensionControlIdentity };
export interface ExtensionRequest {
	readonly version: typeof EXTENSION_VERSION;
	readonly requestId: string;
	readonly command: ExtensionCommandEnvelope;
}
export type ExtensionResult =
	| { readonly kind: "registrations"; readonly registrations: readonly ExtensionRegistration[] }
	| { readonly kind: "operation"; readonly operation: ExtensionOperation }
	| { readonly kind: "control"; readonly receipt: ExtensionControlReceipt }
	| { readonly kind: "control-operation"; readonly receipt: ExtensionControlReceipt | null };
export type ExtensionResponse = {
	readonly version: typeof EXTENSION_VERSION;
	readonly requestId: string;
	readonly serverId: string;
} & ({ readonly result: ExtensionResult } | { readonly error: PocketFailure });
function shape(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
	if (
		!isRecord(value) ||
		required.some((key) => !Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => ![...required, ...optional].includes(key))
	)
		throw new Error("Invalid closed extension envelope");
}
export function decodeJson(value: unknown, depth = 0): ExtensionJson {
	if (depth > 16) throw new Error("Extension JSON depth exceeded");
	if (
		value === null ||
		typeof value === "boolean" ||
		(typeof value === "string" && value.length <= 262144) ||
		(typeof value === "number" && Number.isFinite(value))
	)
		return value;
	if (Array.isArray(value) && value.length <= 8192 && Object.keys(value).length === value.length)
		return frozen(value.map((item) => decodeJson(item, depth + 1)));
	if (
		isRecord(value) &&
		Object.keys(value).length <= 512 &&
		!Object.keys(value).some((key) => ["__proto__", "constructor", "prototype"].includes(key))
	)
		return frozen(
			Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeJson(child, depth + 1)])),
		);
	throw new Error("Invalid bounded extension JSON");
}
export function decodeTarget(target: unknown): AgentRef {
	const request = decodePocketRequest({
		version: POCKET_VERSION,
		requestId: "extension-target",
		command: { op: "read", target },
	});
	if (request.command.op !== "read") throw new Error("Invalid extension target");
	return request.command.target;
}
export function isExtensionFacet(value: unknown): value is ExtensionFacet {
	return typeof value === "string" && ["agent", "backend", "webui", "client"].includes(value);
}
export function decodeRegistration(value: unknown): ExtensionRegistration {
	shape(value, ["manifest", "generation", "facet", "phase"]);
	const manifest = decodeManifest(value.manifest);
	if (
		!isExtensionFacet(value.facet) ||
		!manifest.facets[value.facet] ||
		!identity(value.generation) ||
		!["ready", "disabled", "unknown"].some((phase) => phase === value.phase)
	)
		throw Error("Invalid facet registration");
	// SAFETY: closed manifest, facet selection, generation and phase have all been validated.
	return frozen(structuredClone(value)) as unknown as ExtensionRegistration;
}
export function decodeControlIdentity(value: unknown): ExtensionControlIdentity {
	shape(value, ["extension", "facet", "requestId"]);
	if (!extensionId(value.extension) || !isExtensionFacet(value.facet) || !identity(value.requestId))
		throw Error("Invalid facet control identity");
	// SAFETY: every closed identity field was checked above.
	return frozen(structuredClone(value)) as unknown as ExtensionControlIdentity;
}
export function decodeFacetControl(value: unknown): ExtensionFacetControl {
	shape(value, ["extension", "facet", "action", "expectedGeneration", "requestId"]);
	decodeControlIdentity({ extension: value.extension, facet: value.facet, requestId: value.requestId });
	if (
		!identity(value.expectedGeneration) ||
		!["enable", "disable", "reload"].some((action) => action === value.action)
	)
		throw Error("Invalid facet control");
	// SAFETY: closed original identity, action and expected generation were checked above.
	return frozen(structuredClone(value)) as unknown as ExtensionFacetControl;
}
export function decodeControlReceipt(value: unknown): ExtensionControlReceipt {
	shape(
		value,
		["extension", "facet", "action", "expectedGeneration", "requestId", "actorId", "state"],
		["publication"],
	);
	decodeFacetControl({
		extension: value.extension,
		facet: value.facet,
		action: value.action,
		expectedGeneration: value.expectedGeneration,
		requestId: value.requestId,
	});
	if (!identity(value.actorId) || !["done", "unknown"].some((state) => state === value.state))
		throw Error("Invalid facet control receipt");
	if (value.state === "done") {
		const row = value.publication;
		shape(row, ["version", "generation", "phase"]);
		if (
			typeof row.version !== "string" ||
			!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(row.version) ||
			!identity(row.generation) ||
			!["ready", "disabled"].some((phase) => phase === row.phase)
		)
			throw Error("Invalid facet publication");
	} else if ("publication" in value) throw Error("Unconfirmed facet result");
	// SAFETY: closed receipt, original identity and matching publication were checked above.
	return frozen(structuredClone(value)) as unknown as ExtensionControlReceipt;
}
export function decodeExtensionRequest(value: unknown): ExtensionRequest {
	shape(value, ["version", "requestId", "command"]);
	if (value.version !== EXTENSION_VERSION || !identity(value.requestId))
		throw new Error("Invalid extension protocol version/request");
	const command = value.command;
	if (!isRecord(command)) throw new Error("Invalid extension command");
	switch (command.op) {
		case "list":
			shape(command, ["op"], ["target"]);
			if (command.target !== undefined) decodeTarget(command.target);
			break;
		case "operationByRequest": {
			shape(command, ["op", "request"]);
			const request = command.request;
			shape(request, ["extension", "requestId"], ["target"]);
			if (!extensionId(request.extension) || !identity(request.requestId))
				throw new Error("Invalid original extension request");
			if (request.target !== undefined) decodeTarget(request.target);
			break;
		}
		case "operation":
			shape(command, ["op", "id"]);
			if (!identity(command.id)) throw new Error("Invalid extension operation id");
			break;
		case "control":
			shape(command, ["op", "change"]);
			decodeFacetControl(command.change);
			break;
		case "controlByRequest":
			shape(command, ["op", "original"]);
			decodeControlIdentity(command.original);
			break;
		case "call": {
			shape(command, ["op", "call"]);
			const call = command.call;
			shape(call, ["extension", "generation", "action", "requestId", "input"], ["target"]);
			if (
				!extensionId(call.extension) ||
				!extensionId(call.action) ||
				!identity(call.requestId) ||
				typeof call.generation !== "string" ||
				!/^[A-Za-z0-9_.:-]{1,256}$/.test(call.generation)
			)
				throw new Error("Invalid extension call identity");
			decodeJson(call.input);
			if (call.target !== undefined) decodeTarget(call.target);
			break;
		}
		default:
			throw new Error("Unsupported extension command");
	}
	// SAFETY: every closed command variant and nested call/target/finite JSON input was validated above.
	return frozen(structuredClone(value)) as unknown as ExtensionRequest;
}
export function decodeOperation(value: unknown): ExtensionOperation {
	shape(value, ["id", "extension", "action", "actorId", "requestId", "state"], ["value"]);
	if (
		![value.id, value.actorId, value.requestId].every(identity) ||
		!extensionId(value.extension) ||
		!extensionId(value.action) ||
		!["done", "unknown"].some((state) => state === value.state)
	)
		throw new Error("Invalid extension operation");
	if (value.state === "done") decodeJson(value.value);
	else if (value.value !== undefined) throw new Error("Unconfirmed extension value");
	// SAFETY: closed row identity, state and optional result obey the validated operation vocabulary.
	return frozen(structuredClone(value)) as unknown as ExtensionOperation;
}
export function decodeExtensionResponse(value: unknown, requestId: string): ExtensionResponse {
	if (
		!isRecord(value) ||
		!identity(value.serverId) ||
		value.version !== EXTENSION_VERSION ||
		value.requestId !== requestId
	)
		throw new Error("Uncorrelated extension response");
	if ("error" in value) {
		shape(value, ["version", "requestId", "serverId", "error"]);
		const error = value.error;
		shape(error, ["code", "outcome", "message"]);
		if (
			![
				"INVALID_REQUEST",
				"VERSION_MISMATCH",
				"UNAUTHORIZED",
				"FORBIDDEN",
				"CONFLICT",
				"CAPACITY",
				"UNKNOWN",
				"UNSUPPORTED",
			].some((code) => code === error.code) ||
			!["denied", "unknown"].some((outcome) => outcome === error.outcome) ||
			typeof error.message !== "string" ||
			error.message.length > 256
		)
			throw new Error("Invalid extension failure");
	} else {
		shape(value, ["version", "requestId", "serverId", "result"]);
		const result = value.result;
		if (!isRecord(result)) throw new Error("Invalid extension result");
		if (result.kind === "registrations") {
			shape(result, ["kind", "registrations"]);
			if (!Array.isArray(result.registrations) || result.registrations.length > 256)
				throw new Error("Invalid finite registration list");
			const keys = new Set<string>();
			for (const item of result.registrations) {
				const row = decodeRegistration(item),
					key = row.manifest.id + ":" + row.facet;
				if (keys.has(key)) throw Error("Duplicate facet registration");
				keys.add(key);
			}
		} else if (result.kind === "operation") {
			shape(result, ["kind", "operation"]);
			decodeOperation(result.operation);
		} else if (result.kind === "control" || result.kind === "control-operation") {
			shape(result, ["kind", "receipt"]);
			if (result.kind === "control" || result.receipt !== null) decodeControlReceipt(result.receipt);
		} else throw new Error("Unsupported extension result");
	}
	// SAFETY: correlated envelope and the complete finite result/failure variant were decoded above.
	return frozen(structuredClone(value)) as unknown as ExtensionResponse;
}
