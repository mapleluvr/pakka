import type {
	ArtifactReceipt,
	ArtifactScope,
	ContextFrame,
	EntryMessagePatch,
	FrameBasis,
	InferenceAudit,
	InferenceRequest,
	JobScope,
	ModelDTO,
	ProjectionPlan,
	SourceJob,
	SourceJobSpec,
	StrategyBinding,
	SummaryRangeReplacement,
	HostOptions,
	Receipt,
	ToolInvocationScope,
	Runtime,
	RuntimeOptions,
	ConversationRef,
} from "@pakka/agent";
import type { Mas, MasClient, MemberSpec, SendSpec, AgentRef } from "@pakka/mas";

export async function masContract(mas: Mas, client: MasClient, ref: AgentRef, input: SendSpec) {
	const member: MemberSpec = { key: "reviewer", owner: "operator" };
	await mas.bootstrap([member]);
	const delivery = await client.send(ref, input);
	const outcome = await client.wait(delivery.id);
	// @ts-expect-error storage paths are not an agent-supplied resource creation option.
	await client.spawn({ key: "worker", dataDir: "/untrusted" });
	// @ts-expect-error sender cannot declare a different principal on an operation.
	await client.send(ref, { ...input, principal: "forged" });
	return outcome;
}

export function productionContract(options: HostOptions, receipt: Receipt) {
	// @ts-expect-error AgentSession is only a test oracle, not a public runtime selection.
	options.backend = "oracle";
	const blocked: ProjectionPlan = { status: "blocked", basis: {}, reason: "denied" };
	return { blocked, generation: receipt.generation };
}

export async function managed(runtime: Runtime, options: RuntimeOptions, ref: ConversationRef) {
	const host = await runtime.conversation(ref);
	const identity = host.view().conversationId;
	return { limits: options.limits, budget: runtime.view().budget, identity };
}

export function install(binding: StrategyBinding, invocation?: ToolInvocationScope) {
	const frame: ContextFrame = binding.readFrame(invocation);
	const basis: FrameBasis = frame.basis;
	const models: readonly ModelDTO[] = binding.models();
	const target = frame.projection.find(
		(entry) => !entry.boundary && !entry.excluded && entry.messages.length,
	)!;
	const spec: SourceJobSpec = {
		planId: "external-plan",
		targetEntryIds: [target.sourceEntryId],
		contextEntryIds: [],
		maxCalls: 1,
	};
	const job: SourceJob = binding.createJob(basis, spec);
	const scope: JobScope = job.scope;
	const artifactScope: ArtifactScope = scope;
	const receipt: ArtifactReceipt = binding.artifacts.append(artifactScope, {
		expectedVersion: frame.artifacts.version,
		records: [{ kind: "plan" }],
	});
	const patch: EntryMessagePatch = {
		sourceEntryId: target.sourceEntryId,
		messageIndex: 0,
		content: [{ type: "text", text: "tagged" }],
	};
	const replacement: SummaryRangeReplacement = {
		sourceEntryIds: spec.targetEntryIds,
		summary: "summary",
		jobScope: scope,
	};
	const omission: SummaryRangeReplacement = { ...replacement, summary: null };
	const plan: ProjectionPlan = { status: "apply", basis: binding.readFrame().basis, patches: [patch] };
	const remove = binding.installProjector((request) => ({ ...plan, basis: request.basis }));
	const request: InferenceRequest = {
		modelKey: models[0].key,
		prompt: "target",
		maxOutputTokens: 64,
		thinkingLevel: "off",
	};
	const infer = job.infer(request);
	const audit: readonly InferenceAudit[] = binding.audit();
	binding.subscribe((event) => {
		if (event.phase === "ready") binding.readFrame();
	});
	return { receipt, replacement, omission, remove, infer, audit };
}
