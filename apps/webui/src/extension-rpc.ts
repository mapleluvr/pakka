import { identity } from "@pakka/protocol";
import { decodePocketRequest } from "@pakka/protocol/pocket";
import type { AgentRef, PocketFailure } from "@pakka/protocol/pocket";
import { decodeManifest, frozen, isRecord, extensionId } from "./extension.ts";
import type {
	ExtensionCall,
	ExtensionFacet,
	ExtensionJson,
	ExtensionOperation,
	ExtensionRegistration,
} from "./extension.ts";

export type ExtensionCommandEnvelope =
	| { readonly op: "list"; readonly target?: AgentRef }
	| { readonly op: "call"; readonly call: ExtensionCall }
	| { readonly op: "operation"; readonly id: string }
	| { readonly op: "enable" | "disable" | "reload"; readonly extension: string };
export interface ExtensionRequest {
	readonly version: 2;
	readonly requestId: string;
	readonly command: ExtensionCommandEnvelope;
}
export type ExtensionResult =
	| { readonly kind: "registrations"; readonly registrations: readonly ExtensionRegistration[] }
	| { readonly kind: "operation"; readonly operation: ExtensionOperation }
	| { readonly kind: "updated" };
export type ExtensionResponse = {
	readonly version: 2;
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
		version: 2,
		requestId: "extension-target",
		command: { op: "read", target },
	});
	if (request.command.op !== "read") throw new Error("Invalid extension target");
	return request.command.target;
}
export function decodeExtensionRequest(value: unknown): ExtensionRequest {
	shape(value, ["version", "requestId", "command"]);
	if (value.version !== 2 || !identity(value.requestId))
		throw new Error("Invalid extension protocol version/request");
	const command = value.command;
	if (!isRecord(command)) throw new Error("Invalid extension command");
	switch (command.op) {
		case "list":
			shape(command, ["op"], ["target"]);
			if (command.target !== undefined) decodeTarget(command.target);
			break;
		case "operation":
			shape(command, ["op", "id"]);
			if (!identity(command.id)) throw new Error("Invalid extension operation id");
			break;
		case "enable":
		case "disable":
		case "reload":
			shape(command, ["op", "extension"]);
			if (!extensionId(command.extension)) throw new Error("Invalid extension registration id");
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
	if (!isRecord(value) || !identity(value.serverId) || value.version !== 2 || value.requestId !== requestId)
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
			if (!Array.isArray(result.registrations) || result.registrations.length > 64)
				throw new Error("Invalid finite registration list");
			for (const item of result.registrations) {
				shape(item, ["manifest", "generation", "facets", "phase"]);
				decodeManifest(item.manifest);
				if (
					typeof item.generation !== "string" ||
					!/^[A-Za-z0-9_.:-]{1,256}$/.test(item.generation) ||
					!Array.isArray(item.facets) ||
					item.facets.length > 4 ||
					!item.facets.every((facet) =>
						["agent", "backend", "webui", "client"].includes(facet as ExtensionFacet),
					) ||
					new Set(item.facets).size !== item.facets.length ||
					!["ready", "disabled", "unknown"].some((phase) => phase === item.phase)
				)
					throw new Error("Invalid extension generation");
			}
		} else if (result.kind === "operation") {
			shape(result, ["kind", "operation"]);
			decodeOperation(result.operation);
		} else if (result.kind === "updated") shape(result, ["kind"]);
		else throw new Error("Unsupported extension result");
	}
	// SAFETY: correlated envelope and the complete finite result/failure variant were decoded above.
	return frozen(structuredClone(value)) as unknown as ExtensionResponse;
}
