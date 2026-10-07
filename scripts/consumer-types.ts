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
	ToolInvocationScope,
} from "@pakka/agent";

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
