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
}
export interface View {
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
export interface SummaryRangeReplacement {
	readonly sourceEntryIds: readonly string[];
	/** null omits the complete checked range without emitting a replacement message. */
	readonly summary: string | null;
	/** Include when this summary was produced by a source-authorized job. Checked on every application. */
	readonly jobScope?: JobScope;
}
export type ProjectionPlan =
	| { readonly status: "disabled"; readonly basis: FrameBasis }
	| {
			readonly status: "apply";
			readonly basis: FrameBasis;
			readonly patches?: readonly EntryMessagePatch[];
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
		batch: { readonly expectedVersion: number; readonly records: readonly JsonValue[] },
	): ArtifactReceipt;
}
export interface SourceJobSpec {
	readonly planId: string;
	readonly targetEntryIds: readonly string[];
	readonly contextEntryIds?: readonly string[];
	readonly maxCalls: number;
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
	/** Durable lifetime limit per strategy+session, including failed/unknown sent calls. */
	readonly maxCalls: number;
	readonly maxJobCalls: number;
	readonly maxOutputTokens: number;
	readonly timeoutMs: number;
}
export interface HostOptions {
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
