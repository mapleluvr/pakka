import type {
	ArtifactHistoryReference,
	CompresserSession,
	CompresserSnapshot,
	ConversationRef,
	InferenceCallValidator,
	InferenceRequest,
	InferenceResult,
	RuntimeRecordsCommit,
	RuntimeRecordsReceipt,
} from "./types.ts";

/** Separate native container; snapshot lists unfinished children only. */
export interface HistorianSession extends CompresserSession {
	snapshot(): Promise<CompresserSnapshot>;
}
export interface HistoricalWorkOptions {
	readonly namespace: string;
	readonly session: HistorianSession;
	readonly maxPending: number;
	/** Explicit total request allowance; reopening never resets used requests. */
	readonly maxAttempts: number;
}
export interface HistoricalPlan {
	readonly id: string;
	readonly source: ConversationRef;
	readonly strategyId: string;
	readonly artifacts: readonly ArtifactHistoryReference[];
	readonly target: { readonly key: string; readonly version: number };
	readonly maxCalls: number;
	readonly request: InferenceRequest;
}
export interface HistoricalWorkSnapshot {
	readonly id: string;
	readonly status: "planned" | "running" | "completed" | "failed" | "unknown" | "published" | "retired";
	readonly attempts: number;
	readonly result: InferenceResult | null;
}
export interface HistoricalWork {
	prepare(plan: HistoricalPlan, check: () => void): Promise<HistoricalWorkSnapshot>;
	lookup(id: string, check: () => void): Promise<HistoricalWorkSnapshot | null>;
	run(
		id: string,
		check: () => void,
		validateCall?: InferenceCallValidator,
		signal?: AbortSignal,
	): Promise<HistoricalWorkSnapshot>;
	recover(id: string, check: () => void): Promise<HistoricalWorkSnapshot>;
	/** Explicit administrative disposition; does not refund attempts or erase uncertain results. */
	retire(
		id: string,
		decision: { readonly reason: string; readonly acknowledgeUnknown: boolean },
		transaction: RuntimeRecordsCommit,
		check: () => void,
	): Promise<RuntimeRecordsReceipt>;
	/** One business transaction adopts the exact sealed result and writes the Book + intake checkpoint. */
	publish(id: string, transaction: RuntimeRecordsCommit, check: () => void): Promise<RuntimeRecordsReceipt>;
}
