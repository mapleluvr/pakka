import type { ToolInvocationScope } from "@pakka/agent";
import type { MemoActor, MemoClient, MemoOptions, MemoRef, Receipt } from "./contracts.ts";
export interface ResearchDelivery {
	readonly id: string;
	readonly state: "queued" | "placed" | "done" | "unanswered" | "unknown";
}
export interface ResearchInput {
	readonly requestId: string;
	readonly text: string;
}
/** A host-bound original route. Inspection never calls admission or generates work. */
export interface ResearchDriver {
	readonly identity: Readonly<Record<string, unknown>>;
	check(): void;
	idle(check: () => void): Promise<boolean>;
	checkInvocation(scope: ToolInvocationScope): void;
	send(input: ResearchInput, check: () => void): Promise<ResearchDelivery>;
	lookup(input: ResearchInput, check: () => void): Promise<ResearchDelivery | null>;
	observe(receiptId: string, check: () => void): Promise<ResearchDelivery>;
	/** Same request on one live Runtime shares its original cancellation through settlement.
	 * Check authority before effects; a rejected call must have no delayed, unguarded effects.
	 * A new Runtime may retry the same request only while the original run still holds its slot. */
	cancel(requestId: string, check: () => void): Promise<void>;
}
export interface ResearchScope {
	readonly libraryId: string;
	readonly write: boolean;
}
export interface ResearchRequest {
	readonly requestId: string;
	readonly subject: string;
	readonly refs: readonly MemoRef[];
	readonly dueAt?: number;
}
export interface ResearchReceipt {
	readonly runId: string;
	readonly requestId: string;
	readonly actorId: string;
	readonly at: number;
}
export interface ResearchRun {
	readonly runId: string;
	readonly librarianId: string;
	readonly actorId: string;
	readonly subject: string;
	readonly refs: readonly MemoRef[];
	readonly dueAt: number;
	readonly createdAt: number;
	readonly state: "queued" | "dispatching" | "waiting" | "unknown" | "completed" | "cancelled";
	readonly cancelRequested: boolean;
	/** Native execution remains bound to this run until cancellation/idle is confirmed. */
	readonly executionHeld: boolean;
	readonly deliveryId: string | null;
	readonly deliveryState: ResearchDelivery["state"] | null;
	readonly finishedAt: number | null;
	readonly publications: readonly Receipt[];
}
export interface PatchouliClient {
	request(input: ResearchRequest): Promise<ResearchReceipt>;
	get(runId: string): Promise<ResearchRun>;
	setEnabled(enabled: boolean): Promise<void>;
	/** Explicit execution/reconciliation of one due or active run. Never inferred from open/get. */
	advance(): Promise<void>;
	cancel(runId: string): Promise<void>;
	/** Start a process-local wake loop under this current manager lease; reopening does not restart it. */
	start(intervalMs?: number): () => void;
}
export interface PatchouliOptions extends MemoOptions {
	readonly id: string;
	readonly actorId: string;
	readonly scope: readonly ResearchScope[];
	readonly driver: ResearchDriver;
	readonly maxPending?: number;
	readonly maxPublications?: number;
	/** Host-bound request/read/control policy for the entire research context, including private inputs. */
	readonly authorize: (actorId: string, action: "request" | "read" | "control") => void;
}
export interface PatchouliService {
	connect(actor: MemoActor): PatchouliClient;
	knowledgeForInvocation(scope: ToolInvocationScope): MemoClient;
	finish(scope: ToolInvocationScope, input: { readonly runId: string }): Promise<ResearchRun>;
	/** Same-service, exact completion result. Recheck synchronously after a consumer awaits it;
	 * lost publication authority does not undo the completed run. */
	publicationCheck(result: ResearchRun): () => void;
	close(): void;
}
