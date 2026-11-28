# Strategy Control API

This is the generic headless `@pakka/agent` boundary for a reviewed strategy. It does not implement Dynamite numbering, window selection, compression quality, fallback order or record schemas. Import only the package root. The value exports include `createHost`, trusted `createRuntime` and `createCompresserSession` bootstrap factories, and the trusted `recoverStorageWriter` maintenance command; all declarations below are type exports from `packages/agent/src/types.ts` through `src/index.ts`.

## Authority And Frames

The composition root holds `Host`, bootstrap endpoints and credentials. It connects a principal with explicit grants, activates a strategy, and hands that strategy its frozen `StrategyBinding`, not the host or a mutable Pi object. Hook ownership is exclusive and precise: `context_artifacts.write` does not authorize projection; `model.infer` separately authorizes auxiliary spending.

`readFrame()` returns one frozen snapshot with raw IDs/parentage, active branch IDs, effective entry/message provenance, system/host-summary boundaries, excluded messages, model metadata, accumulated main-run usage and the strategy/session artifact version. `basis`, job scopes and tool invocation scopes are identity-only capabilities backed by host WeakMaps. Copies and serialized tokens have no authority. A frame basis expires on canonical frame or artifact-version change as well as lifecycle/lease changes. It is not a legacy tree revision.

Source jobs instead bind exact effective target and previous-context fingerprints. Normal unrelated tail growth is allowed. Source/context edits, navigation (including ABA), generation changes, lease revocation, cancellation and unknown storage abort/reject the job. Each explicit `infer()` attempt, provider pre-dispatch callback, completion, scoped artifact operation and job-backed range application checks this authority. The host does not choose or automatically retry/fallback models.

## Native Compresser Service

Trusted bootstrap creates `createCompresserSession({ storageDir, toolCallingTolerance, unresolvedErrorTolerance })`; both tolerances are explicit positive safe integers. Its frozen facade exposes `snapshot(): Promise<CompresserSnapshot>` and idempotent `close()`. Bootstrap can share this same facade through participating Hosts' `inference.compresserSession`. The adapter owns the native Session/storage writer; a copied, forged or closed facade supplies no authority. In source metadata, an empty sourceConversationId denotes the standalone Host root context; managed Conversations carry their explicit ID.

The bootstrap snapshot may contain diagnostics from several sources and must not be exposed as a conversation-scoped endpoint. CompresserSnapshot.conversations[] contains each child's sealed, toolErrors, unresolvedErrors and lastError. Root lastError describes only a genuine shared-container fault; model errors have no root aggregate counter. Shared-fault refusals remain generic to sources, while own diagnostics stay in their audit and trusted row.

A source job can explicitly call `converse(request, validateCall?)` with a declared output tool. The optional synchronous `InferenceCallValidator` receives a frozen call DTO and returns a diagnostic string or `undefined`; it receives no native handles. A job selects either primitive infer or conversational inference. Same live job/request admission shares one operation; native repair preserves the originating source and transcript rather than rebuilding prompts.

Each native request separately passes the source checks and finite auxiliary budgets and receives a reservation/completion audit. Tool failures require complete matched replacements. Incomplete stops and provider errors admit bounded native steering; each Conversation independently accumulates incidents and seals only itself at its exact count. A sibling's seal neither rejects in-flight results nor revokes an exact returned candidate's adoption receipt. Per-job hard limits, cancellation and revocation remain terminal host conditions.

A final `InferenceResult.compresser` identifies the internal Session/Conversation, all attempt IDs, `reportedUsage` summed from actual reports, and whether every attempt is known. The ordinary result's `attemptId` remains the final exact artifact-adoption receipt. Native submission failure is not the whole source-job result. Candidate adoption checks its own source job/Conversation seal and current authority, not sibling error counts.

Normal reopen retains policy and completed job metadata. Unconfirmed work is quarantined in its own child and stopped before unrelated authorized work can run. Source-local audit uncertainty retains that source's pending reservation; genuine Compresser storage uncertainty closes the shared storage boundary. Schema-v2 storage rejects implicit migration of unattributed aggregate policy. Writer claims are resolved only by explicit trusted recovery; persisted jobs are not refreshed source capabilities. See [current lifecycle state](../state/compressor-session.md), [Conversation-isolated verification](../verification/COMPRESSOR-CONVERSATION-ISOLATION.md), and `packages/agent/test/compresser-session.test.ts`.

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
	await job.prepare();
	const result = await job.infer({
		modelKey: "summary",
		prompt: JSON.stringify(target.messages),
		maxOutputTokens: 64,
		thinkingLevel: "off",
	});
	if (result.status !== "completed" || !result.text) throw new Error(result.reason ?? "No usable summary");
	job.check();
	const receipt = await binding.artifacts.append(job.scope, {
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

An intentional policy refusal returns `{ status: "blocked", basis: frame.basis, reason: "policy denied" }` with no patch/replacement fields. The exact live basis is still required. The version-pinned downstream Durable build settles generation as blocked without an assistant error entry or task fault. After `waitForIdle()`, the input receipt remains `state: "committed"` and gains `generation: { status: "blocked", reason }`; provider calls stay zero and the Host remains ready. Returning block does not undo an admitted input or replay its key. Invalid protocol is still a host failure. This contract is provided by [the downstream source patch](../../patches/pi-durable/1.4.0-pakka.2/README.md), not unmodified upstream 1.4.0.

## Tools And Lifecycle

`HostOptions.tools[].execute(args, signal, invocation)` gets a run-bound scope. A strategy tool adapter must call `binding.readFrame(invocation)` and pass the resulting basis/scope to writes. Existing callbacks accepting only `args`/`signal` remain assignable. The host also preserves invocation authority through async-local context, so an old tool cannot omit the argument to get a new-session frame after an await. An invocation expires when the callback ends or lifecycle identity changes.

`binding.subscribe()` reports transitioning/ready for reload/newSession, and navigation/deactivation/disposed/failed notifications. Generation is revoked before lifecycle awaits. On a fresh ready event, read a new frame and reconstruct plans from validated records; old frames/jobs are not refreshed. Installed projector callbacks survive reload idempotently while the strategy lease remains active, but any captured job scopes must be replaced. Deactivation removes the projector and invalidates the binding. Abort is best effort for sent calls and does not prove zero cost.

Root startup may set `reopenSessionFile` to the Pakka-owned `main.sqlite` beneath the same dataDir. Reopen checks the SQLite application identity through a read-only connection, the backend/schema descriptor, integrity and Pakka provenance before enabling the writer. Missing, corrupt or foreign requested storage rejects rather than creating a replacement Session. Reopen preserves storage, entry and scoped-record identities while acquiring fresh operation authority.

## Persistence, Inference And Limits

Artifact operations require a valid frame or job scope and the correct strategy/Session namespace. `append()` returns `Promise<ArtifactReceipt>` and resolves only after the public Pi transaction and exact receipt readback. SQLite stores immutable batch documents, a versioned namespace head and stable transaction receipts. Artifact records, adoption and the work checkpoint share one Session commit. A caller can fix `transactionId` and use `receipt(scope, transactionId)` to confirm the original committed write; the same identity with different content is rejected. Absence of a receipt is not proof that an external effect did not occur. Storage failures seal their Session; a failure from an old Session does not poison an explicitly created fresh Session.

Each auxiliary attempt reserves a durable budget slot before dispatch. Limits are finite per job and per strategy/session, including failed or unknown attempts; reload, deactivation/re-activation and process reopen do not reset spent slots. Requests use public Pi `Models.completeSimple`, actual `maxTokens` options and a capped per-request model, with provider transport retry disabled. Caller cap `0` means no extra caller cap, never unlimited spending. The effective cap is the minimum of model, host policy and any positive caller cap. All summary endpoints/auth/headers stay in `durable-adapter.ts`; strategies see only their allowlisted sanitized models. The configured auxiliary transport uses OpenAI completions.

For inference-derived persisted candidates, create the job with `requireArtifactReceipt: true` and include its exact completed `attemptIds` in the awaited artifact append. Before staging writes, the host validates unique IDs and the job/plan/Session/strategy/principal/lease reservation and completion. The batch, adoption receipt and optional `checkpoint` are committed atomically. Already adopted, nonexistent, foreign or unfinished attempts are rejected without effects. A `ready` checkpoint records the confirmed next attempt and optional absolute retry time; `finished` removes the work from active scheduling. Reopen verifies adoption against its original transaction. Failed and quarantined attempts retain usage and reservations. These are local transaction and recovery guarantees, not exactly-once model transport.

An optional `outputTool: { name, description, parameters }` declares a result channel on the same single inference request. The declaration uses an object JSON Schema and a bounded name/description/serialized size; it supplies no executable callback. The public Pi stream must expose complete JSON argument deltas that parse strictly and exactly match its final argument DTO; missing, repaired, oversized or mismatched bytes fail closed. Exactly one complete matching `toolUse` call with schema-valid arguments returns `toolCall: { id, name, arguments }` instead of text. Prose-only, wrong/multiple calls, implicit argument coercion, invalid parameters and truncation fail with measured usage retained. Arguments are bounded to 256 KiB JSON and returned as detached frozen DTOs. The strategy validates its own domain references and adopts candidates through the existing exact attempt receipt; the host executes no returned tool. Absence of outputTool preserves text completion behavior.

Auxiliary messages/results never use `Client.submit`, never append to the main transcript, and create no main-input admission receipt. Audit includes reserved attempts without a completion as quarantined/unknown; completed failed/quarantined calls remain observable when storage is readable. A failed call without usage is not zero billing. `usage.cost` is `null` for unpriced configured models. Unknown storage throws or returns an unknown artifact receipt; it is not an inference failure to retry. Do not retry/fallback after revocation, cancellation or unknown storage.

The component exposes approved strategy, projection and inference ports. Native steering/follow-up retain their Durable timing. Strategy code receives frozen DTOs and identity-bound commands; the configured auxiliary transport uses OpenAI completions.

## Persisted Source Work

`SourceJobSpec.metadata` is a finite JSON description of fixed domain configuration and read-set identities. It grants no authority. `await job.prepare()` confirms the immutable plan before external work. Budget reservation, request digest, result digest, sealed result and checkpoint persist through public Pi documents; a planning proof binds the fixed fields to the append-only journal.

`binding.pendingWork()` returns frozen `SourceWorkSnapshot[]` with stable address/job/plan IDs, stage, checkpoint, retry time, source IDs, metadata, attempt IDs and retained budget. `await binding.restoreJob(jobId)` validates current grants and the original source versions. `binding.readWorkFrame(restored.scope)` reads that fixed authorized source set. Old scopes and serialized tokens do not become live again.

A planned job can dispatch its first request after reauthorization. A confirmed failed attempt continues only from its stored ready checkpoint and original finite allowance. A sealed result resumes local validation/adoption with the original request digest and no new reservation. A reserved or otherwise unknown request remains blocked pending effect reconciliation. The Compresser/source completion gap is reconciled only against the original internal Session/Conversation, complete candidate, attempt identities and request digest; recovery does not replay its HTTP.

Lifecycle transitions revoke new work first. They allow only settlement/quarantine of already-started attempts, await that settlement, then close storage. Explicit reload also revalidates the persisted document chain through a consistent public Storage snapshot. Daily history refresh uses ascending 256-entry pages after the last confirmed immutable ID; a new Conversation or explicit reload resets that read cursor. `ContextFrame` still materializes the current Conversation's raw history and effective projection for numbering and provenance.

## Trusted Writer Maintenance

`recoverStorageWriter({ storageDir, expectedClaim: { pid, nonce } })` is a bootstrap-only command for a closed/killed writer. It acquires an exclusive maintenance gate, checks database identity read-only, refuses a live or unconfirmable process, and rechecks the exact claim before releasing it. It returns a frozen `WriterRecoveryReceipt`; it does not open a model or alter database/WAL content. Normal opens still refuse residual claims. A failed or unknown close retains its claim. Product operators use `pakka recover writer`; no-Harness coordinator inspection and snapshots use [offline maintenance](RUNTIME-API.md#离线存储维护). Restoring a verified backup may preserve a damaged original and its confirmed-dead claim as raw evidence without invoking writer release or claiming database health.

## Exported Declaration Sources

The authoritative declarations are exported by [the package root](../../packages/agent/src/index.ts) from [types.ts](../../packages/agent/src/types.ts). Installed declaration checks are available through `npm run smoke:package`.

| Surface                                      | Declaration                                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frames and projection authority              | `ContextFrame`, `FrameBasis`, `JobScope`, `ToolInvocationScope`, `ProjectionPlan`                                                                              |
| Durable artifact submission and confirmation | `ArtifactSnapshot`, `ArtifactReceipt`, `StrategyArtifacts`, `SourceWorkCheckpoint`                                                                             |
| Planned work, inference and recovery         | `SourceJobSpec`, `SourceJob`, `SourceWorkSnapshot`, `InferenceRequest`, `InferenceResult`, `StrategyBinding`                                                   |
| Native Compresser facade and diagnostics     | `CompresserSession`, `CompresserSnapshot`, `InferenceCallValidator`                                                                                            |
| Trusted lifecycle and storage maintenance    | `HostOptions`, `RuntimeOptions`, `WriterRecoveryOptions`, `WriterRecoveryReceipt`, `StorageMaintenanceOptions`, `StorageMaintenance`, `StorageMaintenanceWork` |
