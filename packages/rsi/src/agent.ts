import type { HostOptions, ToolInvocationScope } from "@pakka/agent";
import { TicketError, type TicketClient } from "./types.ts";
import { executeTicketAction, ticketFailure, type TicketAction } from "./commands.ts";
import { frozen } from "./validation.ts";
type HostTool = NonNullable<HostOptions["tools"]>[number];
export interface TicketToolsOptions {
	/** Trusted resolver must bind the exact native scope, e.g. service.forInvocation(...). */
	readonly resolve: (scope: ToolInvocationScope) => TicketClient | Promise<TicketClient>;
	readonly timeoutMs?: number;
}
const id = { type: "string", minLength: 1, maxLength: 160 };
const version = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const refs = { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 2048 } };
const state = { enum: ["open", "active", "waiting", "closed"] };
const body = { type: "string", minLength: 1, maxLength: 12000 };
const content = { title: { type: "string", minLength: 1, maxLength: 200 }, body, sources: refs };
const mutation = { requestId: id, id, expectedVersion: version };
const definitions: readonly [TicketAction, string, Record<string, object>, readonly string[]][] = [
	[
		"submit",
		"Save a ticket and return its ID immediately after persistence. Does not start or wait for processing. Reuse requestId when reconciling the identical submission.",
		{ requestId: id, ...content },
		["requestId", "title", "body", "sources"],
	],
	[
		"edit",
		"Revise your ticket at the expected version. Does not restart or alter an existing run.",
		{ ...mutation, ...content },
		["requestId", "id", "expectedVersion", "title", "body", "sources"],
	],
	["get", "Read an authorized ticket, revisions, progress and linked runs.", { id }, ["id"]],
	[
		"list",
		"List authorized tickets, with a stable page cursor.",
		{ state, mine: { type: "boolean" }, cursor: id, limit: { type: "integer", minimum: 1, maximum: 50 } },
		[],
	],
	[
		"lookup",
		"Read your original mutation receipt without repeating any effect.",
		{ requestId: id },
		["requestId"],
	],
	["capabilities", "Read your current ticket capabilities and approved handler choices.", {}, []],
	[
		"assign",
		"Manager-only: assign a registered handler, or clear assignment using null.",
		{ ...mutation, handlerId: { anyOf: [id, { type: "null" }] } },
		["requestId", "id", "expectedVersion", "handlerId"],
	],
	[
		"report",
		"Assigned handler or manager: report progress or resolve/reopen the ticket, with result references.",
		{ ...mutation, state, text: body, links: refs },
		["requestId", "id", "expectedVersion", "state", "text", "links"],
	],
	[
		"dispatch",
		"Manager-only: explicitly dispatch the assigned ticket revision through the approved MAS route. Does not wait for generation completion.",
		mutation,
		["requestId", "id", "expectedVersion"],
	],
	[
		"refresh",
		"Refresh the original MAS receipt for a ticket run without resubmitting work.",
		{ id, runId: id },
		["id", "runId"],
	],
];
export function createTicketTools(options: TicketToolsOptions): {
	readonly tools: readonly HostTool[];
	readonly instructions: string;
	revoke(): void;
} {
	if (typeof options.resolve !== "function")
		throw new TicketError("invalid", "Trusted ticket resolver required");
	const timeoutMs = options.timeoutMs ?? 30000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
		throw new TicketError("invalid", "Invalid ticket tool deadline");
	const resolve = options.resolve;
	let revoked = false;
	const tools: HostTool[] = definitions.map(([action, description, properties, required]) => ({
		name: "ticket_" + action,
		description,
		parameters: { type: "object", properties, required, additionalProperties: false },
		async execute(input, signal, scope) {
			let active = true,
				timer: ReturnType<typeof setTimeout> | undefined,
				cancel: (() => void) | undefined;
			const check = () => {
				if (revoked || !active || signal?.aborted)
					throw new TicketError("denied", "Ticket tool permission ended");
			};
			try {
				check();
				if (!scope) throw new TicketError("denied", "Native ticket invocation required");
				const timeout = new Promise<never>((_, reject) => {
					cancel = () => {
						active = false;
						reject(new TicketError("unknown", "Ticket operation interrupted; inspect its original request"));
					};
					timer = setTimeout(cancel, timeoutMs);
					timer.unref();
					signal?.addEventListener("abort", cancel, { once: true });
				});
				const operation = Promise.resolve().then(async () => {
					const client = await resolve(scope);
					check();
					const value = await executeTicketAction(client.withAuthority(check), action, input);
					check();
					return value;
				});
				const value = await Promise.race([operation, timeout]);
				check();
				return JSON.stringify({ status: "ok", value });
			} catch (error) {
				return JSON.stringify(ticketFailure(error));
			} finally {
				active = false;
				if (timer) clearTimeout(timer);
				if (cancel) signal?.removeEventListener("abort", cancel);
			}
		},
	}));
	return Object.freeze({
		tools: frozen(tools),
		instructions:
			"Use ticket_submit to record ideas without waiting for processing. Preserve returned ticket IDs and requestIds; use ticket_get/list to observe and ticket_edit to update your own content. A saved ticket is not a completed task. On an unknown write, use ticket_lookup with the original requestId. Dispatch and management require explicit authority.",
		revoke: () => {
			revoked = true;
		},
	});
}
