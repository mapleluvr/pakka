# Strategy Control API

This is the generic headless `@pakka/agent` boundary for a reviewed strategy. It does not implement Dynamite numbering, window selection, compression quality, fallback order or record schemas. Import only the package root. The only value export is `createHost`; all declarations below are type exports from `packages/agent/src/types.ts` through `src/index.ts`.

## Authority And Frames

The composition root holds `Host`, bootstrap endpoints and credentials. It connects a principal with explicit grants, activates a strategy, and hands that strategy its frozen `StrategyBinding`, not the host or a mutable Pi object. Hook ownership is exclusive and precise: `context_artifacts.write` does not authorize projection; `model.infer` separately authorizes auxiliary spending.

`readFrame()` returns one frozen snapshot with raw IDs/parentage, active branch IDs, effective entry/message provenance, system/host-summary boundaries, excluded messages, model metadata, accumulated main-run usage and the strategy/session artifact version. `basis`, job scopes and tool invocation scopes are identity-only capabilities backed by host WeakMaps. Copies and serialized tokens have no authority. A frame basis expires on canonical frame or artifact-version change as well as lifecycle/lease changes. It is not a legacy tree revision.

Source jobs instead bind exact effective target and previous-context fingerprints. Normal unrelated tail growth is allowed. Source/context edits, navigation (including ABA), generation changes, lease revocation, cancellation and unknown storage abort/reject the job. Each explicit `infer()` attempt, provider pre-dispatch callback, completion, scoped artifact operation and job-backed range application checks this authority. The host does not choose or automatically retry/fallback models.

## Minimal Usage

This example assumes an OpenAI-completions-compatible local provider is already listening on port 1234. The runnable isolated counterpart is `npm run smoke:package` and `scripts/consumer-smoke.mjs`.

```ts
import { createHost, type StrategyBinding } from "@pakka/agent";

const host = await createHost({
	cwd: process.cwd(),
	dataDir: "/absolute/path/to/project/.pakka",
	endpoint: "http://127.0.0.1:1234/v1",
	model: "main-local",
	apiKey: "local-only",
	inference: {
		models: [
			{
				key: "summary",
				model: "summary-local",
				endpoint: "http://127.0.0.1:1234/v1",
				apiKey: "local-only",
				contextWindow: 8192,
				maxTokens: 512,
			},
		],
		policies: [
			{
				strategyId: "working-set",
				modelKeys: ["summary"],
				maxCalls: 4,
				maxJobCalls: 2,
				maxOutputTokens: 256,
				timeoutMs: 5000,
			},
		],
	},
});
try {
	const user = host.connect("ui", ["input.submit"]);
	const owner = host.connect("strategy", ["real_context.write", "context_artifacts.write", "model.infer"]);
	owner.activateStrategy({ id: "working-set", hooks: ["real_context.write", "context_artifacts.write"] });
	const binding: StrategyBinding = owner.bindStrategy("working-set");
	await user.submit({ key: "first", text: "A local source to summarize." });
	await host.waitForIdle();
	const frame = binding.readFrame();
	const target = frame.projection.find(
		(entry) =>
			!entry.boundary && !entry.excluded && entry.messages.some((message) => message.role === "user"),
	)!;
	const job = binding.createJob(frame.basis, {
		planId: "example-window",
		targetEntryIds: [target.sourceEntryId],
		contextEntryIds: [],
		maxCalls: 2,
		requireArtifactReceipt: true,
	});
	const result = await job.infer({
		modelKey: "summary",
		prompt: JSON.stringify(target.messages),
		maxOutputTokens: 64,
		thinkingLevel: "off",
	});
	if (result.status !== "completed" || !result.text) throw new Error(result.reason ?? "No usable summary");
	job.check();
	const receipt = binding.artifacts.append(job.scope, {
		expectedVersion: frame.artifacts.version,
		attemptIds: [result.attemptId],
		records: [
			{
				kind: "example-summary",
				sourceEntryId: target.sourceEntryId,
				fingerprint: target.fingerprint,
				summary: result.text,
			},
		],
	});
	if (receipt.status !== "committed") throw new Error("Artifact outcome: " + receipt.status);
	const summary = result.text;
	const remove = binding.installProjector((request) => ({
		status: "apply",
		basis: request.basis,
		replacements: [{ sourceEntryIds: [target.sourceEntryId], summary, jobScope: job.scope }],
	}));
	await user.submit({ key: "second", text: "Continue from the summary." });
	await host.waitForIdle();
	if (host.view().phase !== "ready") throw new Error(host.view().lastError);
	console.log(binding.audit());
	remove();
} finally {
	await host.dispose();
}
```

For a reduction without inference, return `patches` instead of a replacement. A patch addresses `sourceEntryId` and `messageIndex` and supplies only `content`; every other message field remains host-owned. Preserve native `toolCall` blocks and non-text payloads exactly. Tool call IDs/names/arguments cannot change; stale `thoughtSignature` may be removed. `assistant` and `toolResult` content remains block-structured. System, host-summary and excluded entry patch targets are rejected.

For an already-recorded, non-excluded bash execution, a discriminated `renderPatches` item may change only command/output/cancelled/truncated/fullOutputPath/exitCode as read by public Pi request conversion. These are display fields on a request-local clone: no command is executed and canonical execution records never change. Unknown fields/roles, excluded entries, checkpoints, duplicate patches and copied/stale bases are rejected before HTTP. See `strategy-rendering.test.ts` for wire and raw-record regressions.

A range replacement names a contiguous ordered visible source range, never a system/host-summary checkpoint or one half of a native call/result pair. A nonempty string emits a summary; `summary: null` explicitly omits the complete range without any replacement message or placeholder. Empty or whitespace-only strings remain malformed. This lets a strategy reduce an existing request-local summary without resurrecting the underlying source. Include the job's opaque `jobScope` for every inference-derived replacement or omission so later source edits cannot activate an obsolete candidate. Checkpoints between a valid native call/result pair are retained. The host owns the generic summary wrapper; it does not parse strategy marker syntax.

If a projector appends its own trigger records, re-read the frame before returning: `const current = binding.readFrame(); return {status: "apply", basis: current.basis, ...};`. The fresh basis is tied to the same live request. Returning the old basis is rejected, not silently rebased. A no-change projector returns `{status: "disabled", basis: frame.basis}` explicitly. Throwing, malformed plans, copied/stale bases, wrong owners, invalid protocol and unknown active storage fail closed before HTTP. A synchronous returned plan is snapshotted before later caller mutation.

An intentional policy refusal returns `{ status: "blocked", basis: frame.basis, reason: "policy denied" }` with no patch/replacement fields. The exact live basis is still required. The version-pinned downstream Durable build settles generation as blocked without an assistant error entry or task fault. After `waitForIdle()`, the input receipt remains `state: "committed"` and gains `generation: { status: "blocked", reason }`; provider calls stay zero and the Host remains ready. Returning block does not undo an admitted input or replay its key. Invalid protocol is still a host failure. This contract is provided by [the downstream source patch](../patches/pi-durable/1.0.3-pakka.1/README.md), not unmodified upstream 1.0.3.

## Tools And Lifecycle

`HostOptions.tools[].execute(args, signal, invocation)` gets a run-bound scope. A strategy tool adapter must call `binding.readFrame(invocation)` and pass the resulting basis/scope to writes. Existing callbacks accepting only `args`/`signal` remain assignable. The host also preserves invocation authority through async-local context, so an old tool cannot omit the argument to get a new-session frame after an await. An invocation expires when the callback ends or lifecycle identity changes.

`binding.subscribe()` reports transitioning/ready for reload/newSession, and navigation/deactivation/disposed/failed notifications. Generation is revoked before lifecycle awaits. On a fresh ready event, read a new frame and reconstruct plans from validated records; old frames/jobs are not refreshed. Installed projector callbacks survive reload idempotently while the strategy lease remains active, but any captured job scopes must be replaced. Deactivation removes the projector and invalidates the binding. Abort is best effort for sent calls and does not prove zero cost.

Root startup may set `reopenSessionFile` to a Pakka-owned file beneath the same dataDir's sessions directory. Reopen checks the physical header, parentage and Pakka provenance marker; missing/corrupt/foreign requested storage rejects rather than creating a replacement session. Reopen preserves raw session/entry identity and scoped records, not old operation tokens, clients, hook leases or C2 idempotency claims. No bulk Pi/Kappa import or C2 crash recovery is implied.

## Persistence, Inference And Limits

Artifact operations require a valid frame or job scope and the correct strategy/session namespace. Batch receipts distinguish version conflict, committed physical readback and unknown storage. Each JSONL transaction has a version and SHA-256 chain; files are fsynced and read back. A separate ownership marker detects missing files/directories across reopen. Partial, changed or unreadable storage latches host failure. A same-session audit fault arriving during reload remains latched when reload settles; faults are attributed to their original session, so explicit newSession recovery is not poisoned by an old-session completion. This is single-writer evidence, not a multi-process transaction or a complete crash-proof directory protocol.

Each auxiliary attempt reserves a durable budget slot before dispatch. Limits are finite per job and per strategy/session, including failed or unknown attempts; reload, deactivation/re-activation and process reopen do not reset spent slots. Requests use public Pi `Models.completeSimple`, actual `maxTokens` options and a capped per-request model, with provider transport retry disabled. Caller cap `0` means no extra caller cap, never unlimited spending. The effective cap is the minimum of model, host policy and any positive caller cap. All summary endpoints/auth/headers stay in `durable-adapter.ts`; strategies see only their allowlisted sanitized models. This slice supports OpenAI completions, not every Pi provider API.

For inference-derived persisted candidates, create the job with `requireArtifactReceipt: true` and include the exact completed `attemptIds` in its scoped artifact append. Before any artifact intent or bytes are written, the host validates unique nonempty IDs, the job/plan/session/strategy/principal/lease reservation and its completion. Already adopted, nonexistent, foreign or unfinished attempts are rejected without effects. After physical artifact receipt, an adoption record binds the attempt to that exact transaction ID/version. Missing or uncertain receipts block same-session reconstruction; cancellation and unrelated progress writes do not settle a completed result. Reopen checks every adopted transaction against the physical artifact journal, including earlier versions followed by later ordinary appends. Failed/quarantined attempts retain their audit and bounded retry behavior. Dynamite opts compression jobs into this protocol; fresh jobs used only to authorize existing summaries do not reserve new inference. These receipts remain part of the bounded single-writer contract, not a general exactly-once model-call guarantee.

Auxiliary messages/results never use `Client.submit`, never append to the main transcript, and create no main C2 receipt. Audit includes reserved attempts without a completion as quarantined/unknown; completed failed/quarantined calls remain observable when storage is readable. A failed call without usage is not zero billing. `usage.cost` is `null` for unpriced configured models. Unknown storage throws or returns an unknown artifact receipt; it is not an inference failure to retry. Do not retry/fallback after revocation, cancellation or unknown storage.

There is no native Pi extension discovery, OS sandbox, full TUI/CLI, fsynced C2 ledger, arbitrary provider compatibility, runtime model-policy mutation, Dynamite algorithm or default-strategy integration in this component. Main native steering/follow-up and the original 22 C2/permission/lifecycle tests are preserved.

## Exact Exported Declarations

The following block is copied verbatim from `packages/agent/src/types.ts`; the package root exports every declaration. `createHost(options: HostOptions): Promise<Host>` is exported from `src/host.ts`. The installed tarball declaration smoke exercises the binding/frame/plan/artifact/job/tool types without ancestor workspace dependencies.

```ts
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
	/** Durable lifetime limit per strategy+session, including failed/unknown sent calls. */
	readonly maxCalls: number;
	readonly maxJobCalls: number;
	readonly maxOutputTokens: number;
	readonly timeoutMs: number;
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
```
