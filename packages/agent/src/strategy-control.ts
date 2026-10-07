import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { ArtifactJournal, copy, freeze, hash } from "./artifact-journal.ts";
import { applyProjection } from "./strategy-projection.ts";
import type { AdapterFrame } from "./pi-adapter.ts";
import type {
	ArtifactScope,
	ContextFrame,
	FrameBasis,
	Grant,
	Hook,
	InferenceAudit,
	InferencePolicy,
	InferenceRequest,
	InferenceResult,
	JsonValue,
	ModelDTO,
	Projector,
	ProjectionPlan,
	SourceJob,
	SourceJobSpec,
	StrategyBinding,
	StrategyLifecycleEvent,
	ToolInvocationScope,
} from "./types.ts";

type Identity = { sessionId: string; generation: number; navigationId: string };
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
	models(): readonly ModelDTO[];
	infer(
		request: InferenceRequest,
		cap: number,
		signal: AbortSignal,
		timeoutMs: number,
		check: () => void,
	): Promise<Omit<InferenceResult, "attemptId">>;
}
type Authority = Identity & { strategyId: string; leaseId: string; principal: string };
type BasisRecord = Authority & {
	fingerprint: string;
	artifactVersion: number;
	requestId: string | null;
	frame: ContextFrame;
	invocation?: object;
};
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
	journal: ArtifactJournal;
	auditJournal: ArtifactJournal;
};

export class StrategyControl {
	#ports: Ports;
	#root: string;
	#policies: readonly InferencePolicy[];
	#basis = new WeakMap<FrameBasis, BasisRecord>();
	#jobsByScope = new WeakMap<object, JobRecord>();
	#jobs = new Set<JobRecord>();
	#projectors = new Map<string, { projector: Projector; leaseId: string }>();
	#journals = new Map<string, ArtifactJournal>();
	#listeners = new Map<string, Set<(event: StrategyLifecycleEvent) => void>>();
	#runs = new WeakMap<object, Identity>();
	#invocations = new WeakMap<object, Identity & { active: boolean }>();
	#local = new AsyncLocalStorage<object>();
	#request: { id: string; strategyId: string } | undefined;
	#permitId: string | undefined;
	constructor(root: string, policies: readonly InferencePolicy[], ports: Ports) {
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
		return hash(identity) === hash(this.#ports.identity());
	}
	#check(a: Authority): void {
		this.#ports.ready();
		const lease = this.#ports.lease(a.strategyId);
		if (!lease || lease.principal !== a.principal || lease.leaseId !== a.leaseId)
			throw new Error("Strategy inactive or lease changed");
		if (
			!this.#sameIdentity({ sessionId: a.sessionId, generation: a.generation, navigationId: a.navigationId })
		)
			throw new Error("Stale lifecycle/navigation scope");
	}
	#authority(strategyId: string, principal: string, leaseId: string): Authority {
		const authority = { ...this.#ports.identity(), strategyId, principal, leaseId };
		this.#check(authority);
		return authority;
	}
	#journal(authority: Authority, kind = "records"): ArtifactJournal {
		const key = JSON.stringify([authority.sessionId, authority.strategyId, kind]);
		let journal = this.#journals.get(key);
		if (!journal) {
			journal = new ArtifactJournal(
				this.#root,
				authority.sessionId,
				authority.strategyId + ":" + kind,
				(reason) => this.#ports.fail(reason, authority.sessionId),
			);
			this.#journals.set(key, journal);
		}
		return journal;
	}
	#checkInvocation(scope: object): void {
		const invocation = this.#invocations.get(scope);
		if (
			!invocation?.active ||
			!this.#sameIdentity({
				sessionId: invocation.sessionId,
				generation: invocation.generation,
				navigationId: invocation.navigationId,
			})
		)
			throw new Error("Invalid/stale tool invocation scope");
		this.#ports.ready();
	}
	runScope(): object {
		this.#ports.ready();
		const token = Object.freeze({});
		this.#runs.set(token, this.#ports.identity());
		return token;
	}
	async invoke<T>(run: object, callback: (scope: ToolInvocationScope) => Promise<T>): Promise<T> {
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
	#readFrame(strategyId: string, principal: string, leaseId: string, invocation?: object): ContextFrame {
		const local = this.#local.getStore();
		if (local) this.#checkInvocation(local);
		if (invocation) this.#checkInvocation(invocation);
		const authority = this.#authority(strategyId, principal, leaseId);
		const data = this.#ports.frame(),
			artifacts = this.#journal(authority).read();
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
		});
		return frame;
	}
	#checkBasis(scope: object, principal: string, strategyId: string, leaseId: string): BasisRecord {
		const record = this.#basis.get(scope);
		if (
			!record ||
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
			job.controller.abort(String(error));
			throw error;
		}
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
				append: (scope: ArtifactScope, batch: { expectedVersion: number; records: readonly JsonValue[] }) => {
					if (
						!lease.hooks.includes("context_artifacts.write") ||
						this.#ports.owner("context_artifacts.write") !== strategyId
					)
						throw new Error("Missing context_artifacts.write lease");
					const authority = this.#scope(scope, principal, strategyId, leaseId);
					return this.#journal(authority).append(batch.expectedVersion, batch.records);
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
				...record,
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
			};
		this.#jobsByScope.set(scope, job);
		this.#jobs.add(job);
		this.#checkJob(job);
		return Object.freeze({
			id: job.id,
			scope,
			signal: job.controller.signal,
			check: () => this.#checkJob(job),
			infer: (request: InferenceRequest) => this.#infer(job, request),
			cancel: (reason = "caller cancellation") => job.controller.abort(reason),
		});
	}
	async #infer(job: JobRecord, original: InferenceRequest): Promise<InferenceResult> {
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
		const cap = Math.min(
			model.maxOutputTokens,
			job.policy.maxOutputTokens,
			request.maxOutputTokens || job.policy.maxOutputTokens,
		);
		const journal = job.auditJournal,
			before = journal.read();
		const calls = before.records.filter(
			(r) =>
				r && typeof r === "object" && !Array.isArray(r) && (r as { kind?: string }).kind === "reservation",
		).length;
		if (job.calls >= job.maxCalls || calls >= job.policy.maxCalls)
			throw new Error("Inference call budget exhausted");
		const attemptId = randomUUID();
		const reservation = journal.append(before.version, [
			{ kind: "reservation", jobId: job.id, planId: job.planId, attemptId, modelKey: request.modelKey, cap },
		]);
		if (reservation.status !== "committed") throw new Error("Inference budget storage unknown/conflict");
		job.calls++;
		const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(job.policy.timeoutMs)]);
		let output: Omit<InferenceResult, "attemptId">;
		try {
			output = await this.#ports.infer(request, cap, signal, job.policy.timeoutMs, () => this.#checkJob(job));
		} catch {
			output = {
				status: "failed",
				modelKey: request.modelKey,
				reason: "Auxiliary inference failed",
				usageStatus: "unknown",
			};
		}
		try {
			this.#checkJob(job);
		} catch (error) {
			output = { ...output, status: "quarantined", reason: String(error) };
		}
		const result = copy({ ...output, attemptId }),
			audit: InferenceAudit = { ...result, jobId: job.id, planId: job.planId, maxOutputTokens: cap };
		const after = journal.read(),
			receipt = journal.append(after.version, [
				{ kind: "completion", audit: JSON.parse(JSON.stringify(audit)) as JsonValue },
			]);
		if (receipt.status !== "committed") throw new Error("Inference completion storage unknown; do not retry");
		return result;
	}
	#planSnapshot(plan: ProjectionPlan): ProjectionPlan {
		if (plan.status === "disabled") return freeze({ ...plan });
		return freeze({
			...plan,
			...(plan.patches ? { patches: copy(plan.patches) } : {}),
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
	): Promise<{ messages: readonly ContextFrame["projection"][number]["messages"][number][]; check(): void }> {
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
			return { messages: applyProjection(basis.frame, plan), check };
		} catch (error) {
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
			if (!onlyStrategy || job.strategyId === onlyStrategy) job.controller.abort(reason);
		for (const [id, lease] of this.#projectors)
			if (reason === "deactivated" && (!onlyStrategy || id === onlyStrategy)) this.#projectors.delete(id);
		this.#notifyLifecycle(reason, onlyStrategy);
	}
}
