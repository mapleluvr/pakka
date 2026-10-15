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
	readonly lifetime: "persistent" | "temporary" | "task-bound" | "background";
	readonly phase: (typeof memberPhases)[number];
	readonly reason?: string;
	readonly permissions: readonly ("send" | "steer" | "manage")[];
}
export interface WorkbenchView {
	readonly namespace: string;
	readonly members: readonly WorkbenchMember[];
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
