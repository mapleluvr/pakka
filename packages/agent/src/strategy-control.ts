import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { ArtifactJournal, copy, freeze, hash, json, type ArtifactIntent } from "./artifact-journal.ts";
import { NativeJournal, type JournalStorage } from "./native-journal.ts";
import { sourceWorkPlan, type StoredSourceWork, type SourceWorkMutation } from "./source-work.ts";
type Journal = ArtifactJournal | NativeJournal;
class AwaitingWorkAdoption extends Error {}
import { applyProjection } from "./strategy-projection.ts";
import type { AdapterFrame, RunScopeToken, GovernedConversation } from "./durable-adapter.ts";
import type {
	ArtifactScope,
	ContextFrame,
	FrameBasis,
	Grant,
	Hook,
	InferenceAudit,
	InferenceCallValidator,
	InferencePolicy,
	InferenceRequest,
	InferenceResult,
	JsonObject,
	JsonValue,
	ModelDTO,
	Projector,
	ProjectionPlan,
	SourceJob,
	SourceJobSpec,
	SourceWorkSnapshot,
	SourceWorkCheckpoint,
	StrategyBinding,
	StrategyLifecycleEvent,
	ToolInvocationScope,
} from "./types.ts";

type Identity = {
	sessionId: string;
	durableSessionId?: string;
	conversationId?: string;
	generation: number;
	navigationId: string;
};
export interface StrategyLease {
	principal: string;
	hooks: readonly Hook[];
	leaseId: string;
}
interface Ports {
	ready(): void;
	phase(): StrategyLifecycleEvent["phase"];
	identity(): Identity;
	lease(id: string): StrategyLease | undefined;
	owner(hook: Hook): string | undefined;
	frame(): AdapterFrame;
	fail(reason: string, sessionId?: string): void;
	storageUnknown(reason: string, sessionId: string): void;
	models(): readonly ModelDTO[];
	journalStorage?(): JournalStorage | undefined;
	checkCompresser?(jobId: string): void;
	recoverConverse?(
		source: GovernedConversation["source"],
		request: InferenceRequest,
	): Promise<InferenceResult>;
	converse?(
		input: Omit<GovernedConversation, "reserve">,
		strategy: { strategyId: string; maxCalls: number },
	): Promise<InferenceResult>;
	infer(
		request: InferenceRequest,
		cap: number,
		signal: AbortSignal,
		timeoutMs: number,
		check: () => void,
		strategy: { strategyId: string; maxCalls: number },
	): Promise<Omit<InferenceResult, "attemptId">>;
}
type Authority = Identity & { strategyId: string; leaseId: string; principal: string };
type BasisRecord = Authority & {
	fingerprint: string;
	artifactVersion: number;
	requestId: string | null;
	frame: ContextFrame;
	invocation?: object;
	recovery?: boolean;
};
function isJsonObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Optional object fields are absent in the persisted result; arrays and all
 * present values still obey finite JSON. Public artifact input remains strict. */
function finiteInferenceResult(result: InferenceResult): InferenceResult {
	const normalize = (value: unknown): JsonValue => {
		if (Array.isArray(value)) return value.map(normalize);
		if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
			return Object.fromEntries(
				Object.entries(value)
					.filter(([, field]) => field !== undefined)
					.map(([key, field]) => [key, normalize(field)]),
			);
		}
		json(value);
		return value;
	};
	// SAFETY: the adapter constructs InferenceResult; normalization preserves its
	// required fields and present finite values, dropping only undefined object fields.
	return copy(normalize(result)) as unknown as InferenceResult;
}

type JobRecord = Authority & {
	id: string;
	scope: object;
	planId: string;
	sources: Map<string, string>;
	targets: readonly string[];
	maxCalls: number;
	calls: number;
	controller: AbortController;
	policy: InferencePolicy;
	journal: Journal;
	auditJournal: Journal;
	requireArtifactReceipt: boolean;
	originLeaseId: string;
	metadata: JsonValue;
	prepared?: Promise<void>;
	restored?: StoredSourceWork;
	recoveryOnly?: boolean;
	conversational?: boolean;
};

/** Expected invalidation before dispatch; distinct from a projector or storage fault. */
export class LifecycleTransitionRevoked extends Error {
	constructor() {
		super("Host is transitioning");
		this.name = "LifecycleTransitionRevoked";
	}
}

export class StrategyControl {
	#ports: Ports;
	#root: string;
	#policies: readonly InferencePolicy[];
	#basis = new WeakMap<FrameBasis, BasisRecord>();
	#jobsByScope = new WeakMap<object, JobRecord>();
	#jobs = new Set<JobRecord>();
	#settling = new Set<Promise<void>>();
	#projectors = new Map<string, { projector: Projector; leaseId: string }>();
	#journals = new Map<string, Journal>();
	#listeners = new Map<string, Set<(event: StrategyLifecycleEvent) => void>>();
	#runs = new WeakMap<object, Identity>();
	#invocations = new WeakMap<object, Identity & { active: boolean }>();
	#local = new AsyncLocalStorage<object>();
	#request: { id: string; strategyId: string } | undefined;
	#permitId: string | undefined;
	#namespaceVersion: 1 | 2;
	constructor(root: string, policies: readonly InferencePolicy[], ports: Ports, namespaceVersion: 1 | 2 = 1) {
		this.#namespaceVersion = namespaceVersion;
		this.#root = root;
		this.#policies = copy(policies);
		this.#ports = ports;
		const ids = new Set<string>();
		for (const p of policies) {
			if (
				!p.strategyId ||
				ids.has(p.strategyId) ||
				!p.modelKeys.length ||
				new Set(p.modelKeys).size !== p.modelKeys.length ||
				[p.maxCalls, p.maxJobCalls, p.maxOutputTokens, p.timeoutMs].some(
					(n) => !Number.isSafeInteger(n) || n <= 0,
				) ||
				p.maxJobCalls > p.maxCalls
			)
				throw new Error("Invalid finite inference policy");
			ids.add(p.strategyId);
		}
	}
	#sameIdentity(identity: Identity): boolean {
		const current = this.#ports.identity();
		return (
			identity.sessionId === current.sessionId &&
			identity.durableSessionId === current.durableSessionId &&
			identity.conversationId === current.conversationId &&
			identity.generation === current.generation &&
			identity.navigationId === current.navigationId
		);
	}
	#check(a: Authority): void {
		this.#ports.ready();
		const lease = this.#ports.lease(a.strategyId);
		if (!lease || lease.principal !== a.principal || lease.leaseId !== a.leaseId)
			throw new Error("Strategy inactive or lease changed");
		if (!this.#sameIdentity(a)) throw new Error("Stale lifecycle/navigation scope");
	}
	#authority(strategyId: string, principal: string, leaseId: string): Authority {
		const authority = { ...this.#ports.identity(), strategyId, principal, leaseId };
		this.#check(authority);
		return authority;
	}
	#journalFailure(sessionId: string): (reason: string) => void {
		return (reason) => this.#ports.storageUnknown(reason, sessionId);
	}
	#journal(authority: Authority, kind = "records"): Journal {
		const sessionId = authority.sessionId;
		if (
			this.#namespaceVersion === 2 &&
			(authority.conversationId === undefined || authority.durableSessionId === undefined)
		)
			throw new Error("Missing managed Conversation journal identity");
		const namespace =
			this.#namespaceVersion === 2
				? JSON.stringify([
						"pakka.conversation-journal.v2",
						authority.conversationId,
						authority.strategyId,
						kind,
					])
				: authority.strategyId + ":" + kind;
		const key = JSON.stringify([sessionId, namespace]);
		let journal = this.#journals.get(key);
		if (!journal) {
			const storage = this.#ports.journalStorage?.();
			journal = storage
				? new NativeJournal(storage, hash(key), (mutations) => {
						// A lifecycle transition refuses new work but may settle the existing
						// source attempt. The store still checks its exact reservation identity.
						const settlement =
							kind === "inference" &&
							["transitioning", "disposed"].includes(this.#ports.phase()) &&
							sessionId === this.#ports.identity().sessionId &&
							mutations.length === 1 &&
							mutations.every(
								(mutation) =>
									mutation.key === hash(key) &&
									mutation.records.length > 0 &&
									mutation.records.every(
										(row) => isJsonObject(row) && (row.kind === "completion" || row.kind === "work-result"),
									) &&
									(mutation.work?.length ?? 0) > 0 &&
									mutation.work?.every((work) => work.type === "result"),
							);
						if (!settlement) this.#ports.ready();
					})
				: new ArtifactJournal(this.#root, authority.sessionId, namespace, this.#journalFailure(sessionId));
			this.#journals.set(key, journal);
		}
		return journal;
	}
	#checkInvocation(scope: ToolInvocationScope): void {
		const invocation = this.#invocations.get(scope);
		if (!invocation?.active || !this.#sameIdentity(invocation))
			throw new Error("Invalid/stale tool invocation scope");
		this.#ports.ready();
	}
	checkInvocation(scope: ToolInvocationScope): void {
		this.#checkInvocation(scope);
	}
	runScope(): RunScopeToken {
		this.#ports.ready();
		const token = Object.freeze({});
		this.#runs.set(token, this.#ports.identity());
		return token;
	}
	async invoke<T>(run: RunScopeToken, callback: (scope: ToolInvocationScope) => Promise<T>): Promise<T> {
		const identity = this.#runs.get(run);
		if (!identity || !this.#sameIdentity(identity)) throw new Error("Stale tool run scope");
		this.#ports.ready();
		const token = Object.freeze({}),
			invocation = { ...identity, active: true };
		this.#invocations.set(token, invocation);
		try {
			return await this.#local.run(token, () => callback(token));
		} finally {
			invocation.active = false;
		}
	}
	#readFrame(
		strategyId: string,
		principal: string,
		leaseId: string,
		invocation?: ToolInvocationScope,
		recovery?: JobRecord,
	): ContextFrame {
		const local = this.#local.getStore();
		if (local) this.#checkInvocation(local);
		if (invocation) this.#checkInvocation(invocation);
		const authority = this.#authority(strategyId, principal, leaseId);
		const data = this.#ports.frame();
		let artifacts: ContextFrame["artifacts"];
		try {
			artifacts = this.#reconcileArtifact(authority);
			if (recovery) this.#checkJob(recovery);
			else this.#ensureInferenceSettled(authority);
		} catch (error) {
			if (error instanceof AwaitingWorkAdoption) throw error;
			this.#ports.storageUnknown("Artifact/adoption storage unknown: " + String(error), authority.sessionId);
			throw error;
		}
		const basis = Object.freeze({});
		const frame = freeze({
			...data,
			...authority,
			basis,
			cwd: data.cwd,
			leafId: data.leafId,
			requestId: this.#request?.strategyId === strategyId ? this.#request.id : null,
			artifacts,
		});
		this.#basis.set(basis, {
			...authority,
			fingerprint: hash(data),
			artifactVersion: artifacts.version,
			requestId: frame.requestId,
			frame,
			invocation: local ?? invocation,
			recovery: recovery !== undefined,
		});
		return frame;
	}
	#checkBasis(scope: FrameBasis, principal: string, strategyId: string, leaseId: string): BasisRecord {
		const record = this.#basis.get(scope);
		if (
			!record ||
			record.recovery ||
			record.principal !== principal ||
			record.strategyId !== strategyId ||
			record.leaseId !== leaseId
		)
			throw new Error("Invalid/copied frame basis scope");
		if (record.invocation) this.#checkInvocation(record.invocation);
		const local = this.#local.getStore();
		if (local) this.#checkInvocation(local);
		this.#check(record);
		if (
			record.fingerprint !== hash(this.#ports.frame()) ||
			record.artifactVersion !== this.#journal(record).read().version
		)
			throw new Error("Stale frame basis/source/artifact version");
		return record;
	}
	#checkJob(job: JobRecord): void {
		try {
			if (job.controller.signal.aborted)
				throw new Error("Job cancelled: " + String(job.controller.signal.reason));
			this.#check(job);
			job.journal.read();
			job.auditJournal.read();
			const projection = new Map(this.#ports.frame().projection.map((e) => [e.sourceEntryId, e]));
			for (const [id, fingerprint] of job.sources)
				if (projection.get(id)?.fingerprint !== fingerprint)
					throw new Error("Job source/previous-context changed");
		} catch (error) {
			this.#cancelJob(job, String(error));
			throw error;
		}
	}
	#cancelJob(job: JobRecord, reason: string): void {
		job.controller.abort(reason);
		this.#jobs.delete(job);
	}
	#scope(scope: ArtifactScope, principal: string, strategyId: string, leaseId: string): Authority {
		const job = this.#jobsByScope.get(scope);
		if (job) {
			if (job.principal !== principal || job.strategyId !== strategyId || job.leaseId !== leaseId)
				throw new Error("Invalid job scope");
			this.#checkJob(job);
			return job;
		}
		return this.#checkBasis(scope, principal, strategyId, leaseId);
	}
	#audit(authority: Authority): readonly InferenceAudit[] {
		const records = this.#journal(authority, "inference").read().records;
		// SAFETY: only host-generated reservations are written to the private inference namespace; read() verifies the physical hash chain.
		const reservations = records.filter(
			(r) =>
				r && typeof r === "object" && !Array.isArray(r) && (r as { kind?: string }).kind === "reservation",
		) as unknown as { attemptId: string; jobId: string; planId: string; modelKey: string; cap: number }[];
		const completed = new Map(
			records
				.filter(
					(r) =>
						r && typeof r === "object" && !Array.isArray(r) && (r as { kind?: string }).kind === "completion",
				)
				.map((r) => {
					const audit = (r as { audit: unknown }).audit as InferenceAudit;
					return [audit.attemptId, audit] as const;
				}),
		);
		return copy(
			reservations.map(
				(r) =>
					completed.get(r.attemptId) ?? {
						status: "quarantined",
						attemptId: r.attemptId,
						jobId: r.jobId,
						planId: r.planId,
						modelKey: r.modelKey,
						maxOutputTokens: r.cap,
						usageStatus: "unknown",
						reason: "Reserved attempt; completion/outcome unknown",
					},
			),
		);
	}
	#reconcileArtifact(authority: Authority): ReturnType<ArtifactJournal["read"]> {
		const journal = this.#journal(authority);
		const intent = journal.pendingIntent();
		if (intent) {
			const snapshot = journal.readPending();
			const records = this.#journal(authority, "inference").read().records;
			this.#assertAdoption(authority, intent, records);
			journal.settle(intent.transactionId, intent.version, intent.attemptIds);
			if (snapshot.version !== intent.version)
				throw new Error("Artifact transaction intent version mismatch");
		}
		return journal.read();
	}
	#assertAdoption(authority: Authority, intent: ArtifactIntent, records: readonly JsonValue[]): void {
		if (intent.attemptIds.length === 0)
			throw new Error("Artifact transaction intent has no inference attempt");
		for (const attemptId of intent.attemptIds) {
			const reservation = records.find(
				(record) =>
					isJsonObject(record) &&
					record.kind === "reservation" &&
					record.attemptId === attemptId &&
					record.requireArtifactReceipt === true &&
					record.sessionId === authority.sessionId &&
					record.strategyId === authority.strategyId &&
					record.principal === authority.principal,
			) as JsonObject | undefined;
			if (!reservation || typeof reservation.jobId !== "string")
				throw new Error("Artifact transaction intent has no matching inference reservation");
			const completion = records.find(
				(record) =>
					isJsonObject(record) &&
					record.kind === "completion" &&
					isJsonObject(record.audit) &&
					record.audit.attemptId === attemptId &&
					record.audit.jobId === reservation.jobId,
			) as JsonObject | undefined;
			const audit = completion && isJsonObject(completion.audit) ? completion.audit : undefined;
			if (
				!audit ||
				(audit.status !== "completed" && audit.status !== "failed" && audit.status !== "quarantined")
			)
				throw new Error("Artifact transaction intent has no matching inference completion");
			if (audit.status !== "completed") continue;
			const adopted = records.some(
				(record) =>
					isJsonObject(record) &&
					record.kind === "adoption" &&
					record.attemptId === attemptId &&
					record.jobId === reservation.jobId &&
					record.sessionId === authority.sessionId &&
					record.strategyId === authority.strategyId &&
					record.principal === authority.principal &&
					record.transactionId === intent.transactionId &&
					record.version === intent.version,
			);
			if (!adopted) throw new Error("Completed inference has no matching artifact adoption receipt");
		}
	}
	#ensureInferenceSettled(authority: Authority): void {
		const records = this.#journal(authority, "inference").read().records;
		const reservations = records.filter(
			(record): record is JsonObject =>
				isJsonObject(record) && record.kind === "reservation" && record.requireArtifactReceipt === true,
		);
		for (const reservation of reservations) {
			const attemptId = typeof reservation.attemptId === "string" ? reservation.attemptId : "";
			const liveJob = [...this.#jobs].some(
				(job) =>
					job.id === reservation.jobId &&
					!job.recoveryOnly &&
					!job.controller.signal.aborted &&
					job.sessionId === authority.sessionId &&
					job.generation === authority.generation &&
					job.navigationId === authority.navigationId &&
					job.strategyId === authority.strategyId &&
					job.leaseId === authority.leaseId &&
					job.principal === authority.principal,
			);
			// A live job may still be between reservation, inference completion and
			// adoption. Reads from that same authorized job remain valid; reopen or
			// reconstruction has no such capability and therefore fails closed.
			if (liveJob) continue;
			const completion = records.find(
				(record) =>
					isJsonObject(record) &&
					record.kind === "completion" &&
					isJsonObject(record.audit) &&
					record.audit.attemptId === attemptId &&
					record.audit.jobId === reservation.jobId,
			) as JsonObject | undefined;
			const audit = completion && isJsonObject(completion.audit) ? completion.audit : undefined;
			if (!completion || !audit) throw new Error("Unresolved inference reservation; storage outcome unknown");
			if (audit.status !== "completed") continue;
			const adopted = records.find(
				(record) =>
					isJsonObject(record) &&
					record.kind === "adoption" &&
					record.attemptId === attemptId &&
					record.jobId === reservation.jobId &&
					record.sessionId === authority.sessionId &&
					record.strategyId === authority.strategyId &&
					record.principal === authority.principal &&
					typeof record.transactionId === "string" &&
					typeof record.version === "number",
			) as JsonObject | undefined;
			if (!adopted) {
				const journal = this.#journal(authority, "inference");
				if (
					journal instanceof NativeJournal &&
					journal
						.work()
						.some(
							(work) =>
								work.jobId === reservation.jobId &&
								work.principal === authority.principal &&
								work.result !== null,
						)
				)
					throw new AwaitingWorkAdoption("Stored inference awaits local adoption of its original work");
				throw new Error("Completed inference has no durable artifact adoption receipt");
			}
			this.#journal(authority).assertTransaction(adopted.transactionId as string, adopted.version as number);
		}
	}
	#validateAdoption(job: JobRecord, attemptIds: readonly string[]): void {
		if (
			!Array.isArray(attemptIds) ||
			attemptIds.some((id) => typeof id !== "string" || !id) ||
			new Set(attemptIds).size !== attemptIds.length
		)
			throw new Error("Invalid/duplicate artifact adoption attempt IDs");
		const records = job.auditJournal.read().records;
		for (const attemptId of attemptIds) {
			const reservation = records.find(
				(record) =>
					isJsonObject(record) &&
					record.kind === "reservation" &&
					record.attemptId === attemptId &&
					record.jobId === job.id &&
					record.planId === job.planId &&
					record.requireArtifactReceipt === true &&
					record.sessionId === job.sessionId &&
					record.strategyId === job.strategyId &&
					record.principal === job.principal &&
					(record.leaseId === job.originLeaseId || record.leaseId === job.leaseId),
			);
			const completion = records.find(
				(record) =>
					isJsonObject(record) &&
					record.kind === "completion" &&
					isJsonObject(record.audit) &&
					record.audit.attemptId === attemptId &&
					record.audit.jobId === job.id &&
					record.audit.planId === job.planId,
			) as JsonObject | undefined;
			const audit = completion && isJsonObject(completion.audit) ? completion.audit : undefined;
			if (!reservation || !audit || !["completed", "failed", "quarantined"].includes(audit.status as string))
				throw new Error("Artifact adoption attempt is not an exact completed job attempt");
			if (job.conversational && audit.status === "completed") this.#ports.checkCompresser?.(job.id);
			if (
				records.some(
					(record) => isJsonObject(record) && record.kind === "adoption" && record.attemptId === attemptId,
				)
			)
				throw new Error("Artifact inference attempt already adopted");
		}
	}
	#adoptionRecords(
		job: JobRecord,
		receipt: Extract<Awaited<ReturnType<Journal["append"]>>, { status: "committed" }>,
		attemptIds: readonly string[],
	): JsonValue[] {
		const records = job.auditJournal.read().records;
		const adopted: JsonValue[] = [];
		for (const attemptId of attemptIds) {
			const reservation = records.find(
				(record) =>
					isJsonObject(record) &&
					record.kind === "reservation" &&
					record.attemptId === attemptId &&
					record.jobId === job.id,
			) as JsonObject | undefined;
			const completion = records.find(
				(record) =>
					isJsonObject(record) &&
					record.kind === "completion" &&
					isJsonObject(record.audit) &&
					record.audit.attemptId === attemptId,
			) as JsonObject | undefined;
			const audit = completion && isJsonObject(completion.audit) ? completion.audit : undefined;
			if (
				!reservation ||
				!completion ||
				!audit ||
				(audit.status !== "completed" && audit.status !== "failed" && audit.status !== "quarantined")
			)
				throw new Error("Artifact adoption attempt is not an exact completed job attempt");
			if (audit.status === "completed") {
				adopted.push({
					kind: "adoption",
					attemptId,
					jobId: job.id,
					sessionId: job.sessionId,
					strategyId: job.strategyId,
					principal: job.principal,
					leaseId: job.leaseId,
					transactionId: receipt.transactionId,
					version: receipt.version,
				});
			}
		}
		return adopted;
	}
	async #settleArtifact(
		job: JobRecord,
		receipt: Extract<Awaited<ReturnType<Journal["append"]>>, { status: "committed" }>,
		attemptIds: readonly string[],
	): Promise<void> {
		const adopted = this.#adoptionRecords(job, receipt, attemptIds);
		const current = job.auditJournal.read();
		if (adopted.length > 0) {
			const adoptionReceipt = await job.auditJournal.append(current.version, adopted);
			if (adoptionReceipt.status !== "committed")
				throw new Error("Inference adoption receipt storage unknown");
		}
		job.journal.settle(receipt.transactionId, receipt.version, attemptIds);
	}
	bind(principal: string, grants: ReadonlySet<Grant>, strategyId: string): StrategyBinding {
		const lease = this.#ports.lease(strategyId);
		if (!lease || lease.principal !== principal) throw new Error("Not strategy owner or missing strategy");
		const leaseId = lease.leaseId;
		this.#authority(strategyId, principal, leaseId);
		return Object.freeze({
			id: strategyId,
			readFrame: (invocation?: ToolInvocationScope) =>
				this.#readFrame(strategyId, principal, leaseId, invocation),
			installProjector: (projector: Projector) => {
				this.#authority(strategyId, principal, leaseId);
				if (
					this.#ports.owner("real_context.write") !== strategyId ||
					!lease.hooks.includes("real_context.write")
				)
					throw new Error("Missing precise real_context.write lease");
				if (typeof projector !== "function" || this.#projectors.has(strategyId))
					throw new Error("Invalid/duplicate projector");
				const installed = { projector, leaseId };
				this.#projectors.set(strategyId, installed);
				return () => {
					if (this.#projectors.get(strategyId) === installed) this.#projectors.delete(strategyId);
				};
			},
			artifacts: Object.freeze({
				read: (scope: ArtifactScope) =>
					this.#journal(this.#scope(scope, principal, strategyId, leaseId)).read(),
				receipt: (scope: ArtifactScope, transactionId: string) => {
					const journal = this.#journal(this.#scope(scope, principal, strategyId, leaseId));
					if (!(journal instanceof NativeJournal))
						throw new Error("Native transaction receipts unavailable in test oracle");
					if (!/^[A-Za-z0-9_-]{1,128}$/.test(transactionId)) throw new Error("Invalid transaction identity");
					return journal.receipt(transactionId);
				},
				append: (
					scope: ArtifactScope,
					batch: {
						expectedVersion: number;
						records: readonly JsonValue[];
						transactionId?: string;
						attemptIds?: readonly string[];
						checkpoint?: SourceWorkCheckpoint;
					},
				) => {
					if (!lease.hooks.includes("context_artifacts.write"))
						throw new Error("Missing context_artifacts.write lease");
					const authority = this.#scope(scope, principal, strategyId, leaseId),
						job = this.#jobsByScope.get(scope),
						attemptIds = batch.attemptIds ?? [];
					if (job?.requireArtifactReceipt && attemptIds.length === 0)
						throw new Error("Artifact adoption requires exact attempt IDs");
					if (!job?.requireArtifactReceipt && attemptIds.length > 0)
						throw new Error("Attempt IDs require an opted-in source job");
					if (batch.checkpoint !== undefined) {
						json(batch.checkpoint);
						if (
							!job ||
							!attemptIds.length ||
							!["ready", "finished"].includes(batch.checkpoint.stage) ||
							Object.keys(batch.checkpoint).some((key) => !["stage", "state", "retryAtMs"].includes(key)) ||
							(batch.checkpoint.retryAtMs !== undefined &&
								(!Number.isSafeInteger(batch.checkpoint.retryAtMs) || batch.checkpoint.retryAtMs < 0))
						)
							throw new Error("Invalid work checkpoint");
					}
					// Association checks are caller preconditions, before either durable
					// intent or artifact bytes. Post-write validation cannot undo an effect.
					if (job?.requireArtifactReceipt) this.#validateAdoption(job, attemptIds);
					const journal = this.#journal(authority);
					if (journal instanceof NativeJournal) {
						const transactionId = batch.transactionId ?? randomUUID();
						const companions: {
							journal: NativeJournal;
							expectedVersion: number;
							records: JsonValue[];
							work?: readonly SourceWorkMutation[];
						}[] = [];
						if (job && attemptIds.length) {
							if (!(job.auditJournal instanceof NativeJournal))
								throw new Error("Mixed journal storage refused");
							const adopted = this.#adoptionRecords(
								job,
								{
									status: "committed",
									version: batch.expectedVersion + 1,
									transactionId,
									journalPath: journal.address(),
								},
								attemptIds,
							);
							adopted.push({
								kind: "checkpoint",
								jobId: job.id,
								planId: job.planId,
								stage: "adopted",
								transactionId,
								artifactVersion: batch.expectedVersion + 1,
								attemptIds: [...attemptIds],
							});
							companions.push({
								journal: job.auditJournal,
								expectedVersion: job.auditJournal.read().version,
								records: adopted,
								work: [
									{
										type: "adopt",
										jobId: job.id,
										transactionId,
										artifactVersion: batch.expectedVersion + 1,
										...(batch.checkpoint === undefined ? {} : { checkpoint: copy(batch.checkpoint) }),
									},
								],
							});
						}
						return journal.append(batch.expectedVersion, batch.records, {
							transactionId,
							companions,
							check: () => {
								this.#scope(scope, principal, strategyId, leaseId);
								if (job?.requireArtifactReceipt) this.#validateAdoption(job, attemptIds);
							},
						});
					}
					const pending = journal.append(batch.expectedVersion, batch.records, { attemptIds });
					return (async () => {
						const receipt = await pending;
						if (receipt.status !== "committed" || !job || attemptIds.length === 0) return receipt;
						try {
							await this.#settleArtifact(job, receipt, attemptIds);
							return receipt;
						} catch (error) {
							this.#ports.storageUnknown(
								"Artifact adoption receipt unknown: " + String(error),
								authority.sessionId,
							);
							return {
								status: "unknown",
								reason: "Artifact adoption receipt failed: " + String(error),
							} as const;
						}
					})();
				},
			}),
			models: () => {
				this.#authority(strategyId, principal, leaseId);
				const keys = this.#policies.find((p) => p.strategyId === strategyId)?.modelKeys ?? [];
				return copy(this.#ports.models().filter((m) => keys.includes(m.key)));
			},
			createJob: (basis: FrameBasis, spec: SourceJobSpec) => {
				if (!grants.has("model.infer")) throw new Error("Missing model.infer grant");
				const record = this.#checkBasis(basis, principal, strategyId, leaseId);
				return this.#createJob(record, spec);
			},
			pendingWork: () => this.#pendingWork(this.#authority(strategyId, principal, leaseId)),
			restoreJob: (jobId: string) => {
				if (!grants.has("model.infer")) throw new Error("Missing model.infer grant");
				return this.#restoreJob(this.#authority(strategyId, principal, leaseId), jobId);
			},
			readWorkFrame: (scope: ArtifactScope) => {
				const job = this.#jobsByScope.get(scope);
				if (!job || job.principal !== principal || job.strategyId !== strategyId || job.leaseId !== leaseId)
					throw new Error("Invalid recovery job scope");
				return this.#readFrame(strategyId, principal, leaseId, undefined, job);
			},
			audit: () => this.#audit(this.#authority(strategyId, principal, leaseId)),
			subscribe: (listener: (event: StrategyLifecycleEvent) => void) => {
				this.#authority(strategyId, principal, leaseId);
				let listeners = this.#listeners.get(leaseId);
				if (!listeners) {
					listeners = new Set();
					this.#listeners.set(leaseId, listeners);
				}
				listeners.add(listener);
				return () => {
					listeners!.delete(listener);
				};
			},
		});
	}
	#createJob(record: BasisRecord, spec: SourceJobSpec): SourceJob {
		const policy = this.#policies.find((p) => p.strategyId === record.strategyId);
		if (
			!policy ||
			!Number.isSafeInteger(spec.maxCalls) ||
			spec.maxCalls <= 0 ||
			spec.maxCalls > policy.maxJobCalls ||
			!spec.planId ||
			!spec.targetEntryIds.length
		)
			throw new Error("Invalid source job/budget policy");
		const targets = [...spec.targetEntryIds],
			contexts = [...(spec.contextEntryIds ?? [])],
			ids = [...contexts, ...targets];
		if (new Set(ids).size !== ids.length) throw new Error("Duplicate target/previous-context source");
		const available = record.frame.projection;
		const sources = new Map<string, string>();
		let last = -1;
		for (const id of ids) {
			const index = available.findIndex((e) => e.sourceEntryId === id),
				entry = available[index];
			if (
				!entry ||
				index <= last ||
				!entry.messages.length ||
				entry.excluded ||
				(targets.includes(id) && entry.boundary)
			)
				throw new Error("Invalid source range/order/boundary");
			sources.set(id, entry.fingerprint);
			last = index;
		}
		const targetProjection = available.filter((e) => targets.includes(e.sourceEntryId));
		applyProjection(record.frame, {
			status: "apply",
			basis: record.frame.basis,
			replacements: [
				{
					sourceEntryIds: targetProjection.map((e) => e.sourceEntryId),
					summary: "Source job range validation",
				},
			],
		});
		const scope = Object.freeze({}),
			job: JobRecord = {
				sessionId: record.sessionId,
				durableSessionId: record.durableSessionId,
				conversationId: record.conversationId,
				generation: record.generation,
				navigationId: record.navigationId,
				strategyId: record.strategyId,
				leaseId: record.leaseId,
				principal: record.principal,
				id: randomUUID(),
				scope,
				planId: spec.planId,
				sources,
				targets: copy(targets),
				maxCalls: spec.maxCalls,
				calls: 0,
				controller: new AbortController(),
				policy,
				journal: this.#journal(record),
				auditJournal: this.#journal(record, "inference"),
				requireArtifactReceipt: spec.requireArtifactReceipt === true,
				originLeaseId: record.leaseId,
				metadata: spec.metadata === undefined ? null : copy(spec.metadata),
			};
		this.#jobsByScope.set(scope, job);
		this.#jobs.add(job);
		this.#checkJob(job);
		return this.#jobHandle(job);
	}
	#pendingWork(authority: Authority): readonly SourceWorkSnapshot[] {
		const journal = this.#journal(authority, "inference");
		if (!(journal instanceof NativeJournal)) return [];
		return copy(
			journal
				.work()
				.filter((work) => work.principal === authority.principal && work.strategyId === authority.strategyId)
				.map((work) => ({
					address: work.namespace + "." + work.jobId,
					jobId: work.jobId,
					planId: work.planId,
					stage: work.stage as SourceWorkSnapshot["stage"],
					checkpoint: work.checkpoint,
					retryAtMs: work.retryAtMs,
					sourceEntryIds: work.sources.map(([id]) => id),
					targetEntryIds: work.targetEntryIds,
					metadata: work.metadata,
					attemptIds: work.attemptIds,
					budget: { reserved: work.attemptIds.length, maxCalls: work.maxCalls },
					hasSealedResult: work.sealed && work.result !== null,
				})),
		);
	}
	async #restoreJob(authority: Authority, jobId: string): Promise<SourceJob> {
		const journal = this.#journal(authority),
			auditJournal = this.#journal(authority, "inference");
		if (!(auditJournal instanceof NativeJournal))
			throw new Error("Native work recovery unavailable in test oracle");
		const work = auditJournal.work().find((work) => work.jobId === jobId);
		const policy = this.#policies.find((policy) => policy.strategyId === authority.strategyId);
		if (
			!work ||
			work.principal !== authority.principal ||
			work.strategyId !== authority.strategyId ||
			work.sessionId !== authority.sessionId ||
			work.durableSessionId !== authority.durableSessionId ||
			work.conversationId !== authority.conversationId ||
			!policy ||
			work.maxCalls > policy.maxJobCalls ||
			(work.result && !policy.modelKeys.includes(work.result.modelKey))
		)
			throw new Error("Persisted work identity/policy does not match current authority");
		const scope = Object.freeze({});
		const job: JobRecord = {
			...authority,
			id: work.jobId,
			scope,
			planId: work.planId,
			sources: new Map(work.sources),
			targets: copy(work.targetEntryIds),
			maxCalls: work.maxCalls,
			calls: work.attemptIds.length,
			controller: new AbortController(),
			policy,
			journal,
			auditJournal,
			requireArtifactReceipt: work.requireArtifactReceipt,
			originLeaseId: work.originLeaseId,
			metadata: copy(work.metadata),
			prepared: Promise.resolve(),
			restored: work,
			recoveryOnly: !["planned", "ready"].includes(work.stage),
			conversational: work.mode === "conversation",
		};
		this.#checkJob(job);
		this.#jobsByScope.set(scope, job);
		this.#jobs.add(job);
		return this.#jobHandle(job);
	}
	#prepareJob(job: JobRecord): Promise<void> {
		this.#checkJob(job);
		if (job.prepared) return job.prepared;
		const journal = job.auditJournal;
		if (!(journal instanceof NativeJournal)) return (job.prepared = Promise.resolve());
		json(job.metadata);
		if (Buffer.byteLength(JSON.stringify(job.metadata), "utf8") > 262144)
			throw new Error("Source-work metadata is too large");
		const work: StoredSourceWork = {
			namespace: "",
			jobId: job.id,
			planId: job.planId,
			sessionId: job.sessionId,
			...(job.durableSessionId === undefined ? {} : { durableSessionId: job.durableSessionId }),
			...(job.conversationId === undefined ? {} : { conversationId: job.conversationId }),
			strategyId: job.strategyId,
			principal: job.principal,
			originLeaseId: job.originLeaseId,
			sources: [...job.sources],
			targetEntryIds: copy(job.targets),
			maxCalls: job.maxCalls,
			requireArtifactReceipt: job.requireArtifactReceipt,
			metadata: copy(job.metadata),
			stage: "planned",
			checkpoint: null,
			retryAtMs: null,
			attemptIds: [],
			pendingAttempt: null,
			requestHash: null,
			mode: null,
			result: null,
			resultDigest: null,
			sealed: false,
			adoption: null,
		};
		return (job.prepared = (async () => {
			const receipt = await journal.appendLatest(
				[{ kind: "workplan", jobId: job.id, planId: job.planId, planHash: hash(sourceWorkPlan(work)) }],
				() => this.#checkJob(job),
				[{ type: "plan", work }],
			);
			if (receipt.status !== "committed")
				throw new Error("Source-work preparation unconfirmed: " + receipt.status);
			this.#checkJob(job);
		})());
	}
	#recoveredResult(
		job: JobRecord,
		request: InferenceRequest,
		mode: "single" | "conversation",
		validateCall?: InferenceCallValidator,
	): InferenceResult | undefined {
		const work = job.restored;
		if (!work) return undefined;
		if (work.stage === "ready" && work.retryAtMs !== null && Date.now() < work.retryAtMs)
			throw new Error("Persisted retry time has not arrived");
		if (work.attemptIds.length === 0 || work.stage === "ready") {
			job.restored = undefined;
			job.recoveryOnly = false;
			return undefined;
		}
		this.#checkJob(job);
		if (work.mode !== mode || work.requestHash !== hash(copy(request)))
			throw new Error("Restored work request/mode digest changed");
		if (work.stage === "quarantined" || work.pendingAttempt || !work.result || !work.sealed)
			throw new Error("Restored work has unconfirmed model effects; request replay refused");
		if (work.resultDigest !== hash(work.result)) throw new Error("Restored result digest is invalid");
		if (work.result.toolCall && validateCall?.(copy(work.result.toolCall)) !== undefined)
			throw new Error("Restored candidate validation changed");
		return copy(work.result);
	}
	async #sealJobResult(job: JobRecord, rawResult: InferenceResult): Promise<void> {
		if (!(job.auditJournal instanceof NativeJournal)) return;
		const result = finiteInferenceResult(rawResult);
		const receipt = await job.auditJournal.appendLatest(
			[
				{
					kind: "work-result",
					jobId: job.id,
					planId: job.planId,
					attemptId: result.attemptId,
					resultHash: hash(result),
				},
			],
			// Quarantine is bookkeeping for effects already checked and recorded.
			// Revocation must block adoption, not discard the late audit result.
			result.status === "quarantined" ? () => {} : () => this.#checkJob(job),
			[{ type: "seal", jobId: job.id, result: copy(result) }],
		);
		if (receipt.status !== "committed")
			throw new Error("Source-work sealed result unconfirmed: " + receipt.status);
	}
	#trackInference(pending: Promise<InferenceResult>): Promise<InferenceResult> {
		const settled = pending.then(
			() => {},
			() => {},
		);
		this.#settling.add(settled);
		void settled.then(() => this.#settling.delete(settled));
		return pending;
	}
	/** Own all started attempts until their bookkeeping is confirmed or unknown. */
	async drain(): Promise<void> {
		while (this.#settling.size) await Promise.all([...this.#settling]);
	}
	#jobHandle(job: JobRecord): SourceJob {
		return Object.freeze({
			id: job.id,
			scope: job.scope,
			signal: job.controller.signal,
			prepare: () => this.#prepareJob(job),
			check: () => this.#checkJob(job),
			infer: (request: InferenceRequest) => this.#trackInference(this.#infer(job, request)),
			converse: (request: InferenceRequest, validateCall?: InferenceCallValidator) =>
				this.#trackInference(this.#converse(job, request, validateCall)),
			cancel: (reason = "caller cancellation") => this.#cancelJob(job, reason),
		});
	}
	#prepareInference(job: JobRecord, original: InferenceRequest): { request: InferenceRequest; cap: number } {
		this.#checkJob(job);
		const request = copy(original),
			model = this.#ports.models().find((m) => m.key === request.modelKey);
		if (!job.policy.modelKeys.includes(request.modelKey) || !model)
			throw new Error("Model is not allowlisted");
		if (
			typeof request.prompt !== "string" ||
			!request.prompt.trim() ||
			(request.systemPrompt !== undefined && typeof request.systemPrompt !== "string") ||
			(request.maxOutputTokens !== undefined &&
				(!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 0))
		)
			throw new Error("Invalid inference request");
		if (request.outputTool !== undefined) {
			const tool = request.outputTool;
			json(tool);
			if (
				!tool ||
				typeof tool !== "object" ||
				Array.isArray(tool) ||
				typeof tool.name !== "string" ||
				!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) ||
				typeof tool.description !== "string" ||
				!tool.description.trim() ||
				tool.description.length > 8192 ||
				!isJsonObject(tool.parameters) ||
				tool.parameters.type !== "object" ||
				Buffer.byteLength(JSON.stringify(tool), "utf8") > 65536
			)
				throw new Error("Invalid inference output tool declaration");
		}
		const cap = Math.min(
			model.maxOutputTokens,
			job.policy.maxOutputTokens,
			request.maxOutputTokens || job.policy.maxOutputTokens,
		);
		return { request, cap };
	}
	async #beginInference(job: JobRecord, request: InferenceRequest, cap: number): Promise<string> {
		this.#checkJob(job);
		const journal = job.auditJournal,
			before = journal.read();
		const calls = before.records.filter(
			(r) =>
				r && typeof r === "object" && !Array.isArray(r) && (r as { kind?: string }).kind === "reservation",
		).length;
		if (job.calls >= job.maxCalls || calls >= job.policy.maxCalls)
			throw new Error("Inference call budget exhausted");
		if (journal instanceof NativeJournal) {
			const work = journal.work().find((work) => work.jobId === job.id);
			if (work?.retryAtMs !== null && work?.retryAtMs !== undefined && Date.now() < work.retryAtMs)
				throw new Error("Persisted retry time has not arrived");
		}
		const attemptId = randomUUID();
		const reserve = [
			{
				kind: "reservation",
				jobId: job.id,
				planId: job.planId,
				attemptId,
				modelKey: request.modelKey,
				cap,
				requireArtifactReceipt: job.requireArtifactReceipt,
				sessionId: job.sessionId,
				strategyId: job.strategyId,
				principal: job.principal,
				leaseId: job.leaseId,
			},
		] as const;
		const reservation =
			journal instanceof NativeJournal
				? await journal.appendLatest(
						reserve,
						(snapshot) => {
							this.#checkJob(job);
							const work = journal.work().find((work) => work.jobId === job.id);
							if (work?.retryAtMs !== null && work?.retryAtMs !== undefined && Date.now() < work.retryAtMs)
								throw new Error("Persisted retry time has not arrived");
							const reservations = snapshot.records.filter(
								(row) => isJsonObject(row) && row.kind === "reservation",
							);
							if (
								reservations.length >= job.policy.maxCalls ||
								reservations.filter((row) => isJsonObject(row) && row.jobId === job.id).length >= job.maxCalls
							)
								throw new Error("Inference call budget exhausted");
						},
						[
							{
								type: "reserve",
								jobId: job.id,
								attemptId,
								requestHash: hash(copy(request)),
								mode: job.conversational ? "conversation" : "single",
							},
						],
					)
				: await journal.append(before.version, reserve);
		if (reservation.status !== "committed") {
			this.#ports.storageUnknown("Inference budget storage unknown/conflict", job.sessionId);
			throw new Error("Inference budget storage unknown/conflict");
		}
		job.calls++;
		return attemptId;
	}
	async #completeInference(
		job: JobRecord,
		attemptId: string,
		cap: number,
		output: Omit<InferenceResult, "attemptId">,
	): Promise<InferenceResult> {
		const journal = job.auditJournal;
		try {
			this.#checkJob(job);
		} catch (error) {
			output = { ...output, status: "quarantined", reason: String(error) };
		}
		const result = finiteInferenceResult({ ...output, attemptId }),
			audit: InferenceAudit = { ...result, jobId: job.id, planId: job.planId, maxOutputTokens: cap };
		try {
			const after = journal.read();
			if (
				after.records.some(
					(record) =>
						isJsonObject(record) &&
						record.kind === "completion" &&
						isJsonObject(record.audit) &&
						record.audit.attemptId === attemptId,
				)
			)
				throw new Error("Inference attempt completion already recorded; do not duplicate");
			const completion = [
				{ kind: "completion", audit: JSON.parse(JSON.stringify(audit)) as JsonValue },
			] as const;
			const receipt =
				journal instanceof NativeJournal
					? await journal.appendLatest(
							completion,
							(snapshot) => {
								if (
									snapshot.records.some(
										(row) =>
											isJsonObject(row) &&
											row.kind === "completion" &&
											isJsonObject(row.audit) &&
											row.audit.attemptId === attemptId,
									)
								)
									throw new Error("Inference attempt completion already recorded");
							},
							[{ type: "result", jobId: job.id, result, sealed: !job.conversational }],
						)
					: await journal.append(after.version, completion);
			if (receipt.status !== "committed")
				throw new Error("Inference completion storage unknown; do not retry");
		} catch (error) {
			this.#ports.storageUnknown("Inference completion storage unknown: " + String(error), job.sessionId);
			throw error;
		}
		return result;
	}
	async #infer(job: JobRecord, original: InferenceRequest): Promise<InferenceResult> {
		if (job.conversational)
			throw new Error("A conversational source job cannot switch to single-call retries");
		const { request, cap } = this.#prepareInference(job, original);
		await this.#prepareJob(job);
		const recovered = this.#recoveredResult(job, request, "single");
		if (recovered) return recovered;
		const attemptId = await this.#beginInference(job, request, cap);
		const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(job.policy.timeoutMs)]);
		let output: Omit<InferenceResult, "attemptId">;
		try {
			output = await this.#ports.infer(
				request,
				cap,
				signal,
				job.policy.timeoutMs,
				() => this.#checkJob(job),
				{ strategyId: job.strategyId, maxCalls: job.policy.maxCalls },
			);
		} catch {
			output = {
				status: "failed",
				modelKey: request.modelKey,
				reason: "Auxiliary inference failed",
				usageStatus: "unknown",
			};
		}
		return this.#completeInference(job, attemptId, cap, output);
	}
	async #converse(
		job: JobRecord,
		original: InferenceRequest,
		validateCall?: InferenceCallValidator,
	): Promise<InferenceResult> {
		const { request, cap } = this.#prepareInference(job, original);
		if (!request.outputTool || (validateCall !== undefined && typeof validateCall !== "function"))
			throw new Error("Conversational inference requires a declared output tool and optional pure validator");
		if (!this.#ports.converse) throw new Error("Conversational auxiliary inference unavailable");
		await this.#prepareJob(job);
		const work = job.restored;
		if (
			work &&
			work.stage === "resultStored" &&
			!work.sealed &&
			!work.pendingAttempt &&
			work.result?.status === "completed"
		) {
			if (work.mode !== "conversation" || work.requestHash !== hash(copy(request)))
				throw new Error("Restored work request/mode digest changed");
			if (!this.#ports.recoverConverse) throw new Error("Compresser fixed result recovery unavailable");
			const result = await this.#ports.recoverConverse(
				{
					jobId: job.id,
					planId: job.planId,
					sessionId: job.sessionId,
					conversationId: job.conversationId ?? "",
				},
				request,
			);
			const { compresser: _compresser, ...single } = result;
			if (
				hash(single) !== hash(work.result) ||
				!work.attemptIds.includes(result.attemptId) ||
				(result.toolCall && validateCall?.(copy(result.toolCall)) !== undefined)
			)
				throw new Error("Compresser result differs from the confirmed source completion");
			await this.#sealJobResult(job, result);
			job.restored = { ...work, result: copy(result), resultDigest: hash(result), sealed: true };
		}
		const recovered = this.#recoveredResult(job, request, "conversation", validateCall);
		if (recovered) return recovered;
		this.#ports.checkCompresser?.(job.id);
		if (job.calls && !job.conversational) throw new Error("Source job already uses single-call inference");
		job.conversational = true;
		const result = await this.#ports.converse(
			{
				request,
				cap,
				signal: job.controller.signal,
				timeoutMs: job.policy.timeoutMs,
				source: {
					jobId: job.id,
					planId: job.planId,
					sessionId: job.sessionId,
					conversationId: job.conversationId ?? "",
				},
				validateCall,
				check: () => this.#checkJob(job),
				begin: () => this.#beginInference(job, request, cap),
				complete: (attemptId, output) => this.#completeInference(job, attemptId, cap, output),
			},
			{ strategyId: job.strategyId, maxCalls: job.policy.maxCalls },
		);
		await this.#sealJobResult(job, result);
		return result;
	}
	#planSnapshot(plan: ProjectionPlan): ProjectionPlan {
		if (plan.status === "disabled" || plan.status === "blocked") return freeze({ ...plan });
		return freeze({
			...plan,
			...(plan.patches ? { patches: copy(plan.patches) } : {}),
			...(plan.renderPatches ? { renderPatches: copy(plan.renderPatches) } : {}),
			...(plan.replacements
				? {
						replacements: plan.replacements.map((range) =>
							freeze({
								...range,
								sourceEntryIds: copy(range.sourceEntryIds),
								summary: range.summary,
								...(range.jobScope ? { jobScope: range.jobScope } : {}),
							}),
						),
					}
				: {}),
		});
	}
	async project(
		signal?: AbortSignal,
	): Promise<
		| { messages: readonly ContextFrame["projection"][number]["messages"][number][]; check(): void }
		| { block: string; check(): void }
	> {
		this.#ports.ready();
		const strategyId = this.#ports.owner("real_context.write"),
			installed = strategyId ? this.#projectors.get(strategyId) : undefined;
		const requestId = randomUUID();
		this.#permitId = requestId;
		if (!strategyId || !installed) {
			const data = this.#ports.frame(),
				identity = this.#ports.identity(),
				fingerprint = hash(data);
			return {
				messages: data.projection.flatMap((e) => e.messages),
				check: () => {
					this.#ports.ready();
					if (
						!this.#sameIdentity(identity) ||
						hash(this.#ports.frame()) !== fingerprint ||
						this.#permitId !== requestId ||
						this.#ports.owner("real_context.write") !== strategyId ||
						(strategyId && this.#projectors.has(strategyId))
					)
						throw new Error("Provider request scope changed");
				},
			};
		}
		const lease = this.#ports.lease(strategyId)!;
		this.#request = { id: requestId, strategyId };
		try {
			const frame = this.#readFrame(strategyId, lease.principal, installed.leaseId);
			const proposed = installed.projector(frame, signal);
			const plan =
				proposed instanceof Promise ? this.#planSnapshot(await proposed) : this.#planSnapshot(proposed);
			const basis = this.#checkBasis(plan.basis, lease.principal, strategyId, installed.leaseId);
			if (
				basis.requestId !== requestId ||
				this.#projectors.get(strategyId) !== installed ||
				this.#ports.owner("real_context.write") !== strategyId
			)
				throw new Error("Projection request/owner changed");
			const check = () => {
				this.#checkBasis(plan.basis, lease.principal, strategyId, installed.leaseId);
				if (
					this.#permitId !== requestId ||
					this.#projectors.get(strategyId) !== installed ||
					this.#ports.owner("real_context.write") !== strategyId
				)
					throw new Error("Projection lease/request revoked");
				if (plan.status === "apply")
					for (const range of plan.replacements ?? [])
						if (range.jobScope) {
							const job = this.#jobsByScope.get(range.jobScope);
							if (
								!job ||
								job.strategyId !== strategyId ||
								job.leaseId !== installed.leaseId ||
								hash(job.targets) !== hash(range.sourceEntryIds)
							)
								throw new Error("Invalid summary job scope/targets");
							this.#checkJob(job);
						}
			};
			check();
			if (plan.status === "blocked") {
				if (
					typeof plan.reason !== "string" ||
					Object.keys(plan).some((key) => !["status", "basis", "reason"].includes(key))
				)
					throw new Error("Invalid projection block plan");
				return { block: plan.reason, check };
			}
			return { messages: applyProjection(basis.frame, plan), check };
		} catch (error) {
			if (!(error instanceof LifecycleTransitionRevoked))
				this.#ports.fail("Projection control failure: " + String(error));
			throw error;
		} finally {
			if (this.#request?.id === requestId) this.#request = undefined;
		}
	}
	sourceChanged(): void {
		for (const job of this.#jobs)
			if (!job.controller.signal.aborted) {
				try {
					this.#checkJob(job);
				} catch {
					/* source/lifecycle validation already aborted it */
				}
			}
	}
	restored(reason: "reload" | "newSession"): void {
		this.#notifyLifecycle(reason);
	}
	#notifyLifecycle(reason: StrategyLifecycleEvent["reason"], onlyStrategy?: string): void {
		const event = copy({ ...this.#ports.identity(), phase: this.#ports.phase(), reason });
		for (const [leaseId, listeners] of this.#listeners) {
			if (onlyStrategy && this.#ports.lease(onlyStrategy)?.leaseId !== leaseId) continue;
			for (const listener of [...listeners])
				queueMicrotask(() => {
					if (!listeners.has(listener)) return;
					try {
						listener(event);
					} catch {
						/* observers do not own authorization */
					}
				});
		}
	}
	invalidate(reason: StrategyLifecycleEvent["reason"], onlyStrategy?: string): void {
		for (const job of this.#jobs)
			if (!onlyStrategy || job.strategyId === onlyStrategy) this.#cancelJob(job, reason);
		for (const id of this.#projectors.keys())
			if (reason === "deactivated" && (!onlyStrategy || id === onlyStrategy)) this.#projectors.delete(id);
		this.#notifyLifecycle(reason, onlyStrategy);
	}
}
