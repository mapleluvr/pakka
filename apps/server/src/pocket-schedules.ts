import { createHash } from "node:crypto";
import type {
	ConversationRef,
	JsonObject,
	Runtime,
	RuntimeJobDefinition,
	RuntimeJobContext,
	RuntimeJobReceipt,
} from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "./pocket-people.js";
import type { PocketWorkspace } from "./pocket-workspace.js";

export interface PocketScheduleInput {
	readonly requestId: string;
	readonly dueAt: number;
	readonly text: string;
	readonly intervalMs?: number;
	readonly maxRuns?: number;
}
export interface PocketSchedule {
	readonly id: string;
	readonly requestId: string;
	readonly actorId: string;
	readonly actorName: string;
	readonly target: ConversationRef;
	readonly text: string;
	readonly dueAt: number;
	readonly intervalMs: number | null;
	readonly maxRuns: number;
	readonly completed: number;
	readonly state: "waiting" | "running" | "done" | "cancelled" | "unknown";
	readonly jobId: string | null;
	readonly nativeTerminal?: "aborted" | "completed";
	readonly deliveryId?: string;
}
export interface PocketScheduleClient {
	list(target: ConversationRef): Promise<readonly PocketSchedule[]>;
	add(target: ConversationRef, input: PocketScheduleInput): Promise<PocketSchedule>;
	cancel(target: ConversationRef, id: string): Promise<PocketSchedule>;
}
export interface PocketSchedules {
	bind(actor: PocketAuthority, check?: () => void): PocketScheduleClient;
	/** Stop host waiters only; closing a view or product waiter never aborts the native scheduled task. */
	dispose(): Promise<void>;
}
export interface PocketScheduleContext {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly workspace: PocketWorkspace;
}
export interface PocketSchedulesPreparation {
	readonly definition: RuntimeJobDefinition;
	attach(context: PocketScheduleContext): Promise<PocketSchedules>;
}
type Input = { text: string; dueAt: number; intervalMs: number | null; maxRuns: number };
type Row = {
	id: string;
	requestId: string;
	actorId: string;
	actorName: string;
	target: ConversationRef;
	input: Input;
	fingerprint: string;
	jobId: string | null;
	cancelled: boolean;
};
type State = { schema: 1; sessionId: string; rows: Row[] };
const identity = (v: unknown): v is string =>
	typeof v === "string" && /^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);
const keys = (
	v: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): v is Record<string, unknown> =>
	record(v) &&
	required.every((k) => Object.hasOwn(v, k)) &&
	Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
	typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const same = (a: ConversationRef, b: ConversationRef) =>
	["key", "sessionId", "conversationId", "incarnation", "profile"].every(
		(k) => a[k as keyof ConversationRef] === b[k as keyof ConversationRef],
	);
function ref(v: unknown): v is ConversationRef {
	return (
		keys(v, ["key", "sessionId", "conversationId", "incarnation", "profile"]) &&
		Object.values(v).every((value) => typeof value === "string" && value.length > 0 && value.length <= 512)
	);
}
function validInput(v: unknown): v is Input {
	return (
		keys(v, ["text", "dueAt", "intervalMs", "maxRuns"]) &&
		typeof v.text === "string" &&
		!!v.text.trim() &&
		v.text.length <= 8192 &&
		!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v.text) &&
		integer(v.dueAt) &&
		integer(v.maxRuns, 1, 32) &&
		((v.intervalMs === null && v.maxRuns === 1) ||
			(integer(v.intervalMs, 1000, 366 * 86400000) && v.maxRuns > 1))
	);
}
function stored(v: unknown): v is Row {
	return (
		keys(v, [
			"id",
			"requestId",
			"actorId",
			"actorName",
			"target",
			"input",
			"fingerprint",
			"jobId",
			"cancelled",
		]) &&
		identity(v.id) &&
		identity(v.requestId) &&
		identity(v.actorId) &&
		typeof v.actorName === "string" &&
		v.actorName.length > 0 &&
		v.actorName.length <= 80 &&
		ref(v.target) &&
		validInput(v.input) &&
		typeof v.fingerprint === "string" &&
		/^[a-f0-9]{64}$/.test(v.fingerprint) &&
		(v.jobId === null || identity(v.jobId)) &&
		typeof v.cancelled === "boolean" &&
		v.fingerprint === hash([v.target, v.input])
	);
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const item of Object.values(value)) freeze(item);
		Object.freeze(value);
	}
	return value;
}
function encode(state: State): JsonObject {
	return {
		schema: 1,
		sessionId: state.sessionId,
		rows: state.rows.map((row) => ({
			id: row.id,
			requestId: row.requestId,
			actorId: row.actorId,
			actorName: row.actorName,
			target: { ...row.target },
			input: { ...row.input },
			fingerprint: row.fingerprint,
			jobId: row.jobId,
			cancelled: row.cancelled,
		})),
	};
}

/** Prepare before opening the writer; attach only host-owned services, never caller-supplied program or actor code. */
export function createPocketSchedules(options: {
	readonly namespace: string;
	readonly maxSchedules: number;
}): PocketSchedulesPreparation {
	if (!identity(options.namespace) || !integer(options.maxSchedules, 1, 128))
		throw Error("Invalid finite schedule options");
	const namespace = options.namespace,
		maxSchedules = options.maxSchedules;
	const jobOptions = Object.freeze({
		namespace: namespace + ".jobs",
		maxJobs: maxSchedules,
		maxBytes: 1048576,
	});
	if (!identity(jobOptions.namespace)) throw Error("Schedule namespace too long");
	let bound: PocketScheduleContext | undefined,
		state: State | undefined,
		version = 0,
		available = true,
		attaching = false;
	const pendingCancellation = new Set<string>();
	let tail: Promise<unknown> = Promise.resolve();
	const ready = () => {
		if (!available || !bound || !state || bound.runtime.view().phase !== "ready")
			throw Error("Schedule service unavailable");
		return bound;
	};
	const current = (target: ConversationRef) => {
		const context = ready();
		if (!ref(target) || !context.runtime.view().conversations.some((row) => same(row, target)))
			throw Error("Schedule resource denied");
		return context;
	};
	const authorize = (actorId: string, target: ConversationRef) => {
		const ctx = current(target);
		ctx.workspace.checkScheduledInput(actorId, target);
	};
	const spec = (row: Row) => ({
		requestId: row.id,
		actorId: row.actorId,
		target: row.target,
		definition: namespace,
		payload: { scheduleId: row.id },
	});
	const find = (id: string) => {
		ready();
		const row = state!.rows.find((row) => row.id === id);
		if (!row) throw Error("Unknown schedule");
		return row;
	};
	const load = async () => {
		const ctx = bound;
		if (!available || !ctx) throw Error("Schedule service unavailable");
		const snapshot = await ctx.runtime.store({ namespace, maxBytes: 1048576 }).snapshot();
		try {
			if (snapshot.version === 0 && Object.keys(snapshot.data).length === 0) {
				state = { schema: 1, sessionId: ctx.runtime.view().sessionId, rows: [] };
				version = 0;
				return;
			}
			const raw: unknown = snapshot.data;
			if (
				!keys(raw, ["schema", "sessionId", "rows"]) ||
				raw.schema !== 1 ||
				raw.sessionId !== ctx.runtime.view().sessionId ||
				!Array.isArray(raw.rows) ||
				raw.rows.length > maxSchedules ||
				!raw.rows.every(stored) ||
				new Set(raw.rows.map((row) => row.id)).size !== raw.rows.length
			)
				throw Error("Unknown schedule storage");
			state = { schema: 1, sessionId: raw.sessionId, rows: structuredClone(raw.rows) };
			version = snapshot.version;
		} catch {
			available = false;
			throw Error("Schedule storage unavailable");
		}
	};
	const alter = <T>(effect: (draft: State) => T, check: () => void): Promise<T> => {
		const result = tail.then(async () => {
			await load();
			check();
			const draft = structuredClone(state!);
			const value = effect(draft);
			if (draft.rows.length > maxSchedules) throw Error("Schedule capacity exhausted");
			const before = JSON.stringify(state);
			if (JSON.stringify(draft) !== before) {
				const next = await bound!.runtime
					.store({ namespace, maxBytes: 1048576 })
					.compareAndSet(version, encode(draft), check);
				state = draft;
				version = next.version;
			}
			check();
			return value;
		});
		tail = result.then(
			() => {},
			() => {},
		);
		return result;
	};
	const view = async (row: Row, check: () => void): Promise<PocketSchedule> => {
		check();
		const ctx = ready();
		let receipt: RuntimeJobReceipt | undefined;
		if (row.jobId) {
			receipt = await ctx.runtime.jobs(jobOptions).receipt(row.jobId, check);
			if (
				hash({
					requestId: receipt.requestId,
					actorId: receipt.actorId,
					target: receipt.target,
					definition: receipt.definition,
					payload: receipt.payload,
				}) !== hash(spec(row))
			)
				throw Error("Schedule job provenance unknown");
		}
		check();
		const completed =
			receipt?.state === "done" && integer(receipt.result?.completed)
				? receipt.result.completed
				: integer(receipt?.checkpoint.completed)
					? receipt.checkpoint.completed
					: 0;
		const deliveryId =
			typeof receipt?.result?.deliveryId === "string"
				? receipt.result.deliveryId
				: typeof receipt?.checkpoint.deliveryId === "string"
					? receipt.checkpoint.deliveryId
					: undefined;
		return freeze({
			id: row.id,
			requestId: row.requestId,
			actorId: row.actorId,
			actorName: row.actorName,
			target: { ...row.target },
			text: row.input.text,
			dueAt: row.input.dueAt,
			intervalMs: row.input.intervalMs,
			maxRuns: row.input.maxRuns,
			completed,
			state:
				row.cancelled && receipt?.nativeTerminal === "aborted"
					? "cancelled"
					: receipt?.state === "queued"
						? "waiting"
						: (receipt?.state ?? "unknown"),
			jobId: row.jobId,
			...(receipt?.nativeTerminal ? { nativeTerminal: receipt.nativeTerminal } : {}),
			...(deliveryId ? { deliveryId } : {}),
		});
	};
	const definition: RuntimeJobDefinition = Object.freeze({
		id: namespace,
		version: 1,
		authorize,
		run: async (context: RuntimeJobContext) => {
			const scheduleId = context.job.payload.scheduleId;
			if (!identity(scheduleId)) throw Error("Invalid native schedule payload");
			const row = find(scheduleId);
			if (
				hash(spec(row)) !==
				hash({
					requestId: context.job.requestId,
					actorId: context.job.actorId,
					target: context.job.target,
					definition: context.job.definition,
					payload: context.job.payload,
				})
			)
				throw Error("Native schedule association unknown");
			const check = () => {
				context.check();
				if (pendingCancellation.has(scheduleId) || find(scheduleId).cancelled)
					throw Error("Schedule cancelled or cancellation unconfirmed");
			};
			check();
			const checkpoint = context.checkpoint;
			if (
				Object.keys(checkpoint).some(
					(key) => !["completed", "nextDueAt", "deliveryId", "waits"].includes(key),
				)
			)
				throw Error("Invalid schedule checkpoint");
			const completed = checkpoint.completed ?? 0,
				nextDueAt = checkpoint.nextDueAt ?? row.input.dueAt,
				waits = checkpoint.waits ?? 0;
			if (
				!integer(completed, 0, row.input.maxRuns - 1) ||
				!integer(nextDueAt) ||
				!integer(waits, 0, Number.MAX_SAFE_INTEGER - 1) ||
				(checkpoint.deliveryId !== undefined && !identity(checkpoint.deliveryId))
			)
				throw Error("Invalid schedule checkpoint");
			const remaining = nextDueAt - Date.now();
			// A pending native phase must advance its checkpoint, including when reopen occurs before the same due time.
			if (remaining > 0) {
				await context.advance({
					completed,
					nextDueAt,
					waits: waits + 1,
					...(typeof checkpoint.deliveryId === "string" ? { deliveryId: checkpoint.deliveryId } : {}),
				});
				await context.sleep(Math.min(remaining, 3600000));
				return;
			}
			const delivery = await ready().workspace.submitScheduled(
				row.actorId,
				row.target,
				{ requestId: "scheduled-" + hash([row.id, completed]), text: row.input.text },
				check,
			);
			check();
			if (delivery.status === "unknown") throw Error("Scheduled input admission unconfirmed");
			if (completed + 1 === row.input.maxRuns) {
				await context.complete({ completed: completed + 1, deliveryId: delivery.id });
				return;
			}
			await context.advance({
				completed: completed + 1,
				nextDueAt: nextDueAt + row.input.intervalMs!,
				deliveryId: delivery.id,
			});
		},
	});
	return Object.freeze({
		definition,
		attach: async (context: PocketScheduleContext): Promise<PocketSchedules> => {
			if (attaching || bound) throw Error("Schedules already attached");
			attaching = true;
			bound = Object.freeze({ ...context });
			await load();
			const controller = new AbortController(),
				waiters = new Set<Promise<void>>();
			// Resume existing native tasks only after trusted services are bound; never start a new job from recovery.
			for (const row of state!.rows) {
				if (!row.jobId) continue;
				const actual = await view(row, () => {
					ready();
				});
				if (actual.state !== "waiting" && actual.state !== "running") continue;
				let waiting: Promise<void>;
				waiting = context.runtime
					.jobs(jobOptions)
					.wait(
						row.jobId,
						() => {
							ready();
						},
						controller.signal,
					)
					.then(
						() => {},
						() => {
							if (!controller.signal.aborted) available = false;
						},
					)
					.finally(() => waiters.delete(waiting));
				waiters.add(waiting);
			}
			return Object.freeze({
				dispose: async () => {
					controller.abort(Error("Schedule waiter closed"));
					await Promise.all(waiters);
				},
				bind(actor: PocketAuthority, check: () => void = () => {}): PocketScheduleClient {
					if (controller.signal.aborted) throw Error("Schedule service closed");
					const ctx = ready();
					const actorId = ctx.people.current(actor).id;
					const read = (target: ConversationRef) => {
						current(target);
						ctx.people.check(actor, "read", target.conversationId);
						check();
					};
					const write = (target: ConversationRef) => {
						read(target);
						ctx.people.check(actor, "steer", target.conversationId);
						ctx.workspace.checkScheduledInput(actorId, target);
					};
					return Object.freeze({
						list: async (raw: ConversationRef) => {
							const target = freeze({ ...raw });
							read(target);
							await load();
							const rows = state!.rows.filter((row) => same(row.target, target));
							const output = [];
							for (const row of rows) output.push(await view(row, () => read(target)));
							read(target);
							return freeze(output);
						},
						add: async (raw: ConversationRef, input: PocketScheduleInput) => {
							const target = freeze({ ...raw });
							write(target);
							if (
								!keys(input, ["requestId", "dueAt", "text"], ["intervalMs", "maxRuns"]) ||
								!identity(input.requestId)
							)
								throw Error("Invalid schedule input");
							const data = {
								text: input.text,
								dueAt: input.dueAt,
								intervalMs: input.intervalMs ?? null,
								maxRuns: input.maxRuns ?? 1,
							};
							if (!validInput(data)) throw Error("Invalid bounded schedule");
							const requestId = input.requestId,
								actorName = ctx.people.current(actor).name,
								id = "schedule-" + hash([namespace, actorId, requestId]),
								fingerprint = hash([target, data]);
							const found = await alter(
								(draft) => {
									const prior = draft.rows.find((row) => row.id === id);
									if (prior) {
										if (prior.fingerprint !== fingerprint) throw Error("Schedule request conflict");
										return { row: prior, created: false };
									}
									if (data.dueAt < Date.now() || data.dueAt > Date.now() + 366 * 86400000)
										throw Error("Schedule due time outside allowed horizon");
									const row: Row = {
										id,
										requestId,
										actorId,
										actorName,
										target,
										input: data,
										fingerprint,
										jobId: null,
										cancelled: false,
									};
									draft.rows.push(row);
									return { row, created: true };
								},
								() => write(target),
							);
							if (!found.created) return view(found.row, () => read(target));
							const admitted = await ctx.runtime.jobs(jobOptions).start(spec(found.row), () => write(target));
							const row = await alter(
								(draft) => {
									const row = draft.rows.find((row) => row.id === id)!;
									row.jobId = admitted.id;
									return row;
								},
								() => write(target),
							);
							return view(row, () => read(target));
						},
						cancel: async (raw: ConversationRef, id: string) => {
							const target = freeze({ ...raw });
							read(target);
							ctx.people.check(actor, "steer", target.conversationId);
							const guard = () => {
								read(target);
								ctx.people.check(actor, "steer", target.conversationId);
							};
							if (!identity(id)) throw Error("Invalid schedule identity");
							if (!same(find(id).target, target)) throw Error("Schedule denied");
							// Fence effects before awaiting persistence; an unconfirmed cancellation cannot release it.
							pendingCancellation.add(id);
							const row = await alter((draft) => {
								const row = draft.rows.find((row) => row.id === id && same(row.target, target));
								if (!row) throw Error("Schedule denied");
								row.cancelled = true;
								return row;
							}, guard);
							pendingCancellation.delete(id);
							if (row.jobId) await ctx.runtime.jobs(jobOptions).abort(row.jobId, guard);
							return view(row, guard);
						},
					});
				},
			});
		},
	});
}
