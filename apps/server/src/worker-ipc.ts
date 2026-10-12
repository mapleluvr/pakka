import type { RuntimeOptions, CatalogOptions } from "@pakka/agent";
import type { RelayEnvelope } from "@pakka/mas";
export type WorkerCommand =
	| "init"
	| "view"
	| "prepare"
	| "activate"
	| "deliver"
	| "receipt"
	| "wait"
	| "close"
	| "cancel";
export interface WorkerRequest {
	version: 1;
	generation: string;
	id: string;
	command: WorkerCommand;
	payload: Record<string, unknown>;
}
export interface WorkerResponse {
	version: 1;
	generation: string;
	id: string;
	ok: boolean;
	value?: unknown;
	error?: string;
}
export interface WorkerConfiguration {
	readonly runtime: RuntimeOptions & { readonly reservedSessionId: string };
	readonly catalog: CatalogOptions;
}
export function object(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
export const identity = (value: unknown): value is string =>
	typeof value === "string" &&
	/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) &&
	!["constructor", "prototype", "__proto__"].includes(value);
function finiteJson(value: unknown): void {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	)
		return;
	if (Array.isArray(value)) {
		for (const entry of value) finiteJson(entry);
		return;
	}
	if (object(value) && Object.getPrototypeOf(value) === Object.prototype) {
		for (const entry of Object.values(value)) finiteJson(entry);
		return;
	}
	throw new Error("Worker payload must be finite JSON");
}
export function bounded(value: unknown): void {
	finiteJson(value);
	if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
		throw new Error("Worker payload capacity exhausted");
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
	if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unsupported worker field");
}
export function configuration(value: unknown): asserts value is WorkerConfiguration {
	if (!object(value) || !object(value.runtime) || !object(value.catalog))
		throw new Error("Invalid worker configuration");
	keys(value, ["runtime", "catalog"]);
	const runtime = value.runtime,
		catalog = value.catalog;
	keys(runtime, [
		"cwd",
		"dataDir",
		"endpoint",
		"model",
		"apiKey",
		"systemPrompt",
		"limits",
		"profiles",
		"reservedSessionId",
		"reopenSessionFile",
	]);
	if (
		![
			runtime.cwd,
			runtime.dataDir,
			runtime.endpoint,
			runtime.model,
			runtime.apiKey,
			runtime.reservedSessionId,
		].every((field) => typeof field === "string" && field.length > 0) ||
		!object(runtime.limits)
	)
		throw new Error("Invalid worker runtime preset");
	if (
		runtime.profiles !== undefined &&
		(!Array.isArray(runtime.profiles) ||
			runtime.profiles.some(
				(profile) =>
					!object(profile) ||
					!identity(profile.id) ||
					typeof profile.systemPrompt !== "string" ||
					Object.keys(profile).some((key) => !["id", "systemPrompt"].includes(key)),
			))
	)
		throw new Error("Unsupported worker profiles");
	keys(catalog, ["namespace", "maxDeliveries", "maxPending"]);
	if (
		!identity(catalog.namespace) ||
		![catalog.maxDeliveries, catalog.maxPending].every(
			(field) => typeof field === "number" && Number.isSafeInteger(field) && field > 0,
		)
	)
		throw new Error("Invalid worker catalog preset");
	bounded(value);
}
function agent(value: unknown): boolean {
	if (
		!object(value) ||
		![value.key, value.placement, value.sessionId].every(identity) ||
		!object(value.conversation)
	)
		return false;
	return (
		["key", "sessionId", "conversationId", "incarnation", "profile"].every((key) =>
			identity(value.conversation && object(value.conversation) ? value.conversation[key] : undefined),
		) && value.conversation.sessionId === value.sessionId
	);
}
export function envelope(value: unknown): asserts value is RelayEnvelope {
	if (
		!object(value) ||
		!identity(value.id) ||
		!identity(value.principal) ||
		!agent(value.target) ||
		(value.source !== null && !agent(value.source)) ||
		!object(value.input) ||
		!identity(value.input.requestId) ||
		typeof value.input.text !== "string" ||
		!value.input.text.trim() ||
		value.input.text.length > 65536 ||
		!["prompt", "steer", "followUp"].includes(String(value.input.mode ?? "prompt"))
	)
		throw new Error("Invalid worker delivery envelope");
}
export function request(value: unknown): asserts value is WorkerRequest {
	bounded(value);
	if (
		!object(value) ||
		value.version !== 1 ||
		!identity(value.generation) ||
		!identity(value.id) ||
		!object(value.payload) ||
		!["init", "view", "prepare", "activate", "deliver", "receipt", "wait", "close", "cancel"].includes(
			String(value.command),
		)
	)
		throw new Error("Unsupported worker protocol");
	keys(value, ["version", "generation", "id", "command", "payload"]);
	const payload = value.payload;
	if (value.command === "init") configuration(payload);
	else if (value.command === "deliver" || value.command === "receipt" || value.command === "wait") {
		keys(payload, value.command === "deliver" ? ["envelope"] : ["envelope", "nativeId"]);
		envelope(payload.envelope);
		if (value.command !== "deliver" && !identity(payload.nativeId))
			throw new Error("Invalid native receipt identity");
	} else if (value.command === "prepare") {
		keys(payload, ["members"]);
		if (
			!Array.isArray(payload.members) ||
			!payload.members.length ||
			payload.members.length > 64 ||
			payload.members.some(
				(member) =>
					!object(member) ||
					!identity(member.key) ||
					!identity(member.owner) ||
					(member.profile !== undefined && !identity(member.profile)) ||
					Object.keys(member).some((key) => !["key", "owner", "profile"].includes(key)),
			)
		)
			throw new Error("Invalid worker membership");
	} else if (value.command === "cancel") {
		keys(payload, ["targetId"]);
		if (!identity(payload.targetId)) throw new Error("Invalid cancel identity");
	} else keys(payload, []);
}
export function response(value: unknown): asserts value is WorkerResponse {
	bounded(value);
	if (
		!object(value) ||
		value.version !== 1 ||
		!identity(value.id) ||
		!identity(value.generation) ||
		typeof value.ok !== "boolean" ||
		(!value.ok && typeof value.error !== "string")
	)
		throw new Error("Invalid worker response");
	keys(value, ["version", "generation", "id", "ok", "value", "error"]);
}
export function frozen<T>(value: T): T {
	const result = structuredClone(value);
	function freeze(item: unknown): void {
		if (item && typeof item === "object") {
			Object.values(item).forEach(freeze);
			Object.freeze(item);
		}
	}
	freeze(result);
	return result;
}
