import { randomUUID } from "node:crypto";
import type { ConversationRef, HostOptions, JsonObject, Runtime, ToolInvocationScope } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "./pocket-people.ts";
import type { PocketNotifications } from "./pocket-notifications.ts";

type ApprovedTool = NonNullable<HostOptions["tools"]>[number];
export interface PocketApproval {
	readonly id: string;
	readonly ref: ConversationRef;
	readonly tool: string;
	readonly arguments: JsonObject;
	readonly createdAt: number;
	readonly expiresAt: number;
	readonly state: "pending" | "allowed" | "denied" | "running" | "done" | "unknown";
	readonly decidedBy?: string;
}
export interface PocketApprovalClient {
	list(target: ConversationRef): Promise<readonly PocketApproval[]>;
	decide(
		target: ConversationRef,
		input: { readonly id: string; readonly allow: boolean },
	): Promise<PocketApproval>;
}
export interface PocketApprovals {
	bind(actor: PocketAuthority, check?: () => void): PocketApprovalClient;
	/** Trusted tool-wrapper port. A serialized or ended invocation never provides authority. */
	invoke(
		target: ConversationRef,
		scope: ToolInvocationScope,
		tool: string,
		args: Record<string, unknown>,
		effect: () => Promise<string>,
		signal?: AbortSignal,
	): Promise<string>;
}
export interface PocketApprovalsOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly namespace: string;
	readonly timeoutMs?: number;
	/** Host-selected notification producer; the browser cannot create pending native approvals. */
	readonly notifications?: Pick<PocketNotifications, "publish">;
}
type Row = { -readonly [K in keyof PocketApproval]: PocketApproval[K] };
const record = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[-a-zA-Z0-9._:]{1,160}$/.test(v);
const same = (a: ConversationRef, b: ConversationRef) =>
	a.key === b.key &&
	a.sessionId === b.sessionId &&
	a.conversationId === b.conversationId &&
	a.incarnation === b.incarnation &&
	a.profile === b.profile;
function freeze<T>(v: T): T {
	if (v && typeof v === "object") {
		Object.values(v).forEach(freeze);
		Object.freeze(v);
	}
	return v;
}
function denied(): never {
	throw Error("Pocket approval authority denied or decision conflict");
}
function jsonObject(value: unknown): JsonObject {
	const valid = (v: unknown, depth: number): boolean =>
		depth <= 8 &&
		(v === null ||
			typeof v === "string" ||
			typeof v === "boolean" ||
			(typeof v === "number" && Number.isFinite(v)) ||
			(Array.isArray(v) && v.length <= 256 && v.every((x) => valid(x, depth + 1))) ||
			(record(v) &&
				Object.keys(v).length <= 128 &&
				Object.entries(v).every(
					([k, x]) => !["__proto__", "constructor", "prototype"].includes(k) && valid(x, depth + 1),
				)));
	if (!record(value) || !valid(value, 0) || Buffer.byteLength(JSON.stringify(value)) > 16384)
		throw Error("Invalid bounded approval arguments");
	// SAFETY: the complete bounded JSON graph above contains no callbacks or platform objects.
	return structuredClone(value) as JsonObject;
}
function ref(value: unknown): ConversationRef {
	if (
		!record(value) ||
		Object.keys(value).sort().join(",") !== "conversationId,incarnation,key,profile,sessionId" ||
		!id(value.key) ||
		!id(value.sessionId) ||
		!id(value.conversationId) ||
		!id(value.incarnation) ||
		!id(value.profile)
	)
		throw Error("Unconfirmed approval reference");
	return {
		key: value.key,
		sessionId: value.sessionId,
		conversationId: value.conversationId,
		incarnation: value.incarnation,
		profile: value.profile,
	};
}
function decode(data: JsonObject, version: number): Row[] {
	if (version === 0 && Object.keys(data).length === 0) return [];
	if (
		data.schema !== 1 ||
		Object.keys(data).sort().join(",") !== "rows,schema" ||
		!Array.isArray(data.rows) ||
		data.rows.length > 512
	)
		throw Error("Unconfirmed approval storage");
	const rows: Row[] = data.rows.map((value) => {
		if (
			!record(value) ||
			Object.keys(value).some(
				(k) =>
					!["id", "ref", "tool", "arguments", "createdAt", "expiresAt", "state", "decidedBy"].includes(k),
			) ||
			!id(value.id) ||
			typeof value.tool !== "string" ||
			!/^[-a-zA-Z0-9_]{1,80}$/.test(value.tool) ||
			!Number.isSafeInteger(value.createdAt) ||
			!Number.isSafeInteger(value.expiresAt) ||
			typeof value.createdAt !== "number" ||
			typeof value.expiresAt !== "number" ||
			value.createdAt <= 0 ||
			value.expiresAt <= value.createdAt ||
			(value.decidedBy !== undefined && !id(value.decidedBy))
		)
			throw Error("Unconfirmed approval row");
		const state = value.state;
		if (
			(state !== "pending" &&
				state !== "allowed" &&
				state !== "denied" &&
				state !== "running" &&
				state !== "done" &&
				state !== "unknown") ||
			(["allowed", "denied", "running", "done"].includes(state) && !value.decidedBy)
		)
			throw Error("Unconfirmed approval phase");
		return {
			id: value.id,
			ref: ref(value.ref),
			tool: value.tool,
			arguments: jsonObject(value.arguments),
			createdAt: value.createdAt,
			expiresAt: value.expiresAt,
			state,
			...(typeof value.decidedBy === "string" ? { decidedBy: value.decidedBy } : {}),
		};
	});
	if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error("Unconfirmed approval identity");
	return rows;
}

/** Approval state is durable; the authority to release a tool exists only in its live native invocation. */
export async function createPocketApprovals(options: PocketApprovalsOptions): Promise<PocketApprovals> {
	const { runtime, people } = options,
		timeoutMs = options.timeoutMs ?? 120000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000)
		throw Error("Invalid approval deadline");
	const store = runtime.store({ namespace: options.namespace, maxBytes: 1024 * 1024 }),
		catalog = runtime.catalog({
			namespace: options.namespace + ".invocations",
			maxDeliveries: 1,
			maxPending: 1,
		});
	let broken = false,
		tail: Promise<unknown> = Promise.resolve();
	const ready = () => {
		if (broken || runtime.view().phase !== "ready") throw Error("Unconfirmed approval storage or runtime");
	};
	const current = (target: ConversationRef) => {
		ready();
		if (!runtime.view().conversations.some((r) => same(r, target))) return denied();
	};
	const read = async () => {
		ready();
		try {
			const value = await store.snapshot();
			return { version: value.version, rows: decode(value.data, value.version) };
		} catch (error) {
			broken = true;
			throw error;
		}
	};
	function mutate<T>(effect: (rows: Row[]) => T, check: () => void): Promise<T> {
		const result = tail.then(async () => {
			for (let attempt = 0; attempt < 64; attempt++) {
				const value = await read();
				check();
				const output = effect(value.rows);
				if (value.rows.length > 512) throw Error("Approval capacity reached");
				const data: JsonObject = {
					schema: 1,
					rows: value.rows.map((row) => ({ ...row, ref: { ...row.ref }, arguments: row.arguments })),
				};
				try {
					await store.compareAndSet(value.version, data, check);
					return output;
				} catch (error) {
					if ((await read()).version <= value.version) throw error;
				}
			}
			throw Error("Unconfirmed approval contention");
		});
		tail = result.then(
			() => {},
			() => {},
		);
		return result;
	}
	// An unresolved record cannot recreate an identity capability after a writer/service is reopened.
	const initial = await read();
	if (initial.rows.some((r) => r.state === "pending" || r.state === "allowed" || r.state === "running"))
		await mutate((rows) => {
			for (const row of rows)
				if (row.state === "pending" || row.state === "allowed" || row.state === "running")
					row.state = "unknown";
		}, ready);
	const live = new Map<string, { check: () => void; wake: () => void; decisionCheck?: () => void }>();
	const unknown = async (key: string) => {
		await mutate((rows) => {
			const row = rows.find((r) => r.id === key);
			if (row && row.state !== "done" && row.state !== "denied") row.state = "unknown";
		}, ready);
	};
	const service: PocketApprovals = {
		bind(actor, check = () => {}) {
			const authorize = (target: ConversationRef, write = false) => {
				check();
				current(target);
				people.check(actor, write ? "manage" : "read", target.conversationId);
			};
			return Object.freeze({
				list: async (target: ConversationRef) => {
					authorize(target);
					const value = await read();
					authorize(target);
					return freeze(value.rows.filter((row) => same(row.ref, target)).map((row) => structuredClone(row)));
				},
				decide: async (target: ConversationRef, input: { readonly id: string; readonly allow: boolean }) => {
					const verify = () => {
						authorize(target, true);
						if (
							!input ||
							Object.keys(input).sort().join(",") !== "allow,id" ||
							!id(input.id) ||
							typeof input.allow !== "boolean"
						)
							return denied();
						const active = live.get(input.id);
						if (!active) return denied();
						active.check();
					};
					verify();
					const chosen = await mutate((rows) => {
						verify();
						const row = rows.find((r) => r.id === input.id);
						if (!row || !same(row.ref, target) || row.state !== "pending" || Date.now() >= row.expiresAt)
							return denied();
						row.state = input.allow ? "allowed" : "denied";
						row.decidedBy = people.current(actor).id;
						return freeze(structuredClone(row));
					}, verify);
					const active = live.get(input.id);
					if (!active) return denied();
					active.decisionCheck = verify;
					active.wake();
					return chosen;
				},
			});
		},
		async invoke(target, scope, tool, args, effect, signal) {
			const verify = () => {
				current(target);
				if (signal?.aborted) return denied();
				catalog.checkInvocation(target, scope);
			};
			verify();
			if (!/^[-a-zA-Z0-9_]{1,80}$/.test(tool)) throw Error("Invalid approved tool");
			const key = randomUUID(),
				createdAt = Date.now(),
				row: Row = {
					id: key,
					ref: ref(target),
					tool,
					arguments: freeze(jsonObject(args)),
					createdAt,
					expiresAt: createdAt + timeoutMs,
					state: "pending",
				};
			let wake!: () => void;
			const waiting = new Promise<void>((resolve) => {
					wake = resolve;
				}),
				active = { check: verify, wake };
			live.set(key, active);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await mutate((rows) => {
					rows.push(row);
				}, verify);
				verify();
				if (options.notifications) {
					void options.notifications
						.publish({
							requestId: "approval." + key,
							target: row.ref,
							kind: "approval",
							preview: "A tool call is waiting for your decision.",
						})
						.catch(() => {});
				}
				timer = setTimeout(wake, Math.max(1, row.expiresAt - Date.now()));
				signal?.addEventListener("abort", wake, { once: true });
				const before = await read();
				if (before.rows.find((r) => r.id === key)?.state === "pending" && !signal?.aborted) await waiting;
				verify();
				let chosen = (await read()).rows.find((r) => r.id === key);
				if (chosen?.state === "denied") return "APPROVAL-DENIED: the human declined this exact tool call";
				if (!chosen || chosen.state !== "allowed" || !chosen.decidedBy || Date.now() >= chosen.expiresAt)
					throw Error("Unconfirmed or expired approval");
				const approvedBy = chosen.decidedBy;
				const effectCheck = () => {
					verify();
					const decisionCheck = live.get(key)?.decisionCheck;
					if (!decisionCheck) return denied();
					decisionCheck();
					if (Date.now() >= row.expiresAt) return denied();
					people.authorizePerson(approvedBy, "manage", target.conversationId);
				};
				effectCheck();
				await mutate((rows) => {
					const currentRow = rows.find((r) => r.id === key);
					if (!currentRow || currentRow.state !== "allowed" || currentRow.decidedBy !== approvedBy)
						return denied();
					currentRow.state = "running";
				}, effectCheck);
				effectCheck();
				const result = await effect();
				if (typeof result !== "string") throw Error("Unconfirmed native tool result");
				verify();
				await mutate((rows) => {
					const completed = rows.find((r) => r.id === key);
					if (!completed || completed.state !== "running") throw Error("Unconfirmed approval completion");
					completed.state = "done";
				}, effectCheck);
				return result;
			} catch {
				await unknown(key);
				return "APPROVAL-UNKNOWN: execution could not be confirmed; do not replay this call";
			} finally {
				if (timer) clearTimeout(timer);
				signal?.removeEventListener("abort", wake);
				if (live.get(key) === active) live.delete(key);
			}
		},
	};
	return Object.freeze(service);
}

/** Host-selected wrapper. The binding resolver never enters a browser or model payload. */
export function approvalTool(
	tool: ApprovedTool,
	binding: () => { readonly approvals: PocketApprovals; readonly target: ConversationRef },
): ApprovedTool {
	return Object.freeze({
		...tool,
		execute: async (
			args: Record<string, unknown>,
			signal: AbortSignal | undefined,
			scope: ToolInvocationScope,
		) => {
			const current = binding();
			const exact = freeze(jsonObject(args));
			return current.approvals.invoke(
				current.target,
				scope,
				tool.name,
				exact,
				() => tool.execute(exact, signal, scope),
				signal,
			);
		},
	});
}
