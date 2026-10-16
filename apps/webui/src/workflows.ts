import { fileURLToPath } from "node:url";
import {
	createPocketFiles,
	createPocketHooks,
	type PocketHooksOptions,
	type PocketHooksClient,
	createPocketBrowser,
	type PocketBrowserOptions,
	type PocketBrowserClient,
	type PocketFilesOptions,
	type PocketFilesClient,
	type PocketApprovals,
	type PocketApproval,
	type PocketSchedule,
	type PocketScheduleInput,
	type PocketSchedulesPreparation,
	type PocketMemoryPreparation,
	type PocketMemoryClient,
} from "@pakka/server/pocket";
import type { ConversationRef } from "@pakka/agent";
import type { ExtensionService, PocketServiceContext } from "./backend.ts";

type BoundMethod<F> = F extends (ref: ConversationRef, ...args: infer A) => infer R
	? (...args: A) => R
	: never;
export type WorkspaceFilesClient = {
	readonly [K in keyof PocketFilesClient]: BoundMethod<PocketFilesClient[K]>;
};
export const workspaceFilesExtensionRoot = fileURLToPath(new URL("../contributions/files/", import.meta.url));

export const workspaceHooksExtensionRoot = fileURLToPath(new URL("../contributions/hooks/", import.meta.url));
/** Ordinary host-approved service: only raw external ingress authenticates outside Cookie/RPC. */
export async function workspaceHooksService(
	context: PocketServiceContext,
	options: Omit<PocketHooksOptions, "runtime" | "people" | "workspace">,
): Promise<ExtensionService<PocketHooksClient>> {
	const hooks = await createPocketHooks({
		...options,
		runtime: context.runtime,
		people: context.people,
		workspace: context.workspace,
	});
	const statuses = {
		accepted: 202,
		ignored: 200,
		unknown: 503,
		denied: 404,
		conflict: 409,
		capacity: 429,
	} as const;
	const service: ExtensionService<PocketHooksClient> = {
		permission: "read",
		bind(actor, target, check) {
			if (!target) throw Error("Webhook requires an explicit Conversation");
			return hooks.bind(actor, target, check);
		},
		ingress: {
			maxBytes: 5 * 1024 * 1024,
			timeoutMs: 10000,
			output: {
				type: "object",
				properties: {
					state: {
						enum: ["accepted", "ignored", "unknown", "denied", "conflict", "capacity"],
					},
					receiptId: { type: "string", maxLength: 160 },
				},
				required: ["state", "receiptId"],
			},
			handle: async (request) => {
				if (request.path.length < 1 || request.path.length > 2)
					return { status: 404, value: { state: "denied", receiptId: "" } };
				const result = await hooks.receive(
					{
						id: request.path[0]!,
						...(request.path.length === 2 ? { secret: request.path[1] } : {}),
						headers: request.headers,
						body: request.body,
					},
					request.check,
				);
				return {
					status: statuses[result.state],
					value: { state: result.state, receiptId: result.receipt?.id ?? "" },
				};
			},
		},
	};
	return Object.freeze(service);
}

export const workspaceMemoryExtensionRoot = fileURLToPath(
	new URL("../contributions/memory/", import.meta.url),
);
/** Ordinary service slot: current actor and exact resource are bound before every memory command. */
export async function workspaceMemoryService(
	context: PocketServiceContext,
	prepared: PocketMemoryPreparation,
): Promise<ExtensionService<PocketMemoryClient>> {
	const memory = await prepared.attach(context);
	const service: ExtensionService<PocketMemoryClient> = {
		permission: "read",
		bind(actor, target, check) {
			if (!target) throw Error("Memory requires a current Conversation");
			return memory.bind(actor, target, check);
		},
	};
	return Object.freeze(service);
}

export type WorkspaceSchedule = Omit<PocketSchedule, "target">;
export interface WorkspaceSchedulesClient {
	list(): Promise<readonly WorkspaceSchedule[]>;
	add(input: PocketScheduleInput): Promise<WorkspaceSchedule>;
	cancel(id: string): Promise<WorkspaceSchedule>;
}
export const workspaceSchedulesExtensionRoot = fileURLToPath(
	new URL("../contributions/schedules/", import.meta.url),
);
function scheduleView(row: PocketSchedule): WorkspaceSchedule {
	const { target: _target, ...value } = row;
	return Object.freeze(value);
}
/** Ordinary public service slot, with host waiters disposed separately from accepted native work. */
export async function workspaceSchedulesService(
	context: PocketServiceContext,
	prepared: PocketSchedulesPreparation,
): Promise<ExtensionService<WorkspaceSchedulesClient>> {
	const schedules = await prepared.attach(context);
	const registration: ExtensionService<WorkspaceSchedulesClient> = {
		permission: "read",
		dispose: () => schedules.dispose(),
		bind(actor, target, check) {
			if (!target) throw Error("Scheduled input requires a current Conversation");
			const client = schedules.bind(actor, check);
			return Object.freeze({
				list: async () => Object.freeze((await client.list(target)).map(scheduleView)),
				add: async (input: PocketScheduleInput) => scheduleView(await client.add(target, input)),
				cancel: async (id: string) => scheduleView(await client.cancel(target, id)),
			});
		},
	};
	return Object.freeze(registration);
}

export type WorkspaceBrowserClient = {
	readonly [K in keyof PocketBrowserClient]: BoundMethod<PocketBrowserClient[K]>;
};
export const workspaceBrowserExtensionRoot = fileURLToPath(
	new URL("../contributions/browser/", import.meta.url),
);
/** Only the host configures executable/origins. Product shutdown owns the allocated browser and network. */
export async function workspaceBrowserService(
	context: PocketServiceContext,
	options: Omit<PocketBrowserOptions, "runtime" | "people">,
): Promise<ExtensionService<WorkspaceBrowserClient>> {
	const browser = await createPocketBrowser({ ...options, runtime: context.runtime, people: context.people });
	const registration: ExtensionService<WorkspaceBrowserClient> = {
		permission: "read",
		dispose: () => browser.close(),
		bind(actor, target, check) {
			if (!target) throw Error("Browser requires a current Conversation");
			const bound = browser.bind(actor, check);
			const guarded = async <T>(action: () => Promise<T>): Promise<T> => {
				check();
				const value = await action();
				check();
				return value;
			};
			const client: WorkspaceBrowserClient = {
				snapshot: () => guarded(() => bound.snapshot(target)),
				frame: () => guarded(() => bound.frame(target)),
				navigate: (input) => guarded(() => bound.navigate(target, input)),
				click: (input) => guarded(() => bound.click(target, input)),
				fill: (input) => guarded(() => bound.fill(target, input)),
				receipt: (requestId) => guarded(() => bound.receipt(target, requestId)),
			};
			return Object.freeze(client);
		},
	};
	return Object.freeze(registration);
}

export const workspaceApprovalsExtensionRoot = fileURLToPath(
	new URL("../contributions/approvals/", import.meta.url),
);
export type WorkspaceApproval = Omit<PocketApproval, "ref" | "arguments"> & {
	readonly argumentsText: string;
};
export interface WorkspaceApprovalsClient {
	list(): Promise<readonly WorkspaceApproval[]>;
	decide(input: { readonly id: string; readonly allow: boolean }): Promise<WorkspaceApproval>;
}
function approvalView(row: PocketApproval): WorkspaceApproval {
	return Object.freeze({
		id: row.id,
		tool: row.tool,
		argumentsText: JSON.stringify(row.arguments),
		createdAt: row.createdAt,
		expiresAt: row.expiresAt,
		state: row.state,
		...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
	});
}
/** Bind only the current interface resource; decision authority is checked again by the native tool. */
export function workspaceApprovalsService(
	approvals: PocketApprovals,
): ExtensionService<WorkspaceApprovalsClient> {
	const registration: ExtensionService<WorkspaceApprovalsClient> = {
		permission: "read",
		bind(actor, target, check) {
			if (!target) throw Error("Approvals require a current Conversation");
			const bound = approvals.bind(actor, check);
			return Object.freeze({
				list: async () => {
					check();
					const rows = await bound.list(target);
					check();
					return Object.freeze(rows.map(approvalView));
				},
				decide: async (input: { readonly id: string; readonly allow: boolean }) => {
					check();
					let value = await bound.decide(target, input);
					// Keep the request/generation check live until this call has a recorded terminal outcome.
					while (value.state === "allowed" || value.state === "running") {
						await new Promise<void>((resolve) => setTimeout(resolve, 25));
						check();
						const current = (await bound.list(target)).find((row) => row.id === input.id);
						if (!current) throw Error("Unconfirmed approval outcome");
						value = current;
					}
					check();
					return approvalView(value);
				},
			});
		},
	};
	return Object.freeze(registration);
}

/** Opt-in, host-only composition. The bound generation check reaches the file effect boundary. */
export async function workspaceFilesService(
	context: PocketServiceContext,
	options: Omit<PocketFilesOptions, "runtime" | "people">,
): Promise<ExtensionService<WorkspaceFilesClient>> {
	const files = await createPocketFiles({ ...options, runtime: context.runtime, people: context.people });
	const registration: ExtensionService<WorkspaceFilesClient> = {
		permission: "read",
		bind(actor, target, check) {
			if (!target) throw Error("Files require a current Conversation");
			const bound = files.bind(actor, check);
			const guarded = async <T>(read: () => Promise<T>): Promise<T> => {
				check();
				const value = await read();
				check();
				return value;
			};
			const service: WorkspaceFilesClient = {
				roots: () => guarded(() => bound.roots(target)),
				list: (input) => guarded(() => bound.list(target, input)),
				read: (input) => guarded(() => bound.read(target, input)),
				export: (input) => guarded(() => bound.export(target, input)),
				write: (input) => guarded(() => bound.write(target, input)),
				upload: (input) => guarded(() => bound.upload(target, input)),
				changes: (input) => guarded(() => bound.changes(target, input)),
				diff: (input) => guarded(() => bound.diff(target, input)),
				branches: (input) => guarded(() => bound.branches(target, input)),
				switchBranch: (input) => guarded(() => bound.switchBranch(target, input)),
				worktrees: (input) => guarded(() => bound.worktrees(target, input)),
				addWorktree: (input) => guarded(() => bound.addWorktree(target, input)),
				removeWorktree: (input) => guarded(() => bound.removeWorktree(target, input)),
				receipt: (input) => guarded(() => bound.receipt(target, input)),
			};
			return Object.freeze(service);
		},
	};
	return Object.freeze(registration);
}
