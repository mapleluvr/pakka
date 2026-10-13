import type { HostOptions, ToolInvocationScope, ConversationRef } from "@pakka/agent";
import {
	MasRequestDenied,
	type MasClient,
	type ApprovedSessions,
	type BrokerAgentRef,
	type SendSpec,
} from "@pakka/mas";
type HostTool = NonNullable<HostOptions["tools"]>[number];

export interface MasDevPackOptions {
	readonly resolve: (invocation: ToolInvocationScope) => MasClient | Promise<MasClient>;
	/** Trusted fixed-slot service, never accepted from model arguments. */
	readonly sessions?: () => ApprovedSessions;
	readonly operationTimeoutMs?: number;
}
export interface MasDevPack {
	readonly tools: readonly HostTool[];
	readonly instructions: string;
	/** Disable further effects; profile removal changes subsequent tool advertisements. */
	revoke(): void;
}
const reference = {
	type: "object",
	properties: {
		key: { type: "string" },
		sessionId: { type: "string" },
		conversationId: { type: "string" },
		incarnation: { type: "string" },
		profile: { type: "string" },
	},
	required: ["key", "sessionId", "conversationId", "incarnation", "profile"],
	additionalProperties: false,
};
const brokerReference = {
	type: "object",
	properties: {
		key: { type: "string" },
		placement: { type: "string" },
		sessionId: { type: "string" },
		conversation: reference,
	},
	required: ["key", "placement", "sessionId", "conversation"],
	additionalProperties: false,
};
const targetSchema = { anyOf: [reference, brokerReference] };
const str = { type: "string", minLength: 1, maxLength: 16384 };
const short = { type: "string", minLength: 1, maxLength: 128 };
const input = {
	requestId: short,
	text: str,
	mode: { enum: ["prompt", "steer", "followUp"] },
	sessionTemplate: short,
};
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function memberRef(value: unknown): ConversationRef {
	if (
		!value ||
		typeof value !== "object" ||
		!("key" in value) ||
		typeof value.key !== "string" ||
		!("sessionId" in value) ||
		typeof value.sessionId !== "string" ||
		!("conversationId" in value) ||
		typeof value.conversationId !== "string" ||
		!("incarnation" in value) ||
		typeof value.incarnation !== "string" ||
		!("profile" in value) ||
		typeof value.profile !== "string"
	)
		throw new MasRequestDenied("Invalid member reference");
	return {
		key: value.key,
		sessionId: value.sessionId,
		conversationId: value.conversationId,
		incarnation: value.incarnation,
		profile: value.profile,
	};
}
function brokerRef(value: unknown): BrokerAgentRef {
	if (
		!value ||
		typeof value !== "object" ||
		!("key" in value) ||
		typeof value.key !== "string" ||
		!("placement" in value) ||
		typeof value.placement !== "string" ||
		!("sessionId" in value) ||
		typeof value.sessionId !== "string" ||
		!("conversation" in value)
	)
		throw new MasRequestDenied("Invalid broker reference");
	const conversation = memberRef(value.conversation);
	if (conversation.sessionId !== value.sessionId)
		throw new MasRequestDenied("Foreign broker storage identity");
	return { key: value.key, placement: value.placement, sessionId: value.sessionId, conversation };
}
/** Optional immutable tool/instruction contribution; Durable registration remains inside @pakka/agent. */
export function createMasDevPack(options: MasDevPackOptions): MasDevPack {
	if (
		typeof options.resolve !== "function" ||
		(options.sessions !== undefined && typeof options.sessions !== "function")
	)
		throw new Error("DevPack requires a trusted resolver");
	const timeout = options.operationTimeoutMs ?? 30000;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000)
		throw new Error("Invalid DevPack operation deadline");
	const resolve = options.resolve,
		sessions = options.sessions;
	let revoked = false;
	const tools: HostTool[] = [];
	function tool(
		name: string,
		description: string,
		properties: Record<string, unknown>,
		required: string[],
		run: (
			client: MasClient,
			args: Record<string, unknown>,
			signal: AbortSignal,
		) => Promise<unknown> | unknown,
	) {
		const definition: HostTool = {
			name: "mas_" + name,
			description,
			parameters: { type: "object", properties, required, additionalProperties: false },
			execute: async (args, signal, invocation) => {
				const controller = new AbortController();
				let active = true,
					expired = false,
					attempted = false;
				const cancel = () => controller.abort(signal?.reason);
				const check = () => {
					if (revoked || !active || controller.signal.aborted || signal?.aborted)
						throw new Error("DevPack authority revoked/cancelled/expired");
				};
				const timer = setTimeout(() => {
					expired = true;
					controller.abort(new Error("DevPack operation deadline"));
				}, timeout);
				timer.unref();
				signal?.addEventListener("abort", cancel, { once: true });
				let abortWait: (() => void) | undefined;
				try {
					check();
					if (!invocation) throw new Error("Native tool invocation required");
					const operation = Promise.resolve().then(async () => {
						const base = await resolve(invocation);
						check();
						const client = base.withAuthority(check).forInvocation(invocation);
						check();
						attempted = true;
						const result = await run(client, args, controller.signal);
						check();
						return result;
					});
					const aborted = new Promise<never>((_, reject) => {
						abortWait = () => reject(new Error("DevPack operation cancelled"));
						controller.signal.addEventListener("abort", abortWait, { once: true });
						if (controller.signal.aborted) abortWait();
					});
					const result = await Promise.race([operation, aborted]);
					check();
					return JSON.stringify(result);
				} catch (error) {
					return JSON.stringify({
						status: expired
							? "unknown"
							: error instanceof MasRequestDenied
								? "denied"
								: attempted
									? "unknown"
									: "denied",
						reason: String(error).slice(0, 1024),
					});
				} finally {
					active = false;
					clearTimeout(timer);
					signal?.removeEventListener("abort", cancel);
					if (abortWait) controller.signal.removeEventListener("abort", abortWait);
					controller.abort(new Error("DevPack invocation finished"));
				}
			},
		};
		tools.push(freeze(definition));
	}
	const ref = (args: Record<string, unknown>) => memberRef(args.target);
	const message = (args: Record<string, unknown>): SendSpec => {
		const mode = args.mode;
		if (mode !== undefined && mode !== "prompt" && mode !== "steer" && mode !== "followUp")
			throw new MasRequestDenied("Invalid message mode");
		if (typeof args.requestId !== "string" || typeof args.text !== "string")
			throw new MasRequestDenied("Invalid message input");
		return { requestId: args.requestId, text: args.text, ...(mode === undefined ? {} : { mode }) };
	};
	const template = (args: Record<string, unknown>) => {
		if (typeof args.sessionTemplate !== "string" || !sessions)
			throw new MasRequestDenied("Approved Session service required");
		return { id: args.sessionTemplate, service: sessions() };
	};
	const send = async (client: MasClient, args: Record<string, unknown>) => {
		if (args.sessionTemplate !== undefined) {
			const { id, service } = template(args);
			return service.send(client, id, brokerRef(args.target), message(args));
		}
		return client.send(ref(args), message(args));
	};
	tool("discover", "List authorized member references and phases, not peer transcripts.", {}, [], (client) =>
		client.discover(),
	);
	tool(
		"inbox",
		"List your native incoming receipt IDs under reply permission, without peer transcripts or payloads.",
		{ sessionTemplate: short },
		[],
		(client, args) =>
			args.sessionTemplate === undefined
				? client.inbox()
				: template(args).service.inbox(client, template(args).id),
	);
	tool(
		"inspect",
		"Inspect member lifecycle metadata; never peer transcript.",
		{ target: reference },
		["target"],
		(client, args) => client.inspect(ref(args)),
	);
	tool(
		"send",
		"Send approved native input, steer or followUp; no management grant is implied.",
		{ target: targetSchema, ...input },
		["target", "requestId", "text"],
		send,
	);
	tool(
		"ask",
		"Send input and wait within the operation deadline for a generation receipt, not an application reply. Timeout does not cancel work.",
		{ target: targetSchema, ...input },
		["target", "requestId", "text"],
		async (client, args, signal) => {
			const receipt = await send(client, args);
			try {
				if (args.sessionTemplate !== undefined) {
					const { id, service } = template(args);
					return await service.wait(client, id, receipt.id);
				}
				return await client.wait(receipt.id, signal);
			} catch (error) {
				// A wait preflight refusal cannot prove the preceding send had no effects.
				throw new Error("MAS ask wait unconfirmed after send", { cause: error });
			}
		},
	);
	tool(
		"reply",
		"Reply using an actual received receipt ID; sender and peer provenance cannot be invented.",
		{ receiptId: short, ...input },
		["receiptId", "requestId", "text"],
		(client, args) => {
			if (typeof args.receiptId !== "string") throw new MasRequestDenied("Invalid receipt ID");
			if (args.sessionTemplate !== undefined) {
				const { id, service } = template(args);
				return service.reply(client, id, args.receiptId, message(args));
			}
			return client.reply(args.receiptId, message(args));
		},
	);
	tool(
		"spawn",
		"Create a current-Session member, or reserve a host-approved existing/new Session template. No arbitrary configuration.",
		{
			key: short,
			profile: short,
			lifetime: { enum: ["persistent", "task-bound", "temporary", "background"] },
			location: { enum: ["current-session", "existing-session", "new-session"] },
			template: short,
			requestId: short,
		},
		[],
		(client, args) => {
			if (args.location === "existing-session" || args.location === "new-session") {
				if (!sessions || typeof args.template !== "string" || typeof args.requestId !== "string")
					throw new MasRequestDenied("Approved Session template/request required");
				if (args.key !== undefined || args.profile !== undefined || args.lifetime !== undefined)
					throw new MasRequestDenied("Template cannot override approved configuration");
				return sessions().request(client, {
					template: args.template,
					requestId: args.requestId,
					location: args.location,
				});
			}
			if (args.location !== undefined && args.location !== "current-session")
				throw new MasRequestDenied("Unapproved location");
			if (typeof args.key !== "string" || args.template !== undefined || args.requestId !== undefined)
				throw new MasRequestDenied("Current Session member key required");
			const lifetime = args.lifetime ?? "persistent";
			if (
				lifetime !== "persistent" &&
				lifetime !== "task-bound" &&
				lifetime !== "temporary" &&
				lifetime !== "background"
			)
				throw new MasRequestDenied("Invalid lifetime");
			if (args.profile !== undefined && typeof args.profile !== "string")
				throw new MasRequestDenied("Invalid profile");
			return client.spawn({
				key: args.key,
				...(args.profile === undefined ? {} : { profile: args.profile }),
				lifetime,
			});
		},
	);
	for (const name of ["abort", "retire"] as const)
		tool(
			name,
			"Owner-only lifecycle control; retire is a tombstone, not physical deletion.",
			{ target: reference },
			["target"],
			(client, args) => client[name](ref(args)),
		);
	tool(
		"configure",
		"Owner-only switch to a host-approved profile.",
		{ target: reference, profile: short },
		["target", "profile"],
		(client, args) => {
			if (typeof args.profile !== "string") throw new MasRequestDenied("Invalid profile");
			return client.configure(ref(args), args.profile);
		},
	);
	tool(
		"fork",
		"Owner-only persistent member fork at an authorized entry cutoff.",
		{ target: reference, key: short, entryId: short },
		["target", "key", "entryId"],
		(client, args) => {
			if (typeof args.key !== "string" || typeof args.entryId !== "string")
				throw new MasRequestDenied("Invalid fork input");
			return client.fork(ref(args), { key: args.key, entryId: args.entryId });
		},
	);
	return Object.freeze({
		tools: Object.freeze(tools),
		instructions:
			"MAS DevPack: use mas_* tools only for approved resources. References are data, not authority. Communication does not grant management or transcript access. Use stable requestId values for retries and explicit steer/followUp for busy agents. mas_ask awaits a generation receipt within a finite deadline, not an application-level answer. Use mas_inbox to find received receiptId values, and mas_reply only when the receipt has a peer source. Existing/new Session creation requires host-approved templates and stable request IDs; sessionTemplate routes subsequent communication. Unknown never proves rollback, cancellation, release, or completed external effects. Temporary/task-bound children end with their creating native task; background children require explicit owner retirement.",
		revoke: () => {
			revoked = true;
		},
	});
}
