import type { ConversationRef, DeliveryReceipt, RuntimeStore } from "@pakka/agent";
import type { MasView, MemberSpec, SendSpec } from "./types.ts";

export interface BrokerAgentRef {
	readonly key: string;
	readonly placement: string;
	readonly sessionId: string;
	readonly conversation: ConversationRef;
}
export interface PlacementSpec {
	readonly key: string;
	readonly placement: string;
	readonly owner: string;
	readonly profile?: string;
}
export interface RelayEnvelope {
	readonly id: string;
	readonly principal: string;
	readonly source: BrokerAgentRef | null;
	readonly target: BrokerAgentRef;
	readonly input: SendSpec;
}
/** Trusted transport port; never hand this or the placement opener to business tools. */
export interface SessionEndpoint {
	view(): Promise<{
		readonly sessionId: string;
		readonly isolation: "in-process" | "worker";
		readonly mas: MasView;
	}>;
	prepare(members: readonly MemberSpec[]): Promise<MasView>;
	activate(): Promise<MasView>;
	deliver(envelope: RelayEnvelope, signal?: AbortSignal): Promise<DeliveryReceipt>;
	receipt(envelope: RelayEnvelope, nativeId: string): Promise<DeliveryReceipt>;
	wait(envelope: RelayEnvelope, nativeId: string): Promise<DeliveryReceipt>;
}
export interface SessionPlacement {
	/** Must reconcile the same manager slot; ambiguous creation cannot allocate a replacement. */
	open(expectedSessionId?: string): Promise<SessionEndpoint>;
}
export interface BrokerReceipt {
	readonly id: string;
	readonly requestId: string;
	readonly principal: string;
	readonly source: BrokerAgentRef | null;
	readonly target: BrokerAgentRef;
	readonly status: "pending" | "queued" | "placed" | "done" | "unanswered" | "unknown";
	readonly native?: DeliveryReceipt;
	readonly reason?: string;
}
export interface BrokerView {
	readonly reason?: string;
	readonly phase: "preparing" | "ready" | "active" | "unknown";
	readonly members: readonly { readonly spec: PlacementSpec; readonly ref?: BrokerAgentRef }[];
	readonly deliveries: readonly BrokerReceipt[];
}
export interface BrokerClient {
	discover(): Promise<readonly BrokerAgentRef[]>;
	send(target: BrokerAgentRef, input: SendSpec): Promise<BrokerReceipt>;
	reply(receiptId: string, input: SendSpec): Promise<BrokerReceipt>;
	receipt(id: string): Promise<BrokerReceipt>;
	wait(id: string): Promise<BrokerReceipt>;
}
export interface BrokerOptions {
	readonly namespace: string;
	readonly store: RuntimeStore;
	readonly maxMembers: number;
	readonly maxMessages: number;
	readonly placements: Readonly<Record<string, SessionPlacement>>;
}
export interface Broker {
	bootstrap(plan: readonly PlacementSpec[]): Promise<BrokerView>;
	activate(): Promise<BrokerView>;
	view(): Promise<BrokerView>;
	connect(spec: {
		readonly principal: string;
		readonly source: BrokerAgentRef | null;
		readonly grants: readonly ("discover" | "send" | "reply")[];
	}): BrokerClient;
	revoke(principal: string): void;
}
