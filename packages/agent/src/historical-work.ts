import { randomUUID } from "node:crypto";
import { copy, hash, json } from "./artifact-journal.ts";
import type {
	InferenceCallValidator,
	InferenceResult,
	JsonObject,
	RuntimeRecords,
	RuntimeRecordsCommit,
} from "./types.ts";
import type { HistoricalPlan, HistoricalWork, HistoricalWorkSnapshot } from "./historical-types.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Work = Mutable<HistoricalWorkSnapshot> & {
	plan: HistoricalPlan;
	fingerprint: string;
	pending: string | null;
	claim: string | null;
	publication: { fingerprint: string; transactionId: string } | null;
	retirement?: { fingerprint: string; transactionId: string; reason: string; previousStatus: string };
};
type Policy = { sessionId: string; used: number; pending: string[] };
export interface HistoricalExecutionPort {
	identity(): Promise<string>;
	active(plan: HistoricalPlan): boolean;
	retired(plan: HistoricalPlan, check: () => void): Promise<void>;
	validate(plan: HistoricalPlan, check: () => void): Promise<void>;
	run(
		plan: HistoricalPlan,
		callbacks: {
			check(): void;
			begin(): Promise<string>;
			complete(id: string, value: Omit<InferenceResult, "attemptId">): Promise<InferenceResult>;
		},
		validateCall?: InferenceCallValidator,
		signal?: AbortSignal,
	): Promise<InferenceResult>;
	recover(plan: HistoricalPlan): Promise<InferenceResult>;
}
const key = (id: string) => "@historian:job:" + hash(id),
	policyKey = "@historian:policy";
const finite = (n: unknown, min = 0): n is number =>
	Number.isSafeInteger(n) && Number(n) >= min && Number(n) < Number.MAX_SAFE_INTEGER;
function identity(id: unknown): asserts id is string {
	if (typeof id !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/u.test(id))
		throw Error("Invalid historical work identity");
}
function data(value: unknown): JsonObject {
	try {
		const result: unknown = JSON.parse(JSON.stringify(value));
		json(result);
		if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid work data");
		return result as JsonObject;
	} catch (error) {
		throw new Error("Historical work is not serializable JSON", { cause: error });
	}
}
function snapshot(work: Work): HistoricalWorkSnapshot {
	return copy({ id: work.id, status: work.status, attempts: work.attempts, result: work.result });
}
function planInput(raw: HistoricalPlan): HistoricalPlan {
	const plan = copy(raw);
	identity(plan.id);
	identity(plan.strategyId);
	if (
		!plan.source ||
		!plan.target ||
		typeof plan.target.key !== "string" ||
		plan.target.key.startsWith("@historian:") ||
		!finite(plan.target.version) ||
		!finite(plan.maxCalls, 1) ||
		plan.maxCalls > 32 ||
		!Array.isArray(plan.artifacts) ||
		!plan.artifacts.length ||
		plan.artifacts.length > 64 ||
		!plan.request?.outputTool ||
		typeof plan.request.prompt !== "string" ||
		Buffer.byteLength(JSON.stringify(plan)) > 96 * 1024
	)
		throw Error("Invalid bounded historical plan");
	for (const ref of plan.artifacts)
		if (
			ref.sessionId !== plan.source.sessionId ||
			ref.conversationId !== plan.source.conversationId ||
			ref.strategyId !== plan.strategyId
		)
			throw Error("Foreign historical artifact");
	return plan;
}
/** Decode persisted data before it is allowed to drive execution or publication. */
function workData(raw: unknown): Work | null {
	if (raw === null) return null;
	if (!raw || typeof raw !== "object") throw Error("Invalid historical work storage");
	const work = structuredClone(raw) as Work;
	identity(work.id);
	if (
		!["planned", "running", "completed", "failed", "unknown", "published", "retired"].includes(work.status) ||
		!finite(work.attempts) ||
		typeof work.fingerprint !== "string" ||
		hash(planInput(work.plan)) !== work.fingerprint ||
		work.id !== work.plan.id ||
		work.attempts > work.plan.maxCalls ||
		(work.pending !== null && typeof work.pending !== "string") ||
		(work.claim !== null && typeof work.claim !== "string") ||
		work.result === undefined
	)
		throw Error("Invalid historical work storage");
	if (
		work.result &&
		(!work.result.attemptId || !["completed", "failed", "quarantined"].includes(work.result.status))
	)
		throw Error("Invalid historical result storage");
	if (
		work.publication &&
		(typeof work.publication.fingerprint !== "string" || typeof work.publication.transactionId !== "string")
	)
		throw Error("Invalid historical publication storage");
	return work;
}
function policyData(raw: unknown): Policy | null {
	if (raw === null) return null;
	if (!raw || typeof raw !== "object") throw Error("Invalid Historian policy storage");
	const policy = structuredClone(raw) as Policy;
	if (
		typeof policy.sessionId !== "string" ||
		!policy.sessionId ||
		!finite(policy.used) ||
		!Array.isArray(policy.pending) ||
		policy.pending.length > 64 ||
		new Set(policy.pending).size !== policy.pending.length
	)
		throw Error("Invalid Historian policy storage");
	policy.pending.forEach(identity);
	return policy;
}
/** No native state or credentials cross these callbacks. The records CAS is the execution claimant. */
export function createHistoricalWork(
	store: RuntimeRecords,
	native: HistoricalExecutionPort,
	limits: { maxPending: number; maxAttempts: number },
): HistoricalWork {
	if (!finite(limits.maxPending, 1) || limits.maxPending > 64 || !finite(limits.maxAttempts, 1))
		throw Error("Invalid Historian allowance");
	const lookup = async (id: string, check: () => void) => {
		identity(id);
		const row = await store.get(key(id), check);
		return workData(row.data);
	};
	const change = async (
		id: string,
		check: () => void,
		action: (work: Work | null, policy: Policy) => Work,
	): Promise<Work> => {
		for (let attempt = 0; attempt < 32; attempt++) {
			check();
			const sessionId = await native.identity();
			check();
			const [row, head] = await Promise.all([store.get(key(id), check), store.get(policyKey, check)]);
			const policy: Policy = policyData(head.data) ?? { sessionId, used: 0, pending: [] };
			if (policy.sessionId !== sessionId) throw Error("Original Historian Session required");
			const work = action(workData(row.data), policy);
			try {
				await store.commit(
					{
						requestId: "history-change-" + randomUUID(),
						reads: [
							{ key: key(id), version: row.version },
							{ key: policyKey, version: head.version },
						],
						writes: [
							{ key: key(id), data: data(work) },
							{ key: policyKey, data: data(policy) },
						],
						append: [],
						work: [
							{
								key: key(id),
								state: work.status === "published" || work.status === "retired" ? null : work.status,
							},
						],
					},
					check,
				);
				return copy(work);
			} catch (error) {
				if ((error as { code?: string }).code !== "conflict") throw error;
			}
		}
		throw Error("Historical work contention");
	};
	const recover = async (id: string, check: () => void): Promise<HistoricalWorkSnapshot> => {
		const work = await lookup(id, check);
		if (!work) throw Error("Historical plan missing");
		if (work.status === "retired") {
			await native.retired(work.plan, check);
			check();
			return snapshot(work);
		}
		if (work.status === "planned" || work.status === "published" || work.status === "completed")
			return snapshot(work);
		check();
		await native.validate(work.plan, check);
		const result = await native.recover(work.plan);
		check();
		if (result.status !== "completed" || !result.compresser?.attemptIds.includes(result.attemptId))
			throw Error("Historical result is not sealed");
		return snapshot(
			await change(id, check, (current) => {
				if (!current || current.fingerprint !== work.fingerprint) throw Error("Historical work changed");
				if (current.status === "published" || current.status === "retired" || current.retirement)
					return current;
				if (
					!result.compresser!.attemptIds.every((attempt) =>
						attempt.startsWith(hash([work.plan.id, work.fingerprint]).slice(0, 24)),
					)
				)
					throw Error("Historical attempt identity mismatch");
				return { ...current, status: "completed", result, pending: null };
			}),
		);
	};
	return Object.freeze<HistoricalWork>({
		lookup: async (id: string, check: () => void) => {
			const work = await lookup(id, check);
			check();
			return work ? snapshot(work) : null;
		},
		prepare: async (raw: HistoricalPlan, check: () => void) => {
			const plan = planInput(raw),
				fingerprint = hash(plan);
			check();
			await native.validate(plan, check);
			const prior = await lookup(plan.id, check);
			if (prior) {
				if (prior.fingerprint !== fingerprint) throw Error("Historical plan identity conflict");
				return snapshot(prior);
			}
			return snapshot(
				await change(plan.id, check, (work, policy) => {
					if (work) {
						if (work.fingerprint !== fingerprint) throw Error("Historical plan identity conflict");
						return work;
					}
					if (policy.pending.length >= limits.maxPending)
						throw Error("Historian unfinished capacity reached");
					policy.pending.push(plan.id);
					return {
						id: plan.id,
						plan,
						fingerprint,
						status: "planned",
						attempts: 0,
						result: null,
						pending: null,
						claim: null,
						publication: null,
					};
				}),
			);
		},
		recover,
		run: async (
			id: string,
			check: () => void,
			validateCall?: InferenceCallValidator,
			signal?: AbortSignal,
		) => {
			identity(id);
			let current = await lookup(id, check);
			if (!current) throw Error("Historical plan missing");
			if (current.status !== "planned")
				return current.status === "running" || current.status === "unknown"
					? recover(id, check)
					: snapshot(current);
			await native.validate(current.plan, check);
			const claim = randomUUID();
			current = await change(id, check, (work) => {
				if (!work) throw Error("Historical plan missing");
				return work.status === "planned" ? { ...work, status: "running", claim } : work;
			});
			if (current.claim !== claim) return recover(id, check);
			const fixed = current;
			try {
				const result = await native.run(
					fixed.plan,
					{
						check: () => {
							check();
							signal?.throwIfAborted();
						},
						begin: async () => {
							const updated = await change(id, check, (work, policy) => {
								if (
									!work ||
									work.claim !== claim ||
									work.status !== "running" ||
									work.pending ||
									work.attempts >= work.plan.maxCalls ||
									policy.used >= limits.maxAttempts
								)
									throw Error("Historical request allowance or execution claim refused");
								work.attempts++;
								policy.used++;
								work.pending = hash([work.plan.id, work.fingerprint]).slice(0, 24) + "-" + work.attempts;
								return work;
							});
							return updated.pending!;
						},
						complete: async (attemptId, output) => {
							const result = { ...output, attemptId };
							await change(id, check, (work) => {
								if (!work || work.claim !== claim || work.pending !== attemptId)
									throw Error("Historical attempt mismatch");
								return { ...work, result, pending: null };
							});
							return copy(result);
						},
					},
					validateCall,
					signal,
				);
				return snapshot(
					await change(id, check, (work) => {
						if (!work || work.claim !== claim) throw Error("Historical claim changed");
						if (work.status === "published" || work.status === "retired" || work.retirement) return work;
						return {
							...work,
							result,
							status:
								result.status === "completed"
									? "completed"
									: result.status === "quarantined"
										? "unknown"
										: "failed",
						};
					}),
				);
			} catch (error) {
				await change(id, check, (work) => {
					if (!work) throw error;
					return work.status === "running" ? { ...work, status: "unknown" } : work;
				}).catch(() => {});
				throw error;
			}
		},
		retire: async (id, rawDecision, rawTransaction, check) => {
			identity(id);
			const decision = copy(rawDecision),
				input = copy(rawTransaction),
				fingerprint = hash([decision, input]);
			if (
				typeof decision.reason !== "string" ||
				!decision.reason.trim() ||
				decision.reason.length > 2048 ||
				typeof decision.acknowledgeUnknown !== "boolean"
			)
				throw new Error("Invalid historical retirement decision");
			const [row, head] = await Promise.all([store.get(key(id), check), store.get(policyKey, check)]),
				work = workData(row.data),
				policy = policyData(head.data);
			if (!work || !policy) throw new Error("Historical plan missing");
			if (work.retirement) {
				if (work.retirement.fingerprint !== fingerprint)
					throw new Error("Historical retirement identity conflict");
				const receipt = await store.receipt(work.retirement.transactionId, check);
				if (!receipt) throw new Error("Retirement receipt unavailable");
				await native.retired(work.plan, check);
				check();
				return receipt;
			}
			if (work.status === "published" || native.active(work.plan))
				throw new Error("Live or published historical work cannot be retired");
			if (
				(work.status === "unknown" || work.status === "running" || work.pending) &&
				!decision.acknowledgeUnknown
			)
				throw new Error("Explicit acknowledgement of uncertain historical effects is required");
			if (policy.sessionId !== (await native.identity()))
				throw new Error("Original Historian Session required");
			if (
				input.reads.some((r) => r.key.startsWith("@historian:")) ||
				input.writes.some((r) => r.key.startsWith("@historian:")) ||
				input.freezeLegacy
			)
				throw new Error("Invalid historical retirement transaction");
			policy.pending = policy.pending.filter((p) => p !== id);
			const retired: Work = {
				...work,
				status: "retired",
				retirement: {
					fingerprint,
					transactionId: input.requestId,
					reason: decision.reason,
					previousStatus: work.status,
				},
			};
			const receipt = await store.commit(
				{
					...input,
					reads: [
						...input.reads,
						{ key: key(id), version: row.version },
						{ key: policyKey, version: head.version },
					],
					writes: [
						...input.writes,
						{ key: key(id), data: data(retired) },
						{ key: policyKey, data: data(policy) },
					],
					append: [
						...input.append,
						{
							stream: "@historian:retirements",
							data: {
								id,
								reason: decision.reason,
								previousStatus: work.status,
								acknowledgeUnknown: decision.acknowledgeUnknown,
								attempts: work.attempts,
							},
						},
					],
					work: [...(input.work ?? []), { key: key(id), state: null }],
				},
				() => {
					check();
					if (native.active(work.plan)) throw new Error("Historical execution became active");
				},
			);
			await native.retired(work.plan, check);
			check();
			return receipt;
		},
		publish: async (id: string, raw: RuntimeRecordsCommit, check: () => void) => {
			identity(id);
			const input = copy(raw),
				fingerprint = hash(input);
			const [row, head] = await Promise.all([store.get(key(id), check), store.get(policyKey, check)]);
			const work = workData(row.data),
				policy = policyData(head.data);
			if (!work || !policy) throw Error("Historical plan missing");
			if (work.status === "retired" || work.retirement)
				throw Error("Retired historical work is not publishable");
			if (work.publication) {
				if (work.publication.fingerprint !== fingerprint) throw Error("Historical publication conflict");
				const receipt = await store.receipt(work.publication.transactionId, check);
				if (!receipt) throw Error("Historical receipt unavailable");
				return receipt;
			}
			if (work.status !== "completed" || !work.result?.compresser || work.pending)
				throw Error("Historical result is not publishable");
			await native.validate(work.plan, check);
			if (
				!input.reads.some((r) => r.key === work.plan.target.key && r.version === work.plan.target.version) ||
				!input.writes.some((w) => w.key === work.plan.target.key) ||
				input.reads.some((r) => r.key.startsWith("@historian:")) ||
				input.writes.some((r) => r.key.startsWith("@historian:")) ||
				input.freezeLegacy
			)
				throw Error("Historical publication target mismatch");
			const sealed = await native.recover(work.plan);
			check();
			if (hash(sealed) !== hash(work.result)) throw Error("Historical sealed result changed");
			policy.pending = policy.pending.filter((p) => p !== id);
			const final: Work = {
				...work,
				status: "published",
				publication: { fingerprint, transactionId: input.requestId },
			};
			const transaction: RuntimeRecordsCommit = {
				...input,
				reads: [
					...input.reads,
					{ key: key(id), version: row.version },
					{ key: policyKey, version: head.version },
				],
				writes: [
					...input.writes,
					{ key: key(id), data: data(final) },
					{ key: policyKey, data: data(policy) },
				],
				append: [
					...input.append,
					{ stream: "@historian:adoptions", data: { id, resultDigest: hash(work.result) } },
				],
				work: [...(input.work ?? []), { key: key(id), state: null }],
			};
			return store.commit(transaction, check);
		},
	});
}
