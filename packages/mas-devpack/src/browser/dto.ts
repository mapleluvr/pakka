/** Browser-only DTOs. No native runtime, service capabilities, provider or Node types. */
export interface MemberRef {
	readonly key: string;
	readonly sessionId: string;
	readonly conversationId: string;
	readonly incarnation: string;
	readonly profile: string;
}
export const memberPhases = [
	"preparing",
	"ready",
	"active",
	"stopping",
	"retired",
	"failed",
	"unknown",
	"ended",
] as const;
export interface WorkbenchMember {
	readonly key: string;
	readonly ref: MemberRef;
	readonly owner: string | null;
	readonly parent: string | null;
	readonly creator: string | null;
	readonly creationKnown: boolean;
	readonly createdAt?: number;
	readonly forkSource: string | null;
	readonly lifetime: "persistent" | "temporary" | "task-bound" | "background";
	readonly phase: (typeof memberPhases)[number];
	readonly reason?: string;
	readonly permissions: readonly ("send" | "steer" | "manage")[];
}
export interface WorkbenchConnection {
	readonly id: string;
	readonly kind: "creation" | "communication";
	readonly from: string;
	readonly to: string;
	readonly count: number;
	readonly at?: number;
}
export interface WorkbenchView {
	readonly sessionId: string;
	readonly namespace: string;
	readonly members: readonly WorkbenchMember[];
	readonly connections: readonly WorkbenchConnection[];
	readonly connectionsTruncated: boolean;
}
export interface WorkbenchHistoryItem {
	readonly receipt: Pick<WorkbenchReceipt, "id" | "status" | "entryId">;
	readonly from: string | null;
	readonly to: string;
	readonly text: string;
	readonly mode: "prompt" | "steer" | "followUp";
	readonly at: number | null;
	readonly initiator: "agent" | "human" | "service" | "unknown";
	readonly replyTo: string | null;
}
export interface WorkbenchHistoryQuery {
	readonly limit?: number;
	readonly cursor?: string;
	readonly search?: string;
	readonly from?: string;
	readonly to?: string;
	readonly member?: string;
	readonly mode?: "prompt" | "steer" | "followUp";
	readonly initiator?: "agent" | "human" | "service" | "unknown";
	readonly status?: (typeof deliveryStatuses)[number];
}
export interface WorkbenchHistoryPage {
	readonly items: readonly WorkbenchHistoryItem[];
	readonly nextCursor?: string;
}
export interface WorkbenchActivity {
	readonly ref: MemberRef;
	readonly state: "waiting" | "thinking" | "tool" | "reply" | "error" | "crashed" | "idle";
	readonly preview: string;
	readonly tool?: string;
	readonly code?: number;
	readonly detail?: string;
}
export const deliveryStatuses = ["queued", "placed", "done", "unanswered", "unknown"] as const;
export interface WorkbenchReceipt {
	readonly id: string;
	readonly requestId: string;
	readonly principal: string;
	readonly source: MemberRef | null;
	readonly target: MemberRef;
	readonly status: (typeof deliveryStatuses)[number];
	readonly entryId?: string;
	readonly reason?: string;
}
