import {
	BudgetChangeRefusedError,
	type Runtime,
	type RuntimeLimits,
	type ConversationRef,
} from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "@pakka/server/pocket";
import { identity } from "@pakka/protocol";
import type { ProductModelSource, ProductModelQuery } from "./product-models.ts";
import type { AuthType } from "@earendil-works/pi-ai";

type Target = Pick<ConversationRef, "sessionId" | "conversationId">;
export type ProductModelCommand =
	| { readonly op: "status" | "refresh" }
	| { readonly op: "catalog"; readonly query: ProductModelQuery; readonly target?: Target }
	| { readonly op: "auth.prepare"; readonly provider: string; readonly type: AuthType }
	| { readonly op: "auth.start" | "auth.state" | "auth.cancel"; readonly id: string }
	| { readonly op: "auth.answer"; readonly id: string; readonly promptId: string; readonly value: string }
	| { readonly op: "auth.logout"; readonly provider: string }
	| { readonly op: "budget.read"; readonly sessionId: string }
	| {
			readonly op: "budget.history";
			readonly sessionId: string;
			readonly limit?: number;
			readonly beforeVersion?: number;
	  }
	| { readonly op: "budget.receipt"; readonly sessionId: string; readonly originalRequestId: string }
	| {
			readonly op: "budget.change";
			readonly sessionId: string;
			readonly expectedVersion: number;
			readonly limits: RuntimeLimits;
			readonly reason: string;
	  };
export interface ProductModelRequest {
	readonly version: 2;
	readonly requestId: string;
	readonly command: ProductModelCommand;
}
export class ProductModelRequestError extends Error {
	readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "CONFLICT";
	constructor(code: "INVALID_REQUEST" | "FORBIDDEN" | "CONFLICT") {
		super("Model configuration request refused");
		this.code = code;
	}
}
function shape(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): value is Record<string, unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		required.every((key) => Object.hasOwn(value, key)) &&
		Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
	);
}
const text = (value: unknown, max: number) =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= max &&
	!/[\u0000-\u001f\u007f]/.test(value);
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
	Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
function command(value: unknown): value is ProductModelCommand {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const v = value as Record<string, unknown>;
	switch (v.op) {
		case "status":
		case "refresh":
			return shape(v, ["op"]);
		case "catalog":
			return (
				shape(v, ["op", "query"], ["target"]) &&
				shape(v.query, [], ["provider", "query", "availableOnly", "offset", "limit", "revision"]) &&
				(v.query.provider === undefined || text(v.query.provider, 256)) &&
				(v.query.query === undefined || (typeof v.query.query === "string" && v.query.query.length <= 256)) &&
				(v.query.availableOnly === undefined || typeof v.query.availableOnly === "boolean") &&
				(v.query.offset === undefined || integer(v.query.offset)) &&
				(v.query.limit === undefined || integer(v.query.limit, 1, 100)) &&
				(v.query.revision === undefined || identity(v.query.revision)) &&
				(v.target === undefined ||
					(shape(v.target, ["sessionId", "conversationId"]) &&
						identity(v.target.sessionId) &&
						identity(v.target.conversationId)))
			);
		case "auth.prepare":
			return (
				shape(v, ["op", "provider", "type"]) &&
				text(v.provider, 256) &&
				["api_key", "oauth"].includes(v.type as string)
			);
		case "auth.start":
		case "auth.state":
		case "auth.cancel":
			return shape(v, ["op", "id"]) && identity(v.id);
		case "auth.answer":
			return (
				shape(v, ["op", "id", "promptId", "value"]) &&
				identity(v.id) &&
				identity(v.promptId) &&
				typeof v.value === "string" &&
				v.value.length <= 16384
			);
		case "auth.logout":
			return shape(v, ["op", "provider"]) && text(v.provider, 256);
		case "budget.read":
			return shape(v, ["op", "sessionId"]) && identity(v.sessionId);
		case "budget.history":
			return (
				shape(v, ["op", "sessionId"], ["limit", "beforeVersion"]) &&
				identity(v.sessionId) &&
				(v.limit === undefined || integer(v.limit, 1, 100)) &&
				(v.beforeVersion === undefined || integer(v.beforeVersion, 1))
			);
		case "budget.receipt":
			return (
				shape(v, ["op", "sessionId", "originalRequestId"]) &&
				identity(v.sessionId) &&
				identity(v.originalRequestId)
			);
		case "budget.change":
			return (
				shape(v, ["op", "sessionId", "expectedVersion", "limits", "reason"]) &&
				identity(v.sessionId) &&
				integer(v.expectedVersion) &&
				text(v.reason, 512) &&
				shape(v.limits, ["maxConversations", "maxPrimaryAttempts", "maxAuxiliaryAttempts"]) &&
				Object.values(v.limits).every((value) => integer(value, 1))
			);
		default:
			return false;
	}
}
export function decodeProductModelRequest(value: unknown): ProductModelRequest {
	if (
		!shape(value, ["version", "requestId", "command"]) ||
		value.version !== 2 ||
		!identity(value.requestId) ||
		!command(value.command)
	)
		throw new ProductModelRequestError("INVALID_REQUEST");
	return { version: 2, requestId: value.requestId, command: structuredClone(value.command) };
}

/** Private configuration transport, separate from transcripts, extensions and display documents. */
export async function executeProductModelRequest(
	options: {
		readonly source?: ProductModelSource;
		readonly people: PocketPeople;
		readonly actor: PocketAuthority;
		readonly runtimeFor: (sessionId: string) => Runtime;
		readonly signal: AbortSignal;
	},
	request: ProductModelRequest,
): Promise<unknown> {
	const { source, people, actor } = options,
		input = request.command;
	if (input.op === "catalog") {
		const check = () => {
			options.signal.throwIfAborted();
			try {
				people.current(actor);
				people.check(
					actor,
					input.target ? "read" : "create",
					input.target ? people.resourceId(input.target) : undefined,
				);
			} catch {
				throw new ProductModelRequestError("FORBIDDEN");
			}
		};
		check();
		if (!source) throw new Error("Native model configuration unavailable");
		return {
			kind: "catalog",
			page: source.bind({ id: people.current(actor).id, check }).catalog(input.query),
		};
	}
	let scope: ReturnType<PocketPeople["lease"]>;
	try {
		scope = people.lease(actor, "extensions.install", { ttlMs: 600000 });
	} catch {
		throw new ProductModelRequestError("FORBIDDEN");
	}
	let transferred = false;
	const signal = AbortSignal.any([scope.signal, options.signal]);
	const check = () => {
		signal.throwIfAborted();
		scope.check();
	};
	try {
		check();
		if (input.op.startsWith("budget.")) {
			if (!("sessionId" in input)) throw new ProductModelRequestError("INVALID_REQUEST");
			const runtime = options.runtimeFor(input.sessionId),
				actorId = people.current(actor).id;
			switch (input.op) {
				case "budget.read":
					return { kind: "budget", sessionId: input.sessionId, policy: await runtime.budgetPolicy(check) };
				case "budget.history":
					return {
						kind: "budget.history",
						sessionId: input.sessionId,
						page: await runtime.budgetHistory(
							{ limit: input.limit, beforeVersion: input.beforeVersion },
							check,
						),
					};
				case "budget.receipt":
					return {
						kind: "budget.receipt",
						sessionId: input.sessionId,
						receipt: await runtime.budgetReceipt({ actorId, requestId: input.originalRequestId }, check),
					};
				case "budget.change": {
					try {
						const receipt = await runtime.changeBudget(
							{
								actorId,
								requestId: request.requestId,
								expectedVersion: input.expectedVersion,
								limits: input.limits,
								reason: input.reason,
							},
							check,
						);
						return { kind: "budget.receipt", sessionId: input.sessionId, receipt };
					} catch (error) {
						if (error instanceof BudgetChangeRefusedError) throw new ProductModelRequestError(error.code);
						throw error;
					}
				}
			}
		}
		if (!source) throw new Error("Native model configuration unavailable");
		const bound = source.bind({ id: scope.id, check, signal, release: () => scope.close() });
		switch (input.op) {
			case "status":
				return { kind: "status", status: bound.status(), providers: bound.auth.providers() };
			case "refresh":
				return { kind: "status", status: await bound.refresh(), providers: bound.auth.providers() };
			case "auth.prepare": {
				const flow = bound.auth.prepare(input.provider, input.type);
				transferred = true;
				return { kind: "auth", flow };
			}
			case "auth.start":
				return { kind: "auth", flow: bound.auth.start(input.id) };
			case "auth.state":
				return { kind: "auth", flow: bound.auth.state(input.id) };
			case "auth.cancel":
				return { kind: "auth", flow: bound.auth.cancel(input.id) };
			case "auth.answer":
				bound.auth.answer(input.id, input.promptId, input.value);
				return { kind: "updated" };
			case "auth.logout":
				await bound.auth.logout(input.provider);
				return { kind: "updated" };
			default:
				throw new ProductModelRequestError("INVALID_REQUEST");
		}
	} finally {
		if (!transferred) scope.close();
	}
}
