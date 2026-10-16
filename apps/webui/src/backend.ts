import type { ConversationRef, RuntimeJobReceipt, DisplayReceipt, Runtime } from "@pakka/agent";
import type {
	PocketPerson,
	PocketInputReceipt,
	PocketPeople,
	PocketWorkspace,
	PocketNotifications,
} from "@pakka/server/pocket";
import type {
	ExtensionJson,
	ExtensionCall,
	ExtensionOperation,
	ExtensionOperationRequest,
	ExtensionRegistration,
	ExtensionPermission,
	Schema,
} from "./extension.ts";

/** Trusted product-service binding, isolated from executable/router and browser imports. */
export interface PocketServiceContext {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly workspace: PocketWorkspace;
	/** Trusted event producer only; frontend handlers receive no publication or recipient-selection port. */
	readonly notifications?: PocketNotifications;
	/** Original product owner identity; descriptive, never an authorization. */
	readonly ownerId: string;
}

export interface ExtensionSetting {
	readonly version: number;
	readonly value: ExtensionJson;
}
export interface ExtensionSettings {
	get(key: string, scope?: "user" | "resource" | "global"): Promise<ExtensionSetting>;
	compareAndSet(
		key: string,
		expectedVersion: number,
		value: ExtensionJson,
		scope?: "user" | "resource" | "global",
	): Promise<ExtensionSetting>;
}
export interface BackendContext {
	readonly person: PocketPerson;
	readonly target?: ConversationRef;
	readonly requestId: string;
	readonly signal: AbortSignal;
	readonly settings: ExtensionSettings;
	/** Current identity, declared permission, resource incarnation and registration. Call after awaited preparation. */
	check(): void;
	display(kind: "chat" | "card", text: string): Promise<DisplayReceipt>;
	/** Only actions explicitly declaring a model effect can submit input. */
	submit(input: {
		readonly text: string;
		readonly mode: "prompt" | "steer" | "followUp";
	}): Promise<PocketInputReceipt>;
	/** Only host-approved, manifest-declared services are resolvable; no ambient runtime/configuration. */
	service<T extends object = object>(name: string): T;
	readonly jobs: {
		start(definition: string, payload: { readonly [key: string]: ExtensionJson }): Promise<RuntimeJobReceipt>;
		receipt(id: string): Promise<RuntimeJobReceipt>;
	};
}
export interface BackendModule {
	readonly actions: Readonly<
		Record<string, (context: BackendContext, input: ExtensionJson) => ExtensionJson | Promise<ExtensionJson>>
	>;
}
/** An inert declaration, not an installation or authorization. */
export function defineBackend(module: BackendModule): BackendModule {
	return Object.freeze(module);
}
export interface ExtensionIngressRequest {
	readonly path: readonly string[];
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Uint8Array;
	readonly signal: AbortSignal;
	/** Check backend generation and cancellation immediately before a controlled effect. */
	check(): void;
}
export interface ExtensionIngressResponse {
	readonly status: 200 | 202 | 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503;
	readonly value: ExtensionJson;
}
export interface ExtensionIngress {
	readonly maxBytes: number;
	readonly timeoutMs: number;
	readonly output: Schema;
	/** Authenticates its own external sender; receives no browser authority or native HTTP objects. */
	handle(request: ExtensionIngressRequest): Promise<ExtensionIngressResponse>;
}
export interface ExtensionIngressRoute {
	readonly maxBytes: number;
	handle(request: Omit<ExtensionIngressRequest, "check">): Promise<ExtensionIngressResponse>;
}
export interface ExtensionHost {
	/** Trusted HTTP adapter only. Neither Cookie RPC nor browser clients expose this port. */
	ingress(extension: string, service: string): ExtensionIngressRoute;
	list(
		actor: import("@pakka/server/pocket").PocketAuthority,
		target?: ConversationRef,
	): readonly ExtensionRegistration[];
	call(
		actor: import("@pakka/server/pocket").PocketAuthority,
		input: ExtensionCall,
		signal?: AbortSignal,
	): Promise<ExtensionOperation>;
	operation(actor: import("@pakka/server/pocket").PocketAuthority, id: string): Promise<ExtensionOperation>;
	/** Read original operation without re-entering a handler or accepting a caller-supplied actor. */
	operationByRequest(
		actor: import("@pakka/server/pocket").PocketAuthority,
		request: ExtensionOperationRequest,
	): Promise<ExtensionOperation>;
	setEnabled(
		actor: import("@pakka/server/pocket").PocketAuthority,
		id: string,
		enabled: boolean,
	): Promise<void>;
	/** Re-prepare an already-approved source. Browser cannot select a path or module. */
	reload(actor: import("@pakka/server/pocket").PocketAuthority, id: string): Promise<void>;
	asset(
		actor: import("@pakka/server/pocket").PocketAuthority,
		id: string,
		generation: string,
		path: string,
		target?: ConversationRef,
	): Promise<{ readonly type: string; readonly body: Uint8Array }>;
}
export interface ExtensionService<T extends object = object> {
	/** Opt-in route under this service's manifest-declared backend extension. */
	readonly ingress?: ExtensionIngress;
	/** Optional host-resource cleanup; invoked once on product close or failed registration. No member/work cancellation is implied. */
	dispose?(): Promise<void>;
	readonly permission: ExtensionPermission;
	bind(
		actor: import("@pakka/server/pocket").PocketAuthority,
		target: ConversationRef | undefined,
		check: () => void,
	): T;
}
