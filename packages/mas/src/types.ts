import type {
	CatalogOptions,
	ConversationRef,
	DeliveryReceipt,
	InputMode,
	MemberLifetime,
	Runtime,
	ToolInvocationScope,
} from "@pakka/agent";
export type { ConversationRef as AgentRef, DeliveryReceipt, MemberLifetime } from "@pakka/agent";

export type MasGrant =
	| "discover"
	| "send"
	| "reply"
	| "observe"
	| "spawn"
	| "steer"
	| "abort"
	| "retire"
	| "configure"
	| "fork";
export type MemberPhase =
	| "preparing"
	| "ready"
	| "active"
	| "stopping"
	| "retired"
	| "failed"
	| "unknown"
	| "ended";
export interface Member {
	readonly key: string;
	readonly ref: ConversationRef;
	readonly owner: string;
	readonly lifetime: MemberLifetime;
	readonly phase: MemberPhase;
	readonly reason?: string;
}
export interface MasView {
	readonly namespace: string;
	readonly version: number;
	readonly phase: MemberPhase;
	readonly members: readonly Member[];
}
export interface MemberSpec {
	readonly key: string;
	readonly owner: string;
	readonly profile?: string;
	readonly lifetime?: MemberLifetime;
}
export interface SendSpec {
	readonly requestId: string;
	readonly text: string;
	readonly mode?: InputMode;
}
export interface MasClient {
	/** Serializable identity is descriptive only; the bound closures carry authority. */
	readonly identity: { readonly principal: string; readonly source: ConversationRef | null };
	inbox(): Promise<readonly DeliveryReceipt[]>;
	/** Check an already-held grant without effects; this never grants new authority. */
	authorize(action: MasGrant): void;
	/** Narrow an existing lease; original checks survive every further binding. */
	withAuthority(check: () => void): MasClient;
	discover(): readonly Member[];
	inspect(ref: ConversationRef): Promise<Member>;
	send(target: ConversationRef, input: SendSpec): Promise<DeliveryReceipt>;
	reply(receiptId: string, input: SendSpec): Promise<DeliveryReceipt>;
	receipt(id: string): Promise<DeliveryReceipt>;
	wait(id: string, signal?: AbortSignal): Promise<DeliveryReceipt>;
	withdraw(id: string): Promise<DeliveryReceipt>;
	spawn(spec: Omit<MemberSpec, "owner">): Promise<Member>;
	abort(ref: ConversationRef): Promise<Member>;
	retire(ref: ConversationRef): Promise<Member>;
	configure(ref: ConversationRef, profile: string): Promise<Member>;
	fork(ref: ConversationRef, spec: { readonly key: string; readonly entryId: string }): Promise<Member>;
	/** Exact live native invocation; copying/serialization or a peer scope never grants authority. */
	forInvocation(scope: ToolInvocationScope): MasClient;
}
export interface Admission {
	readonly principal: string;
	readonly source: ConversationRef | null;
	readonly target: Member;
	readonly input: SendSpec;
}
export interface MasOptions extends CatalogOptions {
	readonly runtime: Runtime;
}
/** Trusted composition root; do not expose connect/revoke/activation to business tools. */
export interface Mas {
	bootstrap(members: readonly MemberSpec[]): Promise<MasView>;
	activate(): Promise<MasView>;
	view(): Promise<MasView>;
	connect(spec: {
		readonly principal: string;
		readonly source: ConversationRef | null;
		readonly grants: readonly MasGrant[];
	}): MasClient;
	revoke(principal: string): void;
	setAdmission(policy: (request: Admission) => boolean | Promise<boolean>): void;
}
