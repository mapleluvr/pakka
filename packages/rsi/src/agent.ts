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
const note = { type: "string", minLength: 0, maxLength: 12000 };
const content = { title: { type: "string", minLength: 1, maxLength: 200 }, body, sources: refs };
const mutation = { requestId: id, id, expectedVersion: version };
const results = {
	type: "array",
	maxItems: 8,
	items: {
		type: "object",
		additionalProperties: false,
		required: ["uri"],
		properties: {
			uri: { type: "string", maxLength: 2048, minLength: 1 },
			version: id,
			sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
			description: { type: "string", maxLength: 1024 },
		},
	},
};
const processRef = {
	type: "object",
	additionalProperties: false,
	required: ["key", "sessionId", "conversationId", "incarnation", "profile"],
	properties: { key: id, sessionId: id, conversationId: id, incarnation: id, profile: id },
};
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
	["observe", "Read a small authority-scoped change token without executing work.", {}, []],
	[
		"get",
		"Read an authorized ticket and bounded history windows; follow cursors with ticket_history.",
		{ id },
		["id"],
	],
	[
		"history",
		"Read the next authorized revisions, events or runs page without executing work.",
		{
			id,
			kind: { enum: ["revisions", "events", "runs"] },
			cursor: { type: "string", maxLength: 2048 },
			limit: { type: "integer", minimum: 1, maximum: 32 },
		},
		["id", "kind"],
	],
	[
		"list",
		"List authorized tickets, with a stable page cursor.",
		{
			state,
			mine: { type: "boolean" },
			cursor: { type: "string", maxLength: 2048 },
			limit: { type: "integer", minimum: 1, maximum: 50 },
		},
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
		"Save a separate report for your trusted original work, including after reassignment. Uses workId from original dispatch/registration. Does not change the current ticket state.",
		{ requestId: id, id, workId: id, text: note, links: refs, results },

		["requestId", "id", "workId", "text", "links"],
	],
	[
		"set-state",
		"Current assigned handler or manager: explicitly change ticket state. Does not save or adopt a report.",
		{ ...mutation, state, text: note, links: refs },
		["requestId", "id", "expectedVersion", "state", "text", "links"],
	],

	[
		"register-work",
		"Manager-only: register fixed original work for the approved current handler and an exact existing Conversation.",
		{ ...mutation, handlerId: id, contentRevision: version, conversation: processRef },
		["requestId", "id", "expectedVersion", "handlerId", "contentRevision", "conversation"],
	],

	[
		"set-work-contribution",
		"Manager-only: enable/disable future original-work contributions. Does not cancel native execution or erase reports.",
		{ requestId: id, id, workId: id, expectedVersion: version, allowed: { type: "boolean" } },
		["requestId", "id", "workId", "expectedVersion", "allowed"],
	],

	[
		"get-work",
		"Read your authorized fixed original work and original content revision, not the current ticket's future content.",
		{ id, workId: id },
		["id", "workId"],
	],

	[
		"revise-report",
		"Revise your saved report at its own report version; keep old versions. Does not change ticket state.",
		{ requestId: id, id, reportId: id, expectedVersion: version, text: note, links: refs, results },
		["requestId", "id", "reportId", "expectedVersion", "text", "links"],
	],

	[
		"read-report",
		"Read one authorized report, optionally at a fixed report version. Does not execute original work.",
		{ id, reportId: id, version },
		["id", "reportId"],
	],

	[
		"reports",
		"List bounded authorized report references; read bodies separately with ticket_read_report.",
		{ id, cursor: { type: "string", maxLength: 2048 }, limit: { type: "integer", minimum: 1, maximum: 32 } },
		["id"],
	],

	[
		"dispatch",
		"Manager-only: explicitly dispatch the assigned ticket revision through the approved MAS route. Does not wait for generation completion.",
		mutation,
		["requestId", "id", "expectedVersion"],
	],
	[
		"recover",
		"Manager-only: explicitly continue an unsent run plan or reconcile the original request. Never replay an unknown send.",
		{ ...mutation, runId: id },
		["requestId", "id", "expectedVersion", "runId"],
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
		name: "ticket_" + action.replaceAll("-", "_"),

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
			"Use ticket_submit to record ideas without waiting for processing. Preserve returned ticket IDs and requestIds; use ticket_get/list to observe and ticket_edit to update your own content. A saved ticket is not a completed task. A saved report is a contribution, not a ticket state decision. Save original work reports with ticket_report and use ticket_set_state explicitly for current progress. On an unknown write, use ticket_lookup with the original requestId. Dispatch and management require explicit authority.",

		revoke: () => {
			revoked = true;
		},
	});
}
