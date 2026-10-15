import type { AgentRef } from "@pakka/protocol/pocket";
import type { ExtensionJson, ExtensionOperation } from "./extension.ts";

/** Bound to one open interface/generation. Host invalidates callbacks and reads on close/replacement. */
export interface WebInterfaceContext {
	readonly extension: string;
	readonly generation: string;
	readonly instanceId: string;
	readonly person: { readonly id: string; readonly name: string; readonly role: string };
	readonly target?: AgentRef;
	readonly signal: AbortSignal;
	call(
		action: string,
		input: ExtensionJson,
		options?: { readonly requestId?: string },
	): Promise<ExtensionOperation>;
	operation(id: string): Promise<ExtensionOperation>;
	/** Checked read snapshots only. Unmount ends observation, never admitted work. */
	subscribe(
		action: string,
		input: ExtensionJson,
		receive: (value: ExtensionJson) => void,
		options?: { readonly intervalMs?: number },
	): () => void;
	notice(text: string): void;
	open(interfaceId: string): void;
	navigate(target: AgentRef): void;
	close(): void;
}
export interface WebInterfaceProps {
	readonly context: WebInterfaceContext;
}
