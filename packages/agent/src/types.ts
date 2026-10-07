export type Hook = "real_context.write" | "context_artifacts.write";
export type Grant = Hook | "input.submit" | "branch.control";
export type InputMode = "prompt" | "steer" | "followUp";
export type ReceiptState =
	| "reserved"
	| "queued"
	| "consumed"
	| "committed"
	| "handled"
	| "released"
	| "unknown";
export type Capability = object;
export interface Receipt {
	readonly id: string;
	readonly key: string;
	readonly principal: string;
	readonly sessionId: string;
	readonly branchId: string;
	readonly attempt: number;
	readonly state: ReceiptState;
	readonly entryId?: string;
	readonly reason?: string;
}
export interface View {
	readonly phase: "ready" | "transitioning" | "failed" | "disposed";
	readonly busy: boolean;
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly branchId: string;
	readonly epoch: number;
	readonly generation: number;
	readonly leafId: string | null;
	readonly entries: readonly { id: string; type: string; role?: string; text?: string }[];
	readonly context: readonly { role: string; text: string }[];
	readonly autoCompaction: boolean;
	readonly lastError?: string;
	readonly effects: "not-assessed" | "unknown";
}
export type Proposal =
	| { type: "cut"; summary: string; firstKeptEntryId: string | null; tokensBefore: number }
	| { type: "edit"; targetId: string; text: string | null };
export type Decision =
	| { readonly status: "committed"; readonly entryId: string }
	| { readonly status: "denied"; readonly reason: string }
	| { readonly status: "unknown"; readonly reason: string };
export type Policy = (
	request: Readonly<{ principal: string; proposal: Proposal }>,
) => boolean | Promise<boolean>;
export interface Client {
	view(): View;
	capture(): Capability;
	activateStrategy(spec: { id: string; hooks: readonly Hook[] }): void;
	deactivateStrategy(id: string): void;
	setPolicy(policy: Policy): void;
	commit(at: Capability, proposal: Proposal): Promise<Decision>;
	submit(input: { key: string; text: string; mode?: InputMode; at?: Capability }): Promise<Receipt>;
	receipt(id: string): Receipt | undefined;
	cancelQueued(): readonly Receipt[];
	branch(at: Capability, entryId: string): void;
}
export type HostEvent =
	| { readonly type: "receipt"; readonly receipt: Receipt }
	| { readonly type: "state"; readonly phase: View["phase"] };
export interface Host {
	connect(id: string, grants: readonly Grant[]): Client;
	view(): View;
	subscribe(listener: (event: HostEvent) => void): () => void;
	waitForIdle(): Promise<View>;
	reload(): Promise<void>;
	newSession(): Promise<void>;
	dispose(): Promise<void>;
}
export interface HostOptions {
	cwd: string;
	dataDir: string;
	endpoint: string;
	model: string;
	apiKey: string;
	systemPrompt?: string;
	steeringMode?: "all" | "one-at-a-time";
	prepareInput?: (
		input: Readonly<{ principal: string; text: string; mode: InputMode }>,
	) => Promise<{ action: "handled" } | { action: "text"; text: string }>;
	tools?: readonly {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
		execute(args: Record<string, unknown>, signal: AbortSignal | undefined): Promise<string>;
	}[];
}
