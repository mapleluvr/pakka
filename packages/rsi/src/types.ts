import type { ConversationRef } from "@pakka/agent";

export type TicketState = "open" | "active" | "waiting" | "closed";
export type TicketRole = "reader" | "submitter" | "handler" | "manager";
export interface TicketActor {
	readonly id: string;
	/** Trusted current role resolver. Returning null withdraws access. */
	role(): TicketRole | null;
	check(): void;
}
export interface TicketContent {
	readonly title: string;
	readonly body: string;
	readonly sources: readonly string[];
}
export interface TicketRevision extends TicketContent {
	readonly revision: number;
	readonly actorId: string;
	readonly at: number;
}
export interface TicketHandler {
	readonly id: string;
	readonly label: string;
	readonly actorId: string;
}
export interface TicketEvent {
	readonly version: number;
	readonly actorId: string;
	readonly at: number;
	readonly kind: "submitted" | "edited" | "assigned" | "reported" | "dispatched" | "observed";
	readonly state: TicketState;
	readonly text: string;
	readonly links: readonly string[];
}
export interface TicketRoute {
	readonly handlerId: string;
	readonly target: ConversationRef;
	readonly source: ConversationRef | null;
	readonly principal: string;
}
export interface TicketDelivery {
	readonly id: string;
	readonly state: "queued" | "placed" | "done" | "unanswered" | "unknown";
}
export interface TicketDispatcher {
	plan(handlerId: string): TicketRoute;
	send(
		route: TicketRoute,
		input: { readonly requestId: string; readonly text: string },
		check: () => void,
	): Promise<TicketDelivery>;
	observe(route: TicketRoute, receiptId: string, check: () => void): Promise<TicketDelivery>;
}
export interface TicketRun {
	readonly route: TicketRoute;
	readonly id: string;
	readonly handlerId: string;
	readonly contentRevision: number;
	readonly actorId: string;
	readonly at: number;
	readonly requestId: string;
	readonly state: "pending" | "queued" | "placed" | "done" | "unanswered" | "unknown";
	readonly receiptId: string | null;
}
export interface Ticket extends TicketContent {
	readonly id: string;
	readonly authorId: string;
	readonly version: number;
	readonly contentRevision: number;
	readonly state: TicketState;
	readonly handler: TicketHandler | null;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly revisions: readonly TicketRevision[];
	readonly events: readonly TicketEvent[];
	readonly runs: readonly TicketRun[];
}
export interface TicketPermissions {
	readonly edit: boolean;
	readonly report: boolean;
	readonly assign: boolean;
	readonly dispatch: boolean;
}
export interface TicketView {
	readonly ticket: Ticket;
	readonly permissions: TicketPermissions;
}
export interface TicketReceipt {
	readonly requestId: string;
	readonly id: string;
	readonly version: number;
	readonly contentRevision: number;
	readonly state: TicketState;
	readonly runId: string | null;
}
export interface TicketSummary {
	readonly id: string;
	readonly title: string;
	readonly authorId: string;
	readonly state: TicketState;
	readonly version: number;
	readonly updatedAt: number;
	readonly handler: TicketHandler | null;
}
export interface TicketPage {
	readonly items: readonly TicketSummary[];
	readonly cursor: string | null;
}
export interface TicketQuery {
	readonly state?: TicketState;
	readonly mine?: boolean;
	readonly cursor?: string;
	readonly limit?: number;
}
export interface TicketMutation {
	readonly requestId: string;
	readonly id: string;
	readonly expectedVersion: number;
}
export interface TicketClient {
	readonly actorId: string;
	submit(input: TicketContent & { readonly requestId: string }): Promise<TicketReceipt>;
	edit(input: TicketContent & TicketMutation): Promise<TicketReceipt>;
	get(id: string): Promise<TicketView>;
	list(query?: TicketQuery): Promise<TicketPage>;
	lookup(requestId: string): Promise<TicketReceipt | null>;
	assign(input: TicketMutation & { readonly handlerId: string | null }): Promise<TicketReceipt>;
	report(
		input: TicketMutation & {
			readonly state: TicketState;
			readonly text: string;
			readonly links: readonly string[];
		},
	): Promise<TicketReceipt>;
	dispatch(input: TicketMutation): Promise<TicketReceipt>;
	refresh(input: { readonly id: string; readonly runId: string }): Promise<TicketView>;
	capabilities(): {
		readonly submit: boolean;
		readonly manage: boolean;
		readonly dispatch: boolean;
		readonly handlers: readonly TicketHandler[];
	};
	/** Compose with an existing lease; does not replace the original authority. */
	withAuthority(check: () => void): TicketClient;
}
export interface TicketService {
	/** Trusted composition only. Do not expose this factory through RPC or model tools. */
	connect(actor: TicketActor): TicketClient;
}
export type TicketErrorCode = "invalid" | "denied" | "conflict" | "capacity" | "unknown";
export class TicketError extends Error {
	readonly code: TicketErrorCode;
	constructor(code: TicketErrorCode, message: string) {
		super(message);
		this.name = "TicketError";
		this.code = code;
	}
}
