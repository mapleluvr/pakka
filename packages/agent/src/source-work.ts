import type { InferenceResult, JsonValue, SourceWorkCheckpoint } from "./types.ts";

/** Persisted data identities. Current execution authority is revalidated separately. */
export interface StoredSourceWork {
	readonly namespace: string;
	readonly jobId: string;
	readonly planId: string;
	readonly sessionId: string;
	readonly durableSessionId?: string;
	readonly conversationId?: string;
	readonly strategyId: string;
	readonly principal: string;
	readonly originLeaseId: string;
	readonly sources: readonly (readonly [string, string])[];
	readonly targetEntryIds: readonly string[];
	readonly maxCalls: number;
	readonly requireArtifactReceipt: boolean;
	readonly metadata: JsonValue;
	readonly stage: "planned" | "ready" | "reserved" | "resultStored" | "completed" | "adopted" | "quarantined";
	readonly checkpoint: JsonValue | null;
	readonly retryAtMs: number | null;
	readonly attemptIds: readonly string[];
	readonly pendingAttempt: string | null;
	readonly requestHash: string | null;
	readonly mode: "single" | "conversation" | null;
	readonly result: InferenceResult | null;
	readonly resultDigest: string | null;
	readonly sealed: boolean;
	readonly adoption: null | { readonly transactionId: string; readonly artifactVersion: number };
}

/** Fixed inputs bind the mutable work document to its append-only planning proof. */
export function sourceWorkPlan(work: StoredSourceWork): JsonValue {
	return {
		jobId: work.jobId,
		planId: work.planId,
		sessionId: work.sessionId,
		...(work.durableSessionId === undefined ? {} : { durableSessionId: work.durableSessionId }),
		...(work.conversationId === undefined ? {} : { conversationId: work.conversationId }),
		strategyId: work.strategyId,
		principal: work.principal,
		originLeaseId: work.originLeaseId,
		sources: work.sources.map(([id, fingerprint]) => [id, fingerprint]),
		targetEntryIds: [...work.targetEntryIds],
		maxCalls: work.maxCalls,
		requireArtifactReceipt: work.requireArtifactReceipt,
		metadata: work.metadata,
	};
}

/** Created only by identity-bound host code; never accepted as artifact record instructions. */
export type SourceWorkMutation =
	| { readonly type: "plan"; readonly work: StoredSourceWork }
	| {
			readonly type: "reserve";
			readonly jobId: string;
			readonly attemptId: string;
			readonly requestHash: string;
			readonly mode: "single" | "conversation";
	  }
	| {
			readonly type: "result";
			readonly jobId: string;
			readonly result: InferenceResult;
			readonly sealed: boolean;
	  }
	| { readonly type: "seal"; readonly jobId: string; readonly result: InferenceResult }
	| {
			readonly type: "adopt";
			readonly jobId: string;
			readonly transactionId: string;
			readonly artifactVersion: number;
			readonly checkpoint?: SourceWorkCheckpoint;
	  }
	| { readonly type: "quarantine"; readonly jobId: string };
