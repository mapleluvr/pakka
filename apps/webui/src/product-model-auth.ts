import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface ProductModelAuthority {
	readonly id: string;
	readonly check: () => void;
	readonly signal?: AbortSignal;
	/** Optional ownership transfer for the prepared asynchronous operation only. */
	readonly release?: () => void;
}
export interface ProductProvider {
	readonly id: string;
	readonly name: string;
	readonly configured: boolean;
	readonly source?: string;
	readonly methods: readonly { readonly type: AuthType; readonly name: string }[];
}
type PromptView<T = AuthPrompt> = T extends AuthPrompt ? Omit<T, "signal"> & { readonly id: string } : never;
export interface ProductAuthFlow {
	readonly id: string;
	readonly provider: string;
	readonly type: AuthType;
	readonly phase: "prepared" | "running" | "waiting" | "complete" | "cancelled" | "unconfirmed";
	readonly prompt?: PromptView;
	/** Only delivered to the originating login through private, uncached requests. */
	readonly events: readonly AuthEvent[];
}
export interface ProductAuthControl {
	providers(): readonly ProductProvider[];
	/** Preparation has no provider/auth write effects; start requires this existing identity. */
	prepare(provider: string, type: AuthType): ProductAuthFlow;
	start(id: string): ProductAuthFlow;
	state(id: string): ProductAuthFlow;
	answer(id: string, promptId: string, value: string): void;
	cancel(id: string): ProductAuthFlow;
	logout(provider: string): Promise<void>;
}
function detached<T>(value: T): T {
	const result = structuredClone(value);
	function freeze(item: unknown): void {
		if (!item || typeof item !== "object") return;
		for (const child of Object.values(item)) freeze(child);
		Object.freeze(item);
	}
	freeze(result);
	return result;
}
const finalPhase = (phase: ProductAuthFlow["phase"]) =>
	["complete", "cancelled", "unconfirmed"].includes(phase);

type Flow = {
	view: {
		id: string;
		provider: string;
		type: AuthType;
		phase: ProductAuthFlow["phase"];
		prompt?: PromptView;
		events: AuthEvent[];
	};
	authority: ProductModelAuthority;
	controller: AbortController;
	signal: AbortSignal;
	timer: ReturnType<typeof setTimeout>;
	answer?: (value: string) => void;
	released: boolean;
};

/** Uses the native authentication/storage implementation, never a parallel credential schema. */
export function createProductAuth(options: {
	runtime(): ModelRuntime | undefined;
	signal: AbortSignal;
	changed(): void;
	getDeviceId(): string;
}) {
	const flows = new Map<string, Flow>();
	const work = new Set<Promise<unknown>>();
	let closed = false;
	function check(authority: ProductModelAuthority) {
		if (closed || options.signal.aborted || authority.signal?.aborted)
			throw new Error("Model authority unavailable");
		authority.check();
	}
	function native() {
		const value = options.runtime();
		if (!value) throw new Error("Native model configuration unavailable");
		return value;
	}
	function release(flow: Flow) {
		if (flow.released) return;
		flow.released = true;
		flow.authority.release?.();
	}
	function forget(flow: Flow) {
		clearTimeout(flow.timer);
		flow.controller.abort();
		release(flow);
		flows.delete(flow.view.id);
	}
	function tracked<T>(task: Promise<T>): Promise<T> {
		work.add(task);
		void task.then(
			() => work.delete(task),
			() => work.delete(task),
		);
		return task;
	}
	function liveSignal(authority: ProductModelAuthority) {
		check(authority);
		if (!authority.signal) throw new Error("Native authentication requires live authorization");
		return AbortSignal.any([authority.signal, options.signal]);
	}
	function bounded(value: unknown) {
		if (Buffer.byteLength(JSON.stringify(value), "utf8") > 8192)
			throw new Error("Authentication prompt exceeds private transport capacity");
	}
	async function run(flow: Flow) {
		const { view, signal } = flow;
		try {
			check(flow.authority);
			await native().login(
				view.provider,
				view.type,
				{
					signal,
					notify: (event) => {
						check(flow.authority);
						signal.throwIfAborted();
						bounded(event);
						view.events.push(detached(event));
						if (view.events.length > 8) view.events.shift();
					},
					prompt: async (prompt) => {
						check(flow.authority);
						const promptSignal = prompt.signal ? AbortSignal.any([signal, prompt.signal]) : signal;
						promptSignal.throwIfAborted();
						const { signal: _signal, ...data } = prompt;
						bounded(data);
						if (view.prompt) throw new Error("Concurrent native authentication prompts are not supported");
						const id = randomUUID();
						view.prompt = detached({ ...data, id });
						view.phase = "waiting";
						return new Promise<string>((resolve, reject) => {
							const cleanup = () => {
								promptSignal.removeEventListener("abort", abort);
								delete flow.answer;
								delete view.prompt;
								if (view.phase === "waiting") view.phase = "running";
							};
							const abort = () => {
								cleanup();
								reject(new Error("Native authentication prompt cancelled"));
							};
							flow.answer = (value) => {
								cleanup();
								resolve(value);
							};
							promptSignal.addEventListener("abort", abort, { once: true });
						});
					},
				},
				{ agentName: "pakka", getDeviceId: options.getDeviceId },
			);
			// Native login includes credential persistence and availability synchronization.
			view.phase = "complete";
		} catch {
			// May include a persisted credential or an OAuth exchange. Never expose the native error/result.
			view.phase = "unconfirmed";
		} finally {
			delete view.prompt;
			delete flow.answer;
			options.changed();
			release(flow);
		}
	}
	return Object.freeze({
		bind: (authority: ProductModelAuthority): ProductAuthControl => {
			check(authority);
			function owned(id: string) {
				check(authority);
				const flow = flows.get(id);
				if (!flow || flow.authority.id !== authority.id)
					throw new Error("Authentication identity unavailable");
				return flow;
			}
			return Object.freeze({
				providers: () => {
					check(authority);
					return detached(
						(options.runtime()?.getProviders() ?? []).map((provider) => {
							const status = native().getProviderAuthStatus(provider.id);
							const methods: { type: AuthType; name: string }[] = [];
							if (provider.auth?.apiKey?.login)
								methods.push({ type: "api_key", name: provider.auth.apiKey.name });
							if (provider.auth?.oauth)
								methods.push({
									type: "oauth",
									name: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name,
								});
							return {
								id: provider.id,
								name: provider.name ?? provider.id,
								configured: status.configured,
								...(status.source ? { source: status.source } : {}),
								methods,
							};
						}),
					);
				},
				prepare: (provider: string, type: AuthType) => {
					const scope = liveSignal(authority);
					const auth = native().getProvider(provider)?.auth;
					if (
						!(["api_key", "oauth"] as string[]).includes(type) ||
						!(type === "api_key" ? auth?.apiKey?.login : auth?.oauth?.login)
					)
						throw new Error("Provider authentication method unavailable");
					for (const flow of flows.values()) if (finalPhase(flow.view.phase)) forget(flow);
					if (
						flows.size >= 32 ||
						[...flows.values()].filter((flow) => flow.authority.id === authority.id).length >= 8
					)
						throw new Error("Too many pending authentication interactions");
					const id = randomUUID(),
						controller = new AbortController();
					const signal = AbortSignal.any([scope, controller.signal]);
					const flow: Flow = {
						view: { id, provider, type, phase: "prepared", events: [] },
						authority,
						controller,
						signal,
						timer: setTimeout(() => forget(flow), 600000),
						released: false,
					};
					flow.timer.unref();
					signal.addEventListener(
						"abort",
						() => {
							if (flow.view.phase === "prepared") {
								flow.view.phase = "cancelled";
								release(flow);
							}
						},
						{ once: true },
					);
					flows.set(id, flow);
					return detached(flow.view);
				},
				start: (id: string) => {
					const flow = owned(id);
					if (flow.view.phase === "prepared") {
						flow.signal.throwIfAborted();
						check(flow.authority);
						flow.view.phase = "running";
						void tracked(run(flow));
					}
					return detached(flow.view);
				},
				state: (id: string) => detached(owned(id).view),
				answer: (id: string, promptId: string, value: string) => {
					const flow = owned(id),
						prompt = flow.view.prompt;
					flow.signal.throwIfAborted();
					check(flow.authority);
					if (
						!flow.answer ||
						!prompt ||
						prompt.id !== promptId ||
						typeof value !== "string" ||
						value.length > 16384 ||
						(prompt.type === "select" && !prompt.options.some((option) => option.id === value))
					)
						throw new Error("Authentication answer refused");
					flow.answer(value);
				},
				cancel: (id: string) => {
					const flow = owned(id);
					flow.controller.abort();
					return detached(flow.view);
				},
				logout: (provider: string) => {
					const signal = liveSignal(authority);
					return tracked(
						(async () => {
							try {
								await native().logout(provider, { signal });
							} catch {
								throw new Error("Native logout unconfirmed; refresh credential status before another action");
							} finally {
								options.changed();
							}
						})(),
					);
				},
			});
		},
		close: async () => {
			closed = true;
			for (const flow of flows.values()) forget(flow);
			await Promise.allSettled([...work]);
		},
	});
}
