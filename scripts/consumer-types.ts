import { defineBackend, type BackendContext, type PocketServiceContext } from "@pakka/webui/backend";
import { createMasProfilePacks } from "@pakka/mas-devpack/agent";
import {
	workspaceFilesService,
	workspaceFilesExtensionRoot,
	workspaceBrowserService,
	workspaceBrowserExtensionRoot,
	workspaceApprovalsService,
	workspaceApprovalsExtensionRoot,
} from "@pakka/webui/workflows";
import { approvalTool, type PocketApprovals } from "@pakka/server/pocket";
import { masWorkbenchService } from "@pakka/mas-devpack/backend";
import type { ExtensionHost } from "@pakka/webui/backend";
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
	ConversationProfile,
} from "@pakka/agent";
const approvedModelProfile: ConversationProfile = { id: "approved", model: "exact-host-approved-model" };
void approvedModelProfile;
import type { Mas, MasClient, MemberSpec, SendSpec, AgentRef } from "@pakka/mas";
import type { RuntimeStore, RuntimeJobOptions } from "@pakka/agent";
import type { PocketPeople, PocketAuthority, PocketWorkspace, PocketCredentials } from "@pakka/server/pocket";
import type { Broker, BrokerClient, BrokerAgentRef } from "@pakka/mas/broker";
import type { WorkerManager } from "@pakka/server";
import type { BootstrapConfig } from "@pakka/server/bootstrap";
import { createMasDevPack, type MasDevPackOptions } from "@pakka/mas-devpack";
import type { ApprovedSessions } from "@pakka/mas";

export async function publicControlledWorkflows(
	context: PocketServiceContext,
	approvals: PocketApprovals,
	actor: PocketAuthority,
	ref: ConversationRef,
) {
	const service = await workspaceBrowserService(context, {
		namespace: "approved.browser",
		executable: "/host-approved/chrome",
		origins: ["https://approved.example"],
		resources: [ref.conversationId],
	});
	const client = service.bind(actor, ref, () => {});
	await client.navigate({ requestId: "navigate", url: "https://approved.example" });
	// @ts-expect-error The bound browser API cannot execute arbitrary JavaScript from a caller.
	client.evaluate("arbitrary code");
	const tool = approvalTool(
		{
			name: "approved_effect",
			description: "Governed effect",
			parameters: { type: "object", properties: {} },
			execute: async () => "done",
		},
		() => ({ approvals, target: ref }),
	);
	await service.dispose?.();
	return {
		tool,
		approvals: workspaceApprovalsService(approvals),
		browserRoot: workspaceBrowserExtensionRoot,
		approvalRoot: workspaceApprovalsExtensionRoot,
	};
}

export async function publicFilesWorkflow(context: PocketServiceContext) {
	const service = await workspaceFilesService(context, {
		namespace: "approved.files",
		roots: [{ id: "approved", path: "/host-approved", resources: "*", writable: true }],
	});
	return { service, root: workspaceFilesExtensionRoot };
}

export function publicMasFacets(context: PocketServiceContext, mas: Mas) {
	const profiles = createMasProfilePacks({ profiles: { coordinator: ["spawn", "send"] } }, () => mas);
	const service = masWorkbenchService({ ...context, mas });
	// @ts-expect-error A product-service context contains the controlled Runtime port, never a mutable native Session.
	context.runtime.session.commit();
	// @ts-expect-error Human installation permission is not a native Agent grant.
	createMasProfilePacks({ profiles: { forged: ["extensions.install"] } }, () => mas);
	return { profiles, service };
}

export function extensionBackendContract(context: BackendContext, host: ExtensionHost) {
	// @ts-expect-error Backend context does not expose native mutable Pi/session objects.
	context.runtime.session.commit();
	const module = defineBackend({
		actions: { read: async (current) => (await current.settings.get("label")).value },
	});
	const lookup = (
		actor: Parameters<ExtensionHost["operationByRequest"]>[0],
		request: Parameters<ExtensionHost["operationByRequest"]>[1],
	) => host.operationByRequest(actor, request);
	return { module, host, lookup, job: context.jobs.receipt("job-id") };
}

export async function privateConfigurationContract(credentials: PocketCredentials, actor: PocketAuthority) {
	const client = credentials.bind(actor);
	const status = await client.status();
	// @ts-expect-error The bound human client cannot read the saved key.
	void status.secret;
	// @ts-expect-error The host credential resolver is not exposed to a human client.
	void client.resolve();
	await client.replace({ requestId: "replace", expectedVersion: status.version, secret: "synthetic" });
	// @ts-expect-error Clear is explicit and never accepts a replacement value.
	void client.clear({ requestId: "clear", expectedVersion: status.version, secret: "forged" });
	return credentials.resolve;
}

export async function pocketServiceContract(
	people: PocketPeople,
	actor: PocketAuthority,
	workspace: PocketWorkspace,
	runtime: Runtime,
	ref: ConversationRef,
) {
	people.check(actor, "read", ref.conversationId);
	const client = workspace.bind(actor);
	await client.read(ref, { limit: 16 });
	// @ts-expect-error A browser command cannot select an actor, credential or host configuration.
	await client.create({ requestId: "one", name: "Work", profile: "safe", actorId: "forged" });
	// @ts-expect-error Mutable native runtime handles are not part of the authority.
	actor.session.commit();
	const options: RuntimeJobOptions = { namespace: "jobs", maxJobs: 16, maxBytes: 65536 };
	const port = runtime.jobs(options);
	await port.start(
		{ requestId: "one", actorId: actor.person.id, target: ref, definition: "approved", payload: {} },
		() => people.check(actor, "send", ref.conversationId),
	);
	// @ts-expect-error Job admission requires an explicit bound authority check.
	await port.start({
		requestId: "one",
		actorId: actor.person.id,
		target: ref,
		definition: "approved",
		payload: {},
	});
}

export function productContract(config: BootstrapConfig) {
	const contribution: NonNullable<BootstrapConfig["devpack"]> = {
		profiles: { default: ["spawn", "observe"] },
	};
	// @ts-expect-error strategy inference is not an agent MAS creation grant.
	const _invalid: NonNullable<BootstrapConfig["devpack"]> = { profiles: { default: ["model.infer"] } };
	// @ts-expect-error mutable native handles are not JSON product contributions.
	const _forged: NonNullable<BootstrapConfig["devpack"]> = { profiles: { default: ["spawn"] }, session: {} };
	void _invalid;
	void _forged;
	return { config, contribution };
}

export function devpackContract(client: MasClient, sessions: ApprovedSessions) {
	const options: MasDevPackOptions = {
		resolve: () => client,
		sessions: () => sessions,
		operationTimeoutMs: 1000,
	};
	const pack = createMasDevPack(options);
	const tools: HostOptions["tools"] = pack.tools;
	// @ts-expect-error no credentials in the public DevPack composition options.
	createMasDevPack({ ...options, apiKey: "forged" });
	// @ts-expect-error no mutable runtime/bootstrap objects escape through the contribution.
	pack.runtime.createConversation();
	return { tools, instructions: pack.instructions, revoke: pack.revoke };
}

export async function brokerContract(
	broker: Broker,
	client: BrokerClient,
	store: RuntimeStore,
	workers: WorkerManager,
	ref: BrokerAgentRef,
	input: SendSpec,
) {
	const state = await store.snapshot();
	const persisted = await store.compareAndSet(state.version, state.data, () => {});
	const receipt = await client.send(ref, input);
	const worker = await workers.placement(ref.placement).open(ref.sessionId);
	// @ts-expect-error no native Tx or Session escapes a bootstrap store.
	store.session.commit();
	// @ts-expect-error business input cannot choose another storage or process configuration.
	await client.send(ref, { ...input, dataDir: "/untrusted" });
	// @ts-expect-error there is no publicly selectable grant/action argument.
	await client.send(ref, input, "reply");
	return { persisted, worker: await worker.view(), view: await broker.view(), receipt };
}

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

export async function pocketObservation(runtime: Runtime, ref: ConversationRef) {
	const snapshot = await runtime.readConversation(ref, () => {});
	const display = await runtime.writeDisplay(
		ref,
		{ namespace: "example", actorId: "person", requestId: "card", kind: "card", text: "display only" },
		() => {},
	);
	// @ts-expect-error native Session is never part of an observation DTO.
	snapshot.session.commit();
	// @ts-expect-error raw native entry data is not a public read surface.
	void snapshot.entries[0]!.raw;
	// @ts-expect-error a human authority check is mandatory, not an optional default grant.
	await runtime.readConversation(ref);
	await runtime.writeDisplay(
		ref,
		{
			namespace: "example",
			actorId: "person",
			requestId: "card",
			text: "sneak",
			// @ts-expect-error display writes cannot become model input by selecting a native kind.
			kind: "pi.user",
		},
		() => {},
	);
	return { snapshot, display };
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
