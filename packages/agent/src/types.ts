export type Hook = "real_context.write" | "context_artifacts.write";
export type Grant = Hook | "input.submit" | "branch.control" | "model.infer";
export type InputMode = "prompt" | "steer" | "followUp";
export type ReceiptState =
	| "reserved"
	| "queued"
	| "consumed"
	| "committed"
	| "handled"
	| "released"
	| "unknown";
export type Capability = object;
export interface Receipt {
	readonly id: string;
	readonly key: string;
	readonly principal: string;
	readonly sessionId: string;
	readonly branchId: string;
	readonly attempt: number;
	readonly state: ReceiptState;
	readonly entryId?: string;
	readonly reason?: string;
	/** Generation outcome is independent of whether this input was persisted. */
	readonly generation?: { readonly status: "blocked"; readonly reason: string };
}
export interface View {
	/** Storage/provenance identity; sessionId keeps its legacy meaning. */
	readonly durableSessionId?: string;
	readonly conversationId?: string;
	/** Native pi.provider identity, independent for each Conversation/fork. */
	readonly providerSessionId?: string;
	readonly phase: "ready" | "transitioning" | "failed" | "disposed";
	readonly busy: boolean;
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly branchId: string;
	readonly epoch: number;
	readonly generation: number;
	readonly leafId: string | null;
	readonly entries: readonly { id: string; type: string; role?: string; text?: string }[];
	readonly context: readonly { role: string; text: string }[];
	readonly autoCompaction: boolean;
	readonly lastError?: string;
	readonly effects: "not-assessed" | "unknown";
}
export type Proposal =
	| { type: "cut"; summary: string; firstKeptEntryId: string | null; tokensBefore: number }
	| { type: "edit"; targetId: string; text: string | null };
export type Decision =
	| { readonly status: "committed"; readonly entryId: string }
	| { readonly status: "denied"; readonly reason: string }
	| { readonly status: "unknown"; readonly reason: string };
export type Policy = (
	request: Readonly<{ principal: string; proposal: Proposal }>,
) => boolean | Promise<boolean>;
export interface Client {
	view(): View;
	capture(): Capability;
	activateStrategy(spec: { id: string; hooks: readonly Hook[] }): void;
	deactivateStrategy(id: string): void;
	bindStrategy(id: string): StrategyBinding;
	setPolicy(policy: Policy): void;
	commit(at: Capability, proposal: Proposal): Promise<Decision>;
	submit(input: { key: string; text: string; mode?: InputMode; at?: Capability }): Promise<Receipt>;
	receipt(id: string): Receipt | undefined;
	/** Requests withdrawal; returns unknown until Durable confirms no placement. Observe receipts for release. */
	cancelQueued(): readonly Receipt[];
	branch(at: Capability, entryId: string): void;
}
export type HostEvent =
	| { readonly type: "receipt"; readonly receipt: Receipt }
	| { readonly type: "state"; readonly phase: View["phase"] };
export interface Host {
	connect(id: string, grants: readonly Grant[]): Client;
	view(): View;
	subscribe(listener: (event: HostEvent) => void): () => void;
	waitForIdle(): Promise<View>;
	reload(): Promise<void>;
	newSession(): Promise<void>;
	dispose(): Promise<void>;
}
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
	readonly [key: string]: JsonValue | undefined;
}
/** Identity-only capabilities. Copies, serialization and persisted tokens carry no authority. */
export type FrameBasis = object;
export type JobScope = object;
export type ToolInvocationScope = object;
export type ArtifactScope = FrameBasis | JobScope;
export interface MessageDTO extends JsonObject {
	readonly role: string;
}
export interface RawEntryDTO {
	readonly id: string;
	readonly parentId: string | null;
	readonly type: string;
	readonly raw: JsonObject;
}
export interface ProjectedEntryDTO {
	readonly sourceEntryId: string;
	readonly messages: readonly MessageDTO[];
	readonly boundary: "system" | "host-summary" | null;
	readonly excluded: boolean;
	/** SHA-256 of exact source, effective messages and relevant edit identities. Not a capability. */
	readonly fingerprint: string;
}
export interface ModelDTO {
	readonly key: string;
	readonly model: string;
	readonly name: string;
	readonly reasoning: boolean;
	readonly contextWindow: number;
	readonly maxOutputTokens: number;
	readonly available: boolean;
}
export interface UsageDTO {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly totalTokens: number;
	/** null when bootstrap has not supplied authoritative pricing. */
	readonly cost: number | null;
}
export interface ArtifactSnapshot {
	readonly version: number;
	readonly records: readonly JsonValue[];
}
export interface ContextFrame {
	readonly durableSessionId?: string;
	readonly conversationId?: string;
	readonly providerSessionId?: string;
	readonly basis: FrameBasis;
	readonly strategyId: string;
	readonly leaseId: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly leafId: string | null;
	readonly generation: number;
	readonly navigationId: string;
	readonly requestId: string | null;
	readonly entries: readonly RawEntryDTO[];
	readonly activeEntryIds: readonly string[];
	readonly projection: readonly ProjectedEntryDTO[];
	readonly model: ModelDTO;
	readonly usage: UsageDTO;
	readonly artifacts: ArtifactSnapshot;
}
export interface EntryMessagePatch {
	readonly sourceEntryId: string;
	readonly messageIndex: number;
	/** Only content changes. Native tool call IDs/names/arguments and non-text payloads stay exact. */
	readonly content: string | readonly JsonObject[];
}
export interface BashExecutionRenderPatch {
	/** Request-only display of an already-recorded execution, never an execution request. */
	readonly kind: "bashExecution";
	readonly sourceEntryId: string;
	readonly messageIndex: number;
	/** Exactly the fields consumed by Pi's public bashExecutionToText conversion. */
	readonly command: string;
	readonly output: string;
	readonly cancelled: boolean;
	readonly truncated: boolean;
	readonly fullOutputPath: string | null;
	readonly exitCode: number | null;
}
export interface SummaryRangeReplacement {
	readonly sourceEntryIds: readonly string[];
	/** null omits the complete checked range without emitting a replacement message. */
	readonly summary: string | null;
	/** Include when this summary was produced by a source-authorized job. Checked on every application. */
	readonly jobScope?: JobScope;
}
export type ProjectionPlan =
	| { readonly status: "disabled"; readonly basis: FrameBasis }
	| { readonly status: "blocked"; readonly basis: FrameBasis; readonly reason: string }
	| {
			readonly status: "apply";
			readonly basis: FrameBasis;
			readonly patches?: readonly EntryMessagePatch[];
			readonly renderPatches?: readonly BashExecutionRenderPatch[];
			readonly replacements?: readonly SummaryRangeReplacement[];
	  };
export type Projector = (
	frame: ContextFrame,
	signal?: AbortSignal,
) => ProjectionPlan | Promise<ProjectionPlan>;
export type ArtifactReceipt =
	| {
			readonly status: "committed";
			readonly version: number;
			readonly transactionId: string;
			readonly journalPath: string;
	  }
	| { readonly status: "conflict"; readonly version: number }
	| { readonly status: "unknown"; readonly reason: string };
export interface StrategyArtifacts {
	read(scope: ArtifactScope): ArtifactSnapshot;
	append(
		scope: ArtifactScope,
		batch: {
			readonly expectedVersion: number;
			readonly records: readonly JsonValue[];
			readonly attemptIds?: readonly string[];
		},
	): ArtifactReceipt;
}
export interface SourceJobSpec {
	readonly planId: string;
	readonly targetEntryIds: readonly string[];
	readonly contextEntryIds?: readonly string[];
	readonly maxCalls: number;
	/** Compression jobs require an exact post-write adoption receipt before their artifact intent is cleared. */
	readonly requireArtifactReceipt?: boolean;
}
export interface InferenceRequest {
	readonly modelKey: string;
	readonly systemPrompt?: string;
	readonly prompt: string;
	/** 0 means no extra caller cap; finite host and model limits still apply. */
	readonly maxOutputTokens?: number;
	readonly thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}
export interface InferenceResult {
	readonly status: "completed" | "failed" | "quarantined";
	readonly attemptId: string;
	readonly modelKey: string;
	readonly text?: string;
	readonly reason?: string;
	readonly usageStatus: "known" | "unknown";
	readonly usage?: UsageDTO;
}
export interface InferenceAudit extends InferenceResult {
	readonly jobId: string;
	readonly planId: string;
	readonly maxOutputTokens: number;
}
export interface SourceJob {
	readonly id: string;
	readonly scope: JobScope;
	readonly signal: AbortSignal;
	check(): void;
	infer(request: InferenceRequest): Promise<InferenceResult>;
	cancel(reason?: string): void;
}
export interface StrategyLifecycleEvent {
	readonly phase: View["phase"];
	readonly reason: "reload" | "newSession" | "navigation" | "deactivated" | "disposed" | "failed";
	readonly generation: number;
	readonly sessionId: string;
}
export interface StrategyBinding {
	readonly id: string;
	readFrame(invocation?: ToolInvocationScope): ContextFrame;
	installProjector(projector: Projector): () => void;
	readonly artifacts: StrategyArtifacts;
	models(): readonly ModelDTO[];
	createJob(basis: FrameBasis, spec: SourceJobSpec): SourceJob;
	audit(): readonly InferenceAudit[];
	subscribe(listener: (event: StrategyLifecycleEvent) => void): () => void;
}
/** Bootstrap-only definitions. Never supplied to a strategy. This slice supports OpenAI completions. */
export interface InferenceModelDefinition {
	readonly key: string;
	readonly model: string;
	readonly name?: string;
	readonly endpoint: string;
	readonly apiKey: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly reasoning?: boolean;
	readonly contextWindow: number;
	readonly maxTokens: number;
}
export interface InferencePolicy {
	readonly strategyId: string;
	readonly modelKeys: readonly string[];
	/** Durable lifetime limit per strategy+Session, including failed/unknown sent calls. Managed multi-Conversation runtimes enforce this through the Session aggregate; legacy Host has one Conversation. */
	readonly maxCalls: number;
	readonly maxJobCalls: number;
	readonly maxOutputTokens: number;
	readonly timeoutMs: number;
}
export interface RuntimeLimits {
	readonly maxConversations: number;
	/** Conservative, durable reservations; cancelled/unknown attempts are not refunded. */
	readonly maxPrimaryAttempts: number;
	readonly maxAuxiliaryAttempts: number;
}
export interface ConversationProfile {
	readonly id: string;
	readonly systemPrompt?: string;
	readonly tools?: HostOptions["tools"];
}
export interface JournalMigration {
	readonly id: string;
	readonly schemaVersion: 1;
	readonly sessionId: string;
	readonly conversationId: string;
	readonly sourceLength: number;
	readonly sourceSha256: string;
	readonly primaryAttempts: number;
	readonly auxiliaryAttempts: number;
	readonly journals: readonly {
		readonly strategyId: string;
		readonly kind: "records" | "inference";
		readonly namespace: string;
		readonly version: number;
		readonly prefixLength: number;
		readonly prefixSha256: string;
	}[];
}
export interface RuntimeOptions extends HostOptions {
	readonly limits: RuntimeLimits;
	/** Trusted UUID for create-once storage placement; an existing directory requires explicit reopen. */
	readonly reservedSessionId?: string;
	/** Additional bootstrap-approved profiles; default inherits HostOptions. */
	readonly profiles?: readonly ConversationProfile[];
	/** Opt-in mapping of a closed, provably single-Conversation legacy storage; never bulk import. */
	readonly migrateLegacy?: { readonly expectedSessionId: string; readonly expectedConversationId: string };
}
export interface ConversationRef {
	readonly key: string;
	readonly sessionId: string;
	readonly conversationId: string;
	readonly incarnation: string;
	readonly profile: string;
}
/** Bootstrap writes application display data; actor identity must be bound by the server, never the model. */
export interface DisplayWrite {
	readonly namespace: string;
	readonly actorId: string;
	readonly requestId: string;
	readonly kind: "card" | "chat";
	readonly text: string;
}
export interface DisplayReceipt {
	readonly ref: ConversationRef;
	readonly namespace: string;
	readonly actorId: string;
	readonly requestId: string;
	readonly entryId: string;
}
export interface TranscriptMessage {
	readonly role: "user" | "assistant" | "toolResult";
	readonly content: string | readonly JsonObject[];
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly isError?: boolean;
	readonly stopReason?: string;
}
export interface ConversationSnapshot {
	readonly ref: ConversationRef;
	/** Active committed transcript, at most the newest 256 entries. No raw native objects or configuration. */
	readonly entries: readonly {
		readonly id: string;
		readonly conversationId: string;
		readonly kind: string;
		readonly taskId?: string;
		readonly messages: readonly TranscriptMessage[];
		readonly display?: DisplayWrite;
	}[];
	readonly entriesTruncated: boolean;
	readonly live: {
		readonly busy: boolean;
		readonly message?: TranscriptMessage;
		readonly tools: readonly {
			readonly callId: string;
			readonly name: string;
			readonly status: "pending" | "running" | "done";
			readonly taskId?: string;
			readonly output?: string;
		}[];
	};
	readonly usage: UsageDTO;
}
export interface ConversationSpec {
	readonly key: string;
	readonly profile?: string;
}
export interface RuntimeView {
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly phase: "ready" | "failed" | "closed";
	readonly conversations: readonly ConversationRef[];
	readonly limits: RuntimeLimits;
	readonly budget: { readonly primaryAttempts: number; readonly auxiliaryAttempts: number };
	readonly journalMigration?: JournalMigration;
	readonly lastError?: string;
}
/** Bootstrap-owned catalog. Data never grants authority and commands never expose native handles. */
export interface CatalogOptions {
	readonly namespace: string;
	readonly maxDeliveries: number;
	readonly maxPending: number;
}
export type MemberLifetime = "persistent" | "temporary" | "task-bound" | "background";
export interface CatalogMember {
	readonly key: string;
	readonly ref: ConversationRef;
	readonly lifetime: MemberLifetime;
	readonly ownerTaskId?: string;
	readonly data: JsonObject;
}
export interface CatalogSnapshot {
	readonly version: number;
	readonly members: readonly CatalogMember[];
}
export interface CatalogEnroll extends ConversationSpec {
	readonly data: JsonObject;
	readonly lifetime?: MemberLifetime;
	readonly source?: ConversationRef;
	readonly invocation?: ToolInvocationScope;
	readonly fork?: { readonly source: ConversationRef; readonly entryId: string };
}
export interface CatalogDeliverySpec {
	readonly requestId: string;
	readonly principal: string;
	readonly source: ConversationRef | null;
	readonly target: ConversationRef;
	readonly text: string;
	readonly mode: InputMode;
}
export interface DeliveryReceipt {
	readonly id: string;
	readonly requestId: string;
	readonly principal: string;
	readonly source: ConversationRef | null;
	readonly target: ConversationRef;
	readonly status: "queued" | "placed" | "done" | "unanswered" | "unknown";
	readonly entryId?: string;
	readonly reason?: string;
}
export interface RuntimeCatalog {
	/** Recipient-only delivery metadata; no peer transcript or payload body. */
	received(ref: ConversationRef, check: () => void): Promise<readonly DeliveryReceipt[]>;
	checkInvocation(ref: ConversationRef, scope: ToolInvocationScope): void;
	snapshot(): Promise<CatalogSnapshot>;
	enroll(specs: readonly CatalogEnroll[], check: () => void): Promise<readonly CatalogMember[]>;
	update(key: string, data: JsonObject, expectedVersion: number, check: () => void): Promise<CatalogSnapshot>;
	updateMany(
		changes: readonly { readonly key: string; readonly data: JsonObject }[],
		expectedVersion: number,
		check: () => void,
	): Promise<CatalogSnapshot>;
	configure(ref: ConversationRef, profile: string, check: () => void): Promise<CatalogMember>;
	deliver(spec: CatalogDeliverySpec, check: () => void): Promise<DeliveryReceipt>;
	receipt(id: string, check: () => void): Promise<DeliveryReceipt>;
	wait(id: string, check: () => void, signal?: AbortSignal): Promise<DeliveryReceipt>;
	withdraw(id: string, check: () => void): Promise<DeliveryReceipt>;
	stop(ref: ConversationRef, check: () => void): Promise<void>;
	readiness(
		ref: ConversationRef,
	): Promise<{ readonly phase: "ready" | "failed" | "ended"; readonly reason?: string }>;
}
export interface RuntimeStoreOptions {
	readonly namespace: string;
	readonly maxBytes: number;
}
export interface RuntimeStoreSnapshot {
	readonly version: number;
	readonly data: JsonObject;
}
/** Bootstrap-only JSON coordinator state, not model authority or arbitrary native transactions. */
export interface RuntimeStore {
	snapshot(): Promise<RuntimeStoreSnapshot>;
	compareAndSet(expectedVersion: number, data: JsonObject, check: () => void): Promise<RuntimeStoreSnapshot>;
}
/** Trusted bootstrap/control plane, not an agent-facing permission grant. */
export interface Runtime {
	root(): Host;
	view(): RuntimeView;
	createConversation(spec: ConversationSpec): Promise<ConversationRef>;
	catalog(options: CatalogOptions): RuntimeCatalog;
	store(options: RuntimeStoreOptions): RuntimeStore;
	/** Passive scoped snapshot. The check runs before native acquisition and again before publishing. */
	readConversation(ref: ConversationRef, check: () => void): Promise<ConversationSnapshot>;
	/** Durable display-only record, never a model input; retries require an identical actor/request/payload. */
	writeDisplay(ref: ConversationRef, input: DisplayWrite, check: () => void): Promise<DisplayReceipt>;
	conversation(ref: ConversationRef): Promise<Host>;
	waitForIdle(): Promise<void>;
	close(): Promise<void>;
}
export interface HostOptions {
	backend?: "durable";
	cwd: string;
	dataDir: string;
	endpoint: string;
	model: string;
	apiKey: string;
	systemPrompt?: string;
	steeringMode?: "all" | "one-at-a-time";
	/** Explicit trusted reopen of a session created under this dataDir. Never falls back to new. */
	reopenSessionFile?: string;
	inference?: {
		readonly models: readonly InferenceModelDefinition[];
		readonly policies: readonly InferencePolicy[];
	};
	prepareInput?: (
		input: Readonly<{ principal: string; text: string; mode: InputMode }>,
	) => Promise<{ action: "handled" } | { action: "text"; text: string }>;
	tools?: readonly {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
		execute(
			args: Record<string, unknown>,
			signal: AbortSignal | undefined,
			scope: ToolInvocationScope,
		): Promise<string>;
	}[];
}
