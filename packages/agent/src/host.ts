import { randomUUID } from "node:crypto";
import { DurableAdapter } from "./durable-adapter.ts";
import type { Notice, AdapterControl } from "./durable-adapter.ts";
import { StrategyControl, type StrategyLease } from "./strategy-control.ts";
import type {
	Capability,
	Client,
	Decision,
	Grant,
	Hook,
	Host,
	HostEvent,
	HostOptions,
	Policy,
	Proposal,
	Receipt,
	View,
} from "./types.ts";
function frozen<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const v of Object.values(value)) frozen(v);
		Object.freeze(value);
	}
	return value;
}
function dto<T>(value: T): T {
	return frozen(structuredClone(value));
}
type RuntimeSnapshot = {
	durableSessionId?: string;
	conversationId?: string;
	providerSessionId?: string;
	sessionId: string;
	sessionFile: string;
	leafId: string | null;
	entries: readonly { id: string; type: string; role?: string; text?: string }[];
	context: readonly { role: string; text: string }[];
	autoCompaction: boolean;
};
type RuntimeAdapter = {
	readonly canReplace?: boolean;
	snapshot: () => RuntimeSnapshot;
	frame: DurableAdapter["frame"];
	models: DurableAdapter["models"];
	infer: DurableAdapter["infer"];
	storageUnknown?: DurableAdapter["storageUnknown"];
	journalNamespace?: DurableAdapter["journalNamespace"];
	readonly busy: boolean;
	readonly canQueue: boolean;
	start: DurableAdapter["start"];
	enqueue: DurableAdapter["enqueue"];
	clearQueued: DurableAdapter["clearQueued"];
	validate: DurableAdapter["validate"];
	commit: (
		proposal: Proposal,
		author: { principal: string; strategyId: string; operationId: string },
	) => string | Promise<string>;
	branch: DurableAdapter["branch"];
	replacement: (notify: (notice: Notice) => void, control: AdapterControl) => Promise<RuntimeAdapter>;
	reload: DurableAdapter["reload"];
	abortAndIdle: DurableAdapter["abortAndIdle"];
	idle: DurableAdapter["idle"];
	dispose: DurableAdapter["dispose"];
};
export type AdapterFactory = (
	options: HostOptions,
	notify: (notice: Notice) => void,
	control: AdapterControl,
) => Promise<RuntimeAdapter>;
type RecordInput = { receipt: Receipt; text: string; mode: string };
class Kernel {
	#adapter!: RuntimeAdapter;
	#options: Pick<HostOptions, "prepareInput">;
	#control: StrategyControl;
	#phase: View["phase"] = "ready";
	#epoch = 0;
	#generation = 0;
	#branchId = randomUUID();
	#lastError: string | undefined;
	#sessionFailures = new Map<string, string>();
	#records = new Map<string, RecordInput>();
	#keys = new Map<string, string>();
	#principals = new Set<string>();
	#listeners = new Set<(e: HostEvent) => void>();
	#caps = new WeakMap<Capability, { principal: string; stamp: string }>();
	#strategies = new Map<string, StrategyLease>();
	#owners = new Map<Hook, string>();
	#policy: Policy | undefined;
	#transitioning: Promise<void> | undefined;
	#closing: Promise<void> | undefined;
	#promptReservation: string | undefined;
	constructor(options: HostOptions, namespaceVersion: 1 | 2 = 1) {
		this.#options = { prepareInput: options.prepareInput };
		this.#control = new StrategyControl(
			options.dataDir,
			options.inference?.policies ?? [],
			{
				ready: () => this.#ready(),
				phase: () => this.#phase,
				identity: () => ({
					sessionId: this.#adapter.snapshot().sessionId,
					durableSessionId: this.#adapter.snapshot().durableSessionId,
					conversationId: this.#adapter.snapshot().conversationId,
					generation: this.#generation,
					navigationId: this.#branchId,
				}),
				lease: (id) => this.#strategies.get(id),
				owner: (hook) => this.#owners.get(hook),
				frame: () => this.#adapter.frame(),
				fail: (reason, sessionId) => this.#fail(reason, sessionId),
				storageUnknown: (reason, sessionId) => {
					if (sessionId === this.#adapter.snapshot().sessionId) this.#adapter.storageUnknown?.(reason);
					this.#fail(reason, sessionId);
				},
				journalNamespace: (strategyId, kind) => this.#adapter.journalNamespace?.(strategyId, kind),
				models: () => this.#adapter.models(),
				infer: (request, cap, signal, timeout, check, strategy) =>
					this.#adapter.infer(request, cap, signal, timeout, check, strategy),
			},
			namespaceVersion,
		);
	}
	#adapterControl(): AdapterControl {
		return {
			project: (signal) => this.#control.project(signal),
			runScope: () => this.#control.runScope(),
			invoke: (run, callback) => this.#control.invoke(run, callback),
		};
	}
	async initialize(options: HostOptions, factory: AdapterFactory): Promise<Host> {
		this.#adapter = await factory(options, (n) => this.#notice(n), this.#adapterControl());
		return Object.freeze({
			connect: (id: string, grants: readonly Grant[]) => this.#connect(id, grants),
			view: () => this.#view(),
			subscribe: (fn: (e: HostEvent) => void) => {
				this.#listeners.add(fn);
				return () => {
					this.#listeners.delete(fn);
				};
			},
			waitForIdle: async () => {
				await this.#adapter.idle();
				return this.#view();
			},
			reload: () => this.#transition(false),
			newSession: () =>
				this.#adapter.canReplace === false
					? Promise.reject(
							new Error("Managed Conversation cannot replace its Session; use runtime/MAS control"),
						)
					: this.#transition(true),
			dispose: () => this.#dispose(),
		});
	}
	#view(): View {
		return dto({
			...this.#adapter.snapshot(),
			phase: this.#phase,
			busy: this.#adapter.busy || !!this.#promptReservation,
			epoch: this.#epoch,
			generation: this.#generation,
			branchId: this.#branchId,
			lastError: this.#lastError,
			effects: this.#phase === "failed" ? "unknown" : "not-assessed",
		});
	}
	#stamp(): string {
		const s = this.#adapter.snapshot();
		return JSON.stringify([
			this.#generation,
			this.#epoch,
			s.sessionId,
			this.#branchId,
			s.entries.length,
			s.leafId,
		]);
	}
	#ready(): void {
		if (this.#phase !== "ready") throw new Error("Host is " + this.#phase);
	}
	#emit(event: HostEvent): void {
		const snapshot = dto(event),
			listeners = [...this.#listeners];
		// Publish only after the current synchronous handoff/transition is complete.
		// Core awaits our listener, so input-consumed remains observable before append.
		queueMicrotask(() => {
			for (const fn of listeners) {
				if (!this.#listeners.has(fn)) continue;
				try {
					void Promise.resolve(fn(snapshot)).catch(() => {});
				} catch {
					/* observers do not own commits */
				}
			}
		});
	}
	#receipt(id: string, patch: Partial<Receipt>): void {
		const record = this.#records.get(id);
		if (!record) return;
		record.receipt = { ...record.receipt, ...patch };
		this.#emit({ type: "receipt", receipt: record.receipt });
	}
	#fail(reason: string, sessionId = this.#adapter.snapshot().sessionId): void {
		if (!this.#sessionFailures.has(sessionId)) this.#sessionFailures.set(sessionId, reason);
		if (sessionId !== this.#adapter.snapshot().sessionId || this.#phase === "disposed") return;
		this.#lastError = this.#sessionFailures.get(sessionId);
		if (this.#phase === "ready") {
			this.#phase = "failed";
			this.#control.invalidate("failed");
		}
	}
	#notice(n: Notice): void {
		this.#epoch++;
		if (n.type === "consumed") this.#receipt(n.id, { state: "consumed" });
		if (n.type === "committed") this.#receipt(n.id, { state: "committed", entryId: n.entryId });
		if (n.type === "blocked") this.#receipt(n.id, { generation: { status: "blocked", reason: n.reason } });
		if (n.type === "unknown") this.#receipt(n.id, { state: "unknown", reason: n.reason });
		if (n.type === "released") this.#receipt(n.id, { state: "released", reason: n.reason });
		if (n.type === "failed") this.#fail(n.reason, n.sessionId);
		if (n.type === "changed") this.#control.sourceChanged();
	}
	#connect(principal: string, grants: readonly Grant[]): Client {
		this.#ready();
		if (!principal || this.#principals.has(principal)) throw new Error("Principal already bound or empty");
		this.#principals.add(principal);
		const allow = new Set(grants);
		return Object.freeze({
			view: () => this.#view(),
			capture: () => {
				this.#ready();
				const token = Object.freeze({});
				this.#caps.set(token, { principal, stamp: this.#stamp() });
				return token;
			},
			activateStrategy: (spec: Parameters<Client["activateStrategy"]>[0]) => {
				this.#ready();
				const hooks = [...new Set(spec.hooks)];
				if (!spec.id || this.#strategies.has(spec.id) || hooks.length === 0)
					throw new Error("Invalid or duplicate strategy");
				for (const hook of hooks) {
					if (!allow.has(hook)) throw new Error("Missing hook grant");
					if (hook === "real_context.write" && this.#owners.has(hook))
						throw new Error("Hook already owned: " + hook);
				}
				this.#strategies.set(spec.id, { principal, hooks, leaseId: randomUUID() });
				for (const hook of hooks) {
					if (hook === "real_context.write") this.#owners.set(hook, spec.id);
				}
				this.#epoch++;
			},
			deactivateStrategy: (id: string) => {
				this.#ready();
				const strategy = this.#strategies.get(id);
				if (!strategy || strategy.principal !== principal) throw new Error("Not strategy owner");
				for (const hook of strategy.hooks) {
					if (hook === "real_context.write") {
						this.#owners.delete(hook);
						this.#policy = undefined;
					}
				}
				this.#control.invalidate("deactivated", id);
				this.#strategies.delete(id);
				this.#epoch++;
			},
			bindStrategy: (id: string) => this.#control.bind(principal, allow, id),
			setPolicy: (policy: Policy) => {
				this.#ready();
				const owner = this.#owners.get("real_context.write");
				if (!owner || this.#strategies.get(owner)?.principal !== principal)
					throw new Error("Not real_context.write owner");
				if (typeof policy !== "function") throw new Error("Invalid policy");
				this.#policy = policy;
				this.#epoch++;
			},
			commit: (at: Capability, proposal: Proposal) => this.#commit(principal, at, proposal),
			submit: (input: Parameters<Client["submit"]>[0]) => {
				if (!allow.has("input.submit")) throw new Error("Missing input.submit grant");
				return this.#submit(principal, input);
			},
			receipt: (id: string) => {
				const r = this.#records.get(id)?.receipt;
				return r?.principal === principal ? dto(r) : undefined;
			},
			cancelQueued: () => {
				this.#ready();
				if (!allow.has("input.submit")) throw new Error("Missing input.submit grant");
				return this.#clear(principal);
			},
			branch: (at: Capability, entryId: string) => {
				if (!allow.has("branch.control")) throw new Error("Missing branch.control grant");
				if (!this.#valid(principal, at)) throw new Error("Stale capability");
				if (this.#adapter.busy || this.#promptReservation) throw new Error("Session must be idle");
				this.#adapter.branch(entryId);
				this.#branchId = randomUUID();
				this.#control.invalidate("navigation");
				this.#epoch++;
			},
		});
	}
	#valid(principal: string, at: Capability): boolean {
		const cap = this.#caps.get(at);
		return this.#phase === "ready" && cap?.principal === principal && cap.stamp === this.#stamp();
	}
	async #commit(principal: string, at: Capability, original: Proposal): Promise<Decision> {
		const denied = (reason: string): Decision => ({ status: "denied", reason });
		if (!this.#valid(principal, at)) return denied("Stale or invalid capability");
		if (this.#adapter.busy || this.#promptReservation) return denied("Session must be idle");
		let proposal: Proposal;
		try {
			proposal = dto(original);
		} catch {
			return denied("Invalid proposal");
		}
		if (!this.#adapter.validate(proposal)) return denied("Invalid proposal or target");
		const owner = this.#owners.get("real_context.write");
		if (!owner) return denied("real_context.write is not owned");
		if (this.#strategies.get(owner)?.principal !== principal) {
			if (!this.#policy) return denied("Caller is not real_context.write owner");
			try {
				if ((await this.#policy(dto({ principal, proposal }))) !== true) return denied("Policy denied");
			} catch {
				return denied("Policy failed");
			}
		}
		// No await between revalidation and Pi mutation.
		if (
			!this.#valid(principal, at) ||
			this.#adapter.busy ||
			this.#promptReservation ||
			this.#owners.get("real_context.write") !== owner
		)
			return denied("State changed during approval");
		this.#epoch++;
		try {
			const entryId = await this.#adapter.commit(proposal, {
				principal,
				strategyId: owner,
				operationId: randomUUID(),
			});
			this.#control.sourceChanged();
			return dto({ status: "committed", entryId });
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.#fail(reason);
			return dto({ status: "unknown", reason });
		}
	}
	async #submit(principal: string, input: Parameters<Client["submit"]>[0]): Promise<Receipt> {
		const { key, text, mode = "prompt" } = input;
		if (typeof key !== "string" || !key || typeof text !== "string" || !text.trim())
			throw new Error("Empty input");
		if (!["prompt", "steer", "followUp"].includes(mode)) throw new Error("Unsupported input mode");
		if (text.startsWith("/")) throw new Error("Pi commands/skills/templates unsupported");
		const scope = this.#adapter.snapshot().sessionId;
		const keyId = JSON.stringify([principal, scope, this.#branchId, key]);
		const existingId = this.#keys.get(keyId),
			existing = existingId ? this.#records.get(existingId) : undefined;
		if (existing) {
			if (existing.text !== text || existing.mode !== mode) throw new Error("Idempotency conflict");
			if (existing.receipt.state !== "released") return dto(existing.receipt);
		}
		this.#ready();
		if (
			input.at &&
			(this.#caps.get(input.at)?.principal !== principal || this.#caps.get(input.at)?.stamp !== this.#stamp())
		)
			throw new Error("Stale capability");
		if (mode === "prompt" ? this.#adapter.busy || !!this.#promptReservation : !this.#adapter.canQueue)
			throw new Error("Input mode incompatible with current run");
		const id = existingId ?? randomUUID(),
			generation = this.#generation,
			branch = this.#branchId;
		const record: RecordInput = {
			text,
			mode,
			receipt: {
				id,
				key,
				principal,
				sessionId: scope,
				branchId: branch,
				attempt: (existing?.receipt.attempt ?? 0) + 1,
				state: "reserved",
			},
		};
		this.#keys.set(keyId, id);
		this.#records.set(id, record);
		this.#epoch++;
		if (mode === "prompt") this.#promptReservation = id;
		try {
			const prepared = this.#options.prepareInput
				? await this.#options.prepareInput(dto({ principal, text, mode }))
				: { action: "text" as const, text };
			if (this.#phase !== "ready" || generation !== this.#generation || branch !== this.#branchId) {
				this.#receipt(id, { state: "released", reason: "Scope changed during preparation" });
				return dto(record.receipt);
			}
			if (prepared.action === "handled") {
				this.#receipt(id, { state: "handled" });
				return dto(record.receipt);
			}
			if (typeof prepared.text !== "string" || !prepared.text.trim())
				throw new Error("Invalid prepared input");
			this.#receipt(id, { state: "queued" });
			if (mode === "prompt")
				this.#adapter.start(
					id,
					prepared.text,
					() => this.#phase === "ready" && generation === this.#generation,
				);
			else this.#adapter.enqueue(id, prepared.text, mode);
			return dto(record.receipt);
		} catch (error) {
			this.#receipt(id, { state: "unknown", reason: error instanceof Error ? error.message : String(error) });
			throw error;
		} finally {
			if (this.#promptReservation === id) this.#promptReservation = undefined;
		}
	}
	#clear(principal?: string): readonly Receipt[] {
		const selected = principal
			? new Set(
					[...this.#records.values()]
						.filter((r) => r.receipt.principal === principal)
						.map((r) => r.receipt.id),
				)
			: undefined;
		const ids = this.#adapter.clearQueued(selected);
		if (ids.length) this.#epoch++;
		for (const id of ids)
			this.#receipt(id, { state: "unknown", reason: "Withdrawal requested; durable confirmation pending" });
		return dto(ids.map((id) => this.#records.get(id)!.receipt));
	}
	#transition(replace: boolean): Promise<void> {
		if (this.#phase === "disposed") return Promise.reject(new Error("Host disposed"));
		if (this.#phase === "transitioning")
			return Promise.reject(new Error("A lifecycle transition is already active"));
		if (this.#phase === "failed" && !replace)
			return Promise.reject(new Error("Host failed; use explicit newSession recovery"));
		this.#phase = "transitioning";
		this.#generation++;
		this.#control.invalidate(replace ? "newSession" : "reload");
		this.#epoch++;
		this.#promptReservation = undefined;
		this.#clear();
		this.#emit({ type: "state", phase: "transitioning" });
		const operation = (async () => {
			try {
				await this.#adapter.abortAndIdle();
				if (replace) {
					const previous = this.#adapter;
					const next = await previous.replacement((n) => this.#notice(n), this.#adapterControl());
					this.#adapter = next;
					this.#branchId = randomUUID();
					await previous.dispose();
				} else await this.#adapter.reload();
				const failure = this.#sessionFailures.get(this.#adapter.snapshot().sessionId);
				if (failure) throw new Error(failure);
				this.#lastError = undefined;
				if (this.#phase !== "disposed") this.#phase = "ready";
			} catch (error) {
				this.#lastError = error instanceof Error ? error.message : String(error);
				if (this.#phase !== "disposed") this.#phase = "failed";
				throw error;
			} finally {
				this.#epoch++;
				this.#emit({ type: "state", phase: this.#phase });
				this.#control.restored(replace ? "newSession" : "reload");
			}
		})();
		const tracked = operation.finally(() => {
			if (this.#transitioning === tracked) this.#transitioning = undefined;
		});
		this.#transitioning = tracked;
		return tracked;
	}
	#dispose(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#phase = "disposed";
		this.#generation++;
		this.#control.invalidate("disposed");
		this.#epoch++;
		this.#closing = (async () => {
			try {
				await this.#transitioning;
			} catch {
				/* still dispose current adapter */
			}
			this.#clear();
			await this.#adapter.dispose();
			this.#listeners.clear();
		})();
		return this.#closing;
	}
}
export async function createHost(options: HostOptions): Promise<Host> {
	if (options.backend !== undefined && options.backend !== "durable")
		throw new Error("Unsupported production backend");
	return createHostWithAdapter(options, (opts, notify, control) =>
		DurableAdapter.create(opts, notify, control),
	);
}
/** Internal construction seam; not exported by the package entry point. */
export async function createHostWithAdapter(
	options: HostOptions,
	factory: AdapterFactory,
	namespaceVersion: 1 | 2 = 1,
): Promise<Host> {
	return new Kernel(options, namespaceVersion).initialize(options, factory);
}
