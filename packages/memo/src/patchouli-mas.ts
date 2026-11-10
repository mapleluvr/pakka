import type { Runtime, ConversationRef, HostOptions, ToolInvocationScope } from "@pakka/agent";
import type { Mas, MasClient } from "@pakka/mas";
import { MemoError } from "./contracts.ts";
import { createMemoTools } from "./agent.ts";
import { hash, frozen, shape, id } from "./validation.ts";
import type { ResearchDriver, PatchouliService } from "./patchouli-contracts.ts";
// Only the latest cancellation per bound route is retained, shared across driver/service handles.
const cancellations = new WeakMap<Runtime, Map<string, { requestId: string; settled: Promise<void> }>>();
export async function createMasResearchDriver(options: {
	runtime: Runtime;
	mas: Mas;
	client: MasClient;
	target: ConversationRef;
}): Promise<ResearchDriver> {
	const { runtime, client } = options,
		target = frozen(structuredClone(options.target)),
		membership = await options.mas.view();
	if (
		!membership.members.some(
			(m) => m.lifetime === "persistent" && m.phase === "active" && hash(m.ref) === hash(target),
		)
	)
		throw new MemoError("denied", "An active persistent research member is required");
	const identity = frozen({
		namespace: membership.namespace,
		principal: client.identity.principal,
		source: client.identity.source,
		target,
	});
	let pending = cancellations.get(runtime);
	if (!pending) {
		pending = new Map();
		cancellations.set(runtime, pending);
	}
	const routeCancels = pending,
		routeKey = hash(identity);
	const catalog = runtime.catalog({ namespace: "memo.research-invocations", maxPending: 1 });
	const check = () => {
		client.authorize("send");
		client.authorize("observe");
		if (!runtime.view().conversations.some((ref) => hash(ref) === hash(target)))
			throw new MemoError("denied", "Original research member is unavailable");
	};
	check();
	return Object.freeze({
		identity,
		check,
		async idle(authority) {
			check();
			authority();
			const state = await runtime.previewConversation(
				target,
				() => {
					check();
					authority();
				},
				{ limit: 1, maxBytes: 16384 },
			);
			authority();
			return !state.live.busy;
		},
		checkInvocation(scope) {
			check();
			try {
				catalog.checkInvocation(target, scope);
			} catch {
				throw new MemoError("denied", "Current native research invocation required");
			}
		},
		async send(input, authority) {
			check();
			authority();
			const value = await client.withAuthority(authority).send(target, { ...input, mode: "followUp" });
			authority();
			return frozen({ id: value.id, state: value.status });
		},
		async lookup(input, authority) {
			check();
			authority();
			const value = await client.withAuthority(authority).lookup(target, { ...input, mode: "followUp" });
			authority();
			return value ? frozen({ id: value.id, state: value.status }) : null;
		},
		async observe(receiptId, authority) {
			check();
			authority();
			const value = await client.withAuthority(authority).receipt(receiptId);
			authority();
			return frozen({ id: value.id, state: value.status });
		},
		async cancel(requestId, authority) {
			id(requestId);
			check();
			authority();
			let original = routeCancels.get(routeKey);
			if (original?.requestId !== requestId) {
				const attempt = { requestId, settled: Promise.resolve() };
				attempt.settled = Promise.resolve()
					.then(async () => {
						check();
						authority();
						await client.withAuthority(authority).abort(target);
					})
					.catch((error) => {
						if (routeCancels.get(routeKey) === attempt) routeCancels.delete(routeKey);
						throw error;
					});
				routeCancels.set(routeKey, attempt);
				original = attempt;
			}
			await original.settled;
			authority();
		},
	} satisfies ResearchDriver);
}
export function createPatchouliTools(resolve: (scope: ToolInvocationScope) => PatchouliService): {
	readonly tools: NonNullable<HostOptions["tools"]>;
	readonly instructions: string;
	revoke(): void;
} {
	let revoked = false;
	const knowledge = createMemoTools({
		resolve: (scope) => {
			if (revoked) throw new MemoError("denied", "Research tools revoked");
			return resolve(scope).knowledgeForInvocation(scope);
		},
	});
	const finish: NonNullable<HostOptions["tools"]>[number] = {
		name: "research_finish",
		description:
			"Finish the active research run. No report or publication is required; actual Wiki write receipts determine publications.",
		parameters: {
			type: "object",
			properties: { runId: { type: "string" } },
			required: ["runId"],
			additionalProperties: false,
		},
		async execute(input, signal, scope) {
			try {
				if (revoked || signal?.aborted || !scope)
					throw new MemoError("denied", "Current research invocation required");
				shape(input, ["runId"]);
				id(input.runId);
				const result = await resolve(scope).finish(scope, { runId: input.runId });
				return JSON.stringify({ status: "ok", value: result });
			} catch (error) {
				return JSON.stringify(
					error instanceof MemoError
						? { status: error.code, message: error.message }
						: { status: "unknown", message: "Research completion requires reconciliation." },
				);
			}
		},
	};
	return Object.freeze({
		tools: frozen([...knowledge.tools, finish]),
		instructions:
			knowledge.instructions +
			" Select libraryId explicitly for every search. Use the current research writeRequestPrefix for Wiki mutation request IDs. Research may span multiple answers; use research_finish only when this run is actually complete. Completion with no publication is valid.",
		revoke() {
			revoked = true;
			knowledge.revoke();
		},
	});
}
