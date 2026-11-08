import { createHash, randomUUID } from "node:crypto";
import type { Runtime, JsonObject, ConversationRef, ToolInvocationScope } from "@pakka/agent";
import {
	TicketError,
	type Ticket,
	type TicketActor,
	type TicketClient,
	type TicketEvent,
	type TicketHandler,
	type TicketReceipt,
	type TicketRole,
	type TicketService,
	type TicketView,
	type TicketDispatcher,
	type TicketDelivery,
} from "./types.ts";
import {
	content,
	frozen,
	handler,
	identity,
	integer,
	links,
	receipt,
	shape,
	state,
	text,
	ticket,
	route,
} from "./validation.ts";
export type * from "./types.ts";
export { TicketError } from "./types.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };
type Row = Mutable<Ticket>;
type StoredRequest = { actorId: string; requestId: string; fingerprint: string; receipt: TicketReceipt };
type Store = { schema: 1; sessionId: string; tickets: Row[]; requests: StoredRequest[] };
export interface TicketServiceOptions {
	readonly runtime: Runtime;
	readonly namespace: string;
	readonly handlers?: readonly TicketHandler[];
	readonly dispatcher?: TicketDispatcher;
	readonly maxTickets?: number;
	readonly maxRequests?: number;
	readonly maxBytes?: number;
}
export interface NativeTicketBinding {
	readonly actor: TicketActor;
	readonly source: ConversationRef;
}
export interface NativeTicketService extends TicketService {
	/** Trusted binding to a current native invocation. */
	forInvocation(binding: NativeTicketBinding, scope: ToolInvocationScope): TicketClient;
}
const fingerprint = (value: unknown): string => {
	const canonical = (v: unknown): string => {
		if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
		if (v && typeof v === "object")
			return (
				"{" +
				Object.entries(v)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, child]) => JSON.stringify(key) + ":" + canonical(child))
					.join(",") +
				"}"
			);
		const encoded = JSON.stringify(v);
		if (encoded === undefined) throw new TicketError("invalid", "Invalid ticket payload");
		return encoded;
	};
	return createHash("sha256").update(canonical(value)).digest("hex");
};

/** A host-owned ticket space. Construction and reads never start Agent work. */
export async function createTicketService(options: TicketServiceOptions): Promise<NativeTicketService> {
	const { runtime, namespace, dispatcher } = options;
	identity(namespace);
	const maxTickets = options.maxTickets ?? 256,
		maxRequests = options.maxRequests ?? 4096,
		maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
	integer(maxTickets, 1, 4096);
	integer(maxRequests, 1, 32768);
	integer(maxBytes, 1024, 16 * 1024 * 1024);
	const handlers = structuredClone(options.handlers ?? []);
	if (handlers.length > 64) throw new TicketError("invalid", "Too many ticket handlers");
	handlers.forEach(handler);
	if (new Set(handlers.map((r) => r.id)).size !== handlers.length)
		throw new TicketError("invalid", "Duplicate handler");
	frozen(handlers);
	const store = runtime.store({ namespace, maxBytes }),
		sessionId = runtime.view().sessionId;
	let broken = false,
		tail: Promise<unknown> = Promise.resolve();
	const ready = () => {
		if (broken || runtime.view().phase !== "ready")
			throw new TicketError("unknown", "Ticket storage is unavailable");
	};
	function decode(data: JsonObject, version: number): Store {
		if (version === 0 && Object.keys(data).length === 0)
			return { schema: 1, sessionId, tickets: [], requests: [] };
		shape(data, ["schema", "sessionId", "tickets", "requests"]);
		if (
			data.schema !== 1 ||
			data.sessionId !== sessionId ||
			!Array.isArray(data.tickets) ||
			data.tickets.length > maxTickets ||
			!Array.isArray(data.requests) ||
			data.requests.length > maxRequests
		)
			throw Error("Unconfirmed ticket storage");
		const tickets = data.tickets.map((value) => {
			ticket(value);
			if (Buffer.byteLength(JSON.stringify(value)) > 192 * 1024)
				throw Error("Ticket exceeds readable capacity");
			return structuredClone(value) as Row;
		});
		if (new Set(tickets.map((r) => r.id)).size !== tickets.length) throw Error("Duplicate stored ticket");
		const ids = new Set(tickets.map((r) => r.id));
		const requestKeys = new Set<string>(),
			requests: StoredRequest[] = [];
		for (const row of data.requests) {
			shape(row, ["actorId", "requestId", "fingerprint", "receipt"]);
			identity(row.actorId);
			identity(row.requestId);
			receipt(row.receipt);
			if (
				typeof row.fingerprint !== "string" ||
				!/^[a-f0-9]{64}$/.test(row.fingerprint) ||
				row.requestId !== row.receipt.requestId ||
				!ids.has(row.receipt.id)
			)
				throw Error("Invalid stored request");
			const key = JSON.stringify([row.actorId, row.requestId]);
			if (requestKeys.has(key)) throw Error("Duplicate stored request");
			requestKeys.add(key);
			requests.push({
				actorId: row.actorId,
				requestId: row.requestId,
				fingerprint: row.fingerprint,
				receipt: structuredClone(row.receipt),
			});
		}
		return { schema: 1, sessionId, tickets, requests };
	}
	async function read() {
		ready();
		try {
			const snapshot = await store.snapshot();
			return { version: snapshot.version, data: decode(snapshot.data, snapshot.version) };
		} catch {
			broken = true;
			throw new TicketError("unknown", "Ticket storage could not be verified");
		}
	}
	await read();
	async function save(saved: { version: number; data: Store }, check: () => void) {
		if (saved.data.tickets.some((row) => Buffer.byteLength(JSON.stringify(row)) > 192 * 1024))
			throw new TicketError(
				"capacity",
				"Ticket history reached its readable capacity; retain further material as external references",
			);
		if (Buffer.byteLength(JSON.stringify(saved.data)) > maxBytes)
			throw new TicketError("capacity", "Ticket storage capacity reached");
		const data: JsonObject = {
			...saved.data,
			tickets: saved.data.tickets.map((row) => ({
				...row,
				handler: row.handler ? { ...row.handler } : null,
				revisions: row.revisions.map((revision) => ({ ...revision })),
				events: row.events.map((event) => ({ ...event })),
				runs: row.runs.map((run) => ({
					...run,
					route: {
						...run.route,
						target: { ...run.route.target },
						source: run.route.source ? { ...run.route.source } : null,
					},
				})),
			})),
			requests: saved.data.requests.map((request) => ({ ...request, receipt: { ...request.receipt } })),
		};
		let refused = false;
		const verify = () => {
			try {
				check();
			} catch (error) {
				refused = true;
				throw error;
			}
		};
		verify();
		try {
			await store.compareAndSet(saved.version, data, verify);
		} catch {
			if (refused) throw new TicketError("denied", "Ticket authority changed before commit");
			broken = true;
			throw new TicketError(
				"unknown",
				"Ticket write could not be confirmed; query the original request after recovery",
			);
		}
		try {
			check();
		} catch {
			throw new TicketError(
				"unknown",
				"The write committed but current access ended; reconcile its original request when access is restored",
			);
		}
	}
	function connect(actor: TicketActor): TicketClient {
		identity(actor.id);
		if (typeof actor.check !== "function" || typeof actor.role !== "function")
			throw new TicketError("invalid", "Trusted ticket actor required");
		const actorId = actor.id,
			role = actor.role.bind(actor),
			actorCheck = actor.check.bind(actor);
		const current = (): TicketRole => {
			ready();
			try {
				actorCheck();
				const value = role();
				if (!value || !["reader", "submitter", "handler", "manager"].includes(value)) throw Error("No role");
				return value;
			} catch {
				throw new TicketError("denied", "Ticket access denied");
			}
		};
		const permissions = (row: Ticket) => {
			const value = current(),
				manage = value === "manager",
				own = row.authorId === actorId;
			return {
				edit: manage || (own && value !== "reader"),
				report: manage || (value === "handler" && row.handler?.actorId === actorId),
				assign: manage,
				dispatch: manage && !!dispatcher,
			};
		};
		const visible = (row: Ticket) => {
			const value = current();
			return (
				value === "manager" ||
				row.authorId === actorId ||
				(value === "handler" && row.handler?.actorId === actorId)
			);
		};
		function find(data: Store, id: string): Row {
			const row = data.tickets.find((item) => item.id === id);
			if (!row || !visible(row)) throw new TicketError("denied", "Ticket access denied");
			return row;
		}
		function authorize(row: Ticket, action: keyof TicketView["permissions"]) {
			if (!permissions(row)[action]) throw new TicketError("denied", "Ticket action denied");
		}
		function event(row: Row, kind: TicketEvent["kind"], note: string, refs: readonly string[] = []) {
			if (row.events.length >= 256) throw new TicketError("capacity", "Ticket history capacity reached");
			row.version++;
			row.updatedAt = Date.now();
			row.events.push({
				version: row.version,
				actorId,
				at: row.updatedAt,
				kind,
				state: row.state,
				text: note,
				links: [...refs],
			});
		}
		function mutate(
			op: "submit" | keyof TicketView["permissions"],
			input: { requestId: string },
			change: (data: Store) => Row,
		): Promise<TicketReceipt> {
			current();
			identity(input.requestId);
			const original = structuredClone(input),
				hash = fingerprint([op, original]);
			const result = tail.then(async () => {
				current();
				const saved = await read();
				current();
				const prior = saved.data.requests.find(
					(r) => r.actorId === actorId && r.requestId === original.requestId,
				);
				if (prior) {
					find(saved.data, prior.receipt.id);
					if (prior.fingerprint !== hash)
						throw new TicketError("conflict", "Ticket request payload conflicts with the original");
					return frozen(structuredClone(prior.receipt));
				}
				if (saved.data.requests.length >= maxRequests)
					throw new TicketError("capacity", "Ticket request capacity reached");
				const row = change(saved.data);
				const output: TicketReceipt = {
					requestId: original.requestId,
					id: row.id,
					version: row.version,
					contentRevision: row.contentRevision,
					state: row.state,
					runId: op === "dispatch" ? row.runs.at(-1)!.id : null,
				};
				saved.data.requests.push({
					actorId,
					requestId: original.requestId,
					fingerprint: hash,
					receipt: output,
				});
				await save(saved, () => {
					if (op === "submit") {
						if (current() === "reader") throw new TicketError("denied", "Ticket submission denied");
					} else authorize(row, op);
				});
				return frozen(structuredClone(output));
			});
			tail = result.catch(() => {});
			return result;
		}
		const version = (row: Ticket, expected: number) => {
			integer(expected);
			if (row.version !== expected)
				throw new TicketError("conflict", "Ticket changed; reload before editing");
		};
		async function updateRun(id: string, runId: string, delivery: TicketDelivery | null) {
			const operation = tail.then(async () => {
				current();
				const saved = await read();
				current();
				const row = find(saved.data, id),
					index = row.runs.findIndex((run) => run.id === runId);
				if (index < 0) throw new TicketError("invalid", "Unknown ticket run");
				const run = row.runs[index]!;
				// Native terminal receipts are historical facts; a delayed/failed read cannot undo them.
				if (
					["done", "unanswered"].includes(run.state) ||
					(run.state === "placed" && delivery?.state === "queued")
				)
					return frozen({ ticket: row, permissions: permissions(row) });
				const next = delivery
					? { ...run, state: delivery.state, receiptId: delivery.id }
					: { ...run, state: "unknown" as const };
				if (run.state !== next.state || run.receiptId !== next.receiptId) {
					row.runs[index] = next;
					event(row, "observed", "Delivery " + next.state);
					await save(saved, current);
				}
				return frozen({ ticket: row, permissions: permissions(row) });
			});
			tail = operation.catch(() => {});
			return operation;
		}
		const client: TicketClient = {
			actorId,
			async submit(raw) {
				shape(raw, ["requestId", "title", "body", "sources"]);
				content(raw);
				identity(raw.requestId);
				const input = structuredClone(raw);
				return mutate("submit", input, (data) => {
					if (current() === "reader") throw new TicketError("denied", "Ticket submission denied");
					if (data.tickets.length >= maxTickets) throw new TicketError("capacity", "Ticket capacity reached");
					const at = Date.now(),
						value = { title: input.title, body: input.body, sources: [...input.sources] };
					const row: Row = {
						...value,
						id: randomUUID(),
						authorId: actorId,
						version: 0,
						contentRevision: 1,
						state: "open",
						handler: null,
						createdAt: at,
						updatedAt: at,
						revisions: [{ ...value, revision: 1, actorId, at }],
						events: [],
						runs: [],
					};
					event(row, "submitted", "Ticket submitted");
					data.tickets.push(row);
					return row;
				});
			},
			async edit(raw) {
				shape(raw, ["requestId", "id", "expectedVersion", "title", "body", "sources"]);
				content(raw);
				identity(raw.id);
				integer(raw.expectedVersion);
				const input = structuredClone(raw);
				return mutate("edit", input, (data) => {
					const row = find(data, input.id);
					authorize(row, "edit");
					version(row, input.expectedVersion);
					if (row.revisions.length >= 128)
						throw new TicketError("capacity", "Ticket revision capacity reached");
					row.title = input.title;
					row.body = input.body;
					row.sources = [...input.sources];
					row.contentRevision++;
					row.revisions.push({
						title: row.title,
						body: row.body,
						sources: [...row.sources],
						revision: row.contentRevision,
						actorId,
						at: Date.now(),
					});
					event(row, "edited", "Ticket content updated");
					return row;
				});
			},
			async get(id) {
				identity(id);
				current();
				const saved = await read();
				current();
				const row = find(saved.data, id);
				return frozen({ ticket: row, permissions: permissions(row) });
			},
			async list(raw = {}) {
				shape(raw, [], ["state", "mine", "cursor", "limit"]);
				if (raw.state !== undefined) state(raw.state);
				if (raw.mine !== undefined && typeof raw.mine !== "boolean")
					throw new TicketError("invalid", "Invalid ticket query");
				if (raw.cursor !== undefined) identity(raw.cursor);
				const query = structuredClone(raw),
					limit = query.limit ?? 20;
				integer(limit, 1, 50);
				current();
				const saved = await read();
				current();
				const rows = saved.data.tickets.filter(
					(r) =>
						visible(r) &&
						(!query.mine || r.authorId === actorId) &&
						(!query.state || r.state === query.state),
				);
				const start = query.cursor ? rows.findIndex((r) => r.id === query.cursor) + 1 : 0;
				if (query.cursor && start === 0)
					throw new TicketError("conflict", "Ticket page changed; refresh the list");
				const selected = rows.slice(start, start + limit);
				return frozen({
					items: selected.map(({ id, title, authorId, state, version, updatedAt, handler }) => ({
						id,
						title,
						authorId,
						state,
						version,
						updatedAt,
						handler,
					})),
					cursor: start + limit < rows.length ? selected.at(-1)!.id : null,
				});
			},
			async lookup(requestId) {
				identity(requestId);
				current();
				const saved = await read();
				current();
				const row = saved.data.requests.find((r) => r.actorId === actorId && r.requestId === requestId);
				if (!row) return null;
				find(saved.data, row.receipt.id);
				return frozen(structuredClone(row.receipt));
			},
			async assign(raw) {
				shape(raw, ["requestId", "id", "expectedVersion", "handlerId"]);
				identity(raw.id);
				integer(raw.expectedVersion);
				if (raw.handlerId !== null) identity(raw.handlerId);
				const input = structuredClone(raw);
				return mutate("assign", input, (data) => {
					const row = find(data, input.id);
					authorize(row, "assign");
					version(row, input.expectedVersion);
					const selected = input.handlerId === null ? null : handlers.find((r) => r.id === input.handlerId);
					if (selected === undefined) throw new TicketError("invalid", "Unknown ticket handler");
					row.handler = selected === null ? null : structuredClone(selected);
					event(row, "assigned", selected ? `Assigned to ${selected.label}` : "Handler removed");
					return row;
				});
			},
			async report(raw) {
				shape(raw, ["requestId", "id", "expectedVersion", "state", "text", "links"]);
				identity(raw.id);
				integer(raw.expectedVersion);
				state(raw.state);
				text(raw.text, 12000, true);
				links(raw.links);
				const input = structuredClone(raw);
				return mutate("report", input, (data) => {
					const row = find(data, input.id);
					authorize(row, "report");
					version(row, input.expectedVersion);
					row.state = input.state;
					event(row, "reported", input.text, input.links);
					return row;
				});
			},
			async dispatch(raw) {
				shape(raw, ["requestId", "id", "expectedVersion"]);
				identity(raw.id);
				integer(raw.expectedVersion);
				const input = structuredClone(raw);
				let created = false;
				const result = await mutate("dispatch", input, (data) => {
					const row = find(data, input.id);
					authorize(row, "dispatch");
					version(row, input.expectedVersion);
					if (!dispatcher || !row.handler || row.state === "closed")
						throw new TicketError("invalid", "An open ticket and approved handler are required");
					if (row.runs.some((run) => ["pending", "queued", "placed", "unknown"].includes(run.state)))
						throw new TicketError("conflict", "Existing ticket run needs reconciliation");
					if (row.runs.length >= 64) throw new TicketError("capacity", "Ticket run capacity reached");
					const address = dispatcher.plan(row.handler.id);
					route(address);
					if (address.handlerId !== row.handler.id) throw new TicketError("invalid", "Wrong handler route");
					const id = randomUUID();
					row.runs.push({
						id,
						route: structuredClone(address),
						handlerId: row.handler.id,
						contentRevision: row.contentRevision,
						actorId,
						at: Date.now(),
						requestId: input.requestId,
						state: "pending",
						receiptId: null,
					});
					row.state = "active";
					event(row, "dispatched", "Dispatched to " + row.handler.label);
					created = true;
					return row;
				});
				if (!created) return result;
				const view = await client.get(result.id),
					run = view.ticket.runs.find((r) => r.id === result.runId)!;
				const revision = view.ticket.revisions.find((r) => r.revision === run.contentRevision)!;
				let delivery: TicketDelivery | null = null;
				try {
					delivery = await dispatcher!.send(
						run.route,
						{
							requestId: "ticket-" + run.id,
							text: JSON.stringify({
								ticketId: view.ticket.id,
								revision: revision.revision,
								title: revision.title,
								body: revision.body,
								sources: revision.sources,
							}),
						},
						() => {
							current();
							if (current() !== "manager") throw new TicketError("denied", "Dispatch authority changed");
						},
					);
					identity(delivery.id);
					if (!["queued", "placed", "done", "unanswered", "unknown"].includes(delivery.state))
						throw Error("Invalid delivery state");
				} catch {
					delivery = null;
				}
				await updateRun(result.id, run.id, delivery);
				return result;
			},
			async refresh(raw) {
				shape(raw, ["id", "runId"]);
				identity(raw.id);
				identity(raw.runId);
				const view = await client.get(raw.id),
					run = view.ticket.runs.find((r) => r.id === raw.runId);
				if (!run) throw new TicketError("invalid", "Unknown ticket run");
				if (!dispatcher || !run.receiptId) return view;
				let delivery: TicketDelivery | null = null;
				try {
					delivery = await dispatcher.observe(run.route, run.receiptId, current);
					if (
						delivery.id !== run.receiptId ||
						!["queued", "placed", "done", "unanswered", "unknown"].includes(delivery.state)
					)
						throw Error("Invalid delivery observation");
				} catch {
					delivery = null;
				}
				return updateRun(raw.id, raw.runId, delivery);
			},
			capabilities: () => {
				const value = current();
				return frozen({
					submit: value !== "reader",
					manage: value === "manager",
					dispatch: value === "manager" && !!dispatcher,
					handlers: value === "manager" ? handlers : [],
				});
			},
			withAuthority: (check) =>
				connect({
					id: actorId,
					role,
					check: () => {
						actorCheck();
						check();
					},
				}),
		};
		return Object.freeze(client);
	}
	return Object.freeze({
		connect,
		forInvocation(binding: NativeTicketBinding, scope: ToolInvocationScope) {
			const catalog = runtime.catalog({
				namespace: namespace + ".invocations",
				maxDeliveries: 1,
				maxPending: 1,
			});
			const source = structuredClone(binding.source);
			return connect(binding.actor).withAuthority(() => catalog.checkInvocation(source, scope));
		},
	});
}
