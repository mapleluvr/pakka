import { createHash, randomUUID } from "node:crypto";
import type { Runtime, ConversationRef, ToolInvocationScope } from "@pakka/agent";
import { createWorkClient } from "./work-client.ts";
import { ticketRepository, dispatchText, payloadHash, type Row, type Draft } from "./repository.ts";
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
	shape,
	state,
	text,
	route,
} from "./validation.ts";
export type * from "./types.ts";
export { TicketError } from "./types.ts";

type Store = Draft["data"];
export interface TicketServiceOptions {
	readonly runtime: Runtime;
	readonly namespace: string;
	readonly handlers?: readonly TicketHandler[];
	readonly dispatcher?: TicketDispatcher;
	/** Legacy workbench options are retained for source compatibility; cumulative limits are not applied. */
	readonly maxTickets?: number;
	readonly maxRequests?: number;
	/** Exact original RuntimeStore maxBytes, used only during legacy migration. */
	readonly maxBytes?: number;
	/** Host confirms a cold backup and paused old consumers before migrating schema 1. */
	readonly migrateLegacy?: boolean;
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
	const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
	integer(maxBytes, 1024, 16 * 1024 * 1024);
	const handlers = structuredClone(options.handlers ?? []);
	if (handlers.length > 64) throw new TicketError("invalid", "Too many ticket handlers");
	handlers.forEach(handler);
	if (new Set(handlers.map((r) => r.id)).size !== handlers.length)
		throw new TicketError("invalid", "Duplicate handler");
	frozen(handlers);
	const repository = await ticketRepository(runtime, namespace, maxBytes, options.migrateLegacy === true);
	const ready = repository.check,
		save = repository.save;
	let tail: Promise<unknown> = Promise.resolve();
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
		const permissions = (row: Pick<Ticket, "authorId" | "handler">) => {
			const value = current(),
				manage = value === "manager",
				own = row.authorId === actorId;
			return {
				edit: manage || (own && value !== "reader"),
				setState: manage || (value === "handler" && row.handler?.actorId === actorId),
				assign: manage,
				dispatch: manage && !!dispatcher,
			};
		};
		const visible = (row: Pick<Ticket, "authorId" | "handler">, value = current()) => {
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
			op: "submit" | "recover" | "setState" | keyof TicketView["permissions"],
			input: { requestId: string; id?: string; runId?: string },
			change: (data: Store) => Row,
		): Promise<TicketReceipt> {
			current();
			identity(input.requestId);
			const original = structuredClone(input),
				hash = fingerprint([op, original]);
			const result = tail.then(async () => {
				current();
				const prior = await repository.lookup(actorId, original.requestId);
				if (prior && (prior.fingerprint !== hash || "kind" in prior.receipt))
					throw new TicketError("conflict", "Ticket request payload conflicts with the original");
				const saved = await repository.draft(prior?.receipt.id ?? original.id, original.runId);
				current();
				if (prior && !("kind" in prior.receipt)) {
					find(saved.data, prior.receipt.id);
					if (prior.fingerprint !== hash)
						throw new TicketError("conflict", "Ticket request payload conflicts with the original");
					return frozen(structuredClone(prior.receipt));
				}
				const row = change(saved.data);
				const output: TicketReceipt = {
					requestId: original.requestId,
					id: row.id,
					version: row.version,
					contentRevision: row.contentRevision,
					state: row.state,
					runId: op === "dispatch" || op === "recover" ? row.runs.at(-1)!.id : null,
				};
				saved.data.requests.push({
					actorId,
					requestId: original.requestId,
					fingerprint: hash,
					receipt: output,
				});
				const existing = await save(saved, () => {
					if (op === "submit") {
						if (current() === "reader") throw new TicketError("denied", "Ticket submission denied");
					} else authorize(row, op === "recover" ? "dispatch" : op);
				});
				if (existing) {
					if (existing.fingerprint !== hash || "kind" in existing.receipt)
						throw new TicketError("conflict", "Ticket request payload conflicts with the original");
					const retained = await repository.draft(existing.receipt.id);
					find(retained.data, existing.receipt.id);
					return frozen(structuredClone(existing.receipt));
				}
				return frozen(structuredClone(output));
			});
			tail = result.catch(() => {});
			return result;
		}
		const publicationError = () =>
			new TicketError(
				"unknown",
				"Ticket mutation committed but cannot be published; look up the original request",
			);
		// Called only after mutate has returned its durable receipt. Continuation failures
		// cannot turn that committed business request into a definite refusal.
		async function prepareReceipt(receipt: TicketReceipt, continueRun?: () => Promise<unknown>) {
			try {
				if (continueRun) await continueRun();
				const assignment = repository.publication(receipt.id);
				try {
					const head = await repository.head(receipt.id);
					return { receipt, row: head.value, assignment };
				} catch (error) {
					assignment.release();
					throw error;
				}
			} catch {
				throw publicationError();
			}
		}
		// Each public mutation invokes this synchronously after its final await.
		// Publication requires the concrete ticket read right, not its former write role.
		function publishReceipt(publication: Awaited<ReturnType<typeof prepareReceipt>>): TicketReceipt {
			try {
				const value = current(),
					row = publication.row;
				if (!row || !visible(row, value)) throw publicationError();
				// Only a non-author handler depends on the mutable assignment snapshot.
				if (value !== "manager" && row.authorId !== actorId) publication.assignment.check();
				return publication.receipt;
			} catch {
				throw publicationError();
			} finally {
				publication.assignment.release();
			}
		}
		const version = (row: Ticket, expected: number) => {
			integer(expected);
			if (row.version !== expected)
				throw new TicketError("conflict", "Ticket changed; reload before editing");
		};
		async function updateRun(id: string, runId: string, delivery: TicketDelivery | null) {
			const operation = tail.then(async () => {
				current();
				const saved = await repository.draft(id, runId);
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
					return client.get(id);
				if (run.receiptId && delivery && run.receiptId !== delivery.id)
					throw new TicketError("conflict", "Original run receipt identity changed");
				const next = delivery
					? { ...run, state: delivery.state, receiptId: delivery.id, stage: "accepted" as const }
					: {
							...run,
							state: "unknown" as const,
							stage: run.receiptId ? ("accepted" as const) : ("unknown" as const),
						};
				if (run.state !== next.state || run.receiptId !== next.receiptId || run.stage !== next.stage) {
					row.runs[index] = next;
					event(row, "observed", "Delivery " + next.state);
					await save(saved, current);
				}
				return client.get(id);
			});
			tail = operation.catch(() => {});
			return operation;
		}
		const managerAuthority = () => {
			if (current() !== "manager") throw new TicketError("denied", "Dispatch authority changed");
		};
		async function executeRun(id: string, runId: string) {
			const claim = tail.then(async () => {
				managerAuthority();
				const saved = await repository.draft(id, runId),
					row = find(saved.data, id),
					run = row.runs[0];
				if (!run || !dispatcher) throw new TicketError("invalid", "Run dispatcher unavailable");
				if (run.stage !== "planned") return null;
				const currentRoute = dispatcher.plan(run.handlerId);
				if (fingerprint(currentRoute) !== fingerprint(run.route))
					throw new TicketError("denied", "Original dispatch route changed");
				const input = await repository.input(run);
				dispatcher.validate(run.route, input);
				row.runs[0] = { ...run, stage: "dispatching" };
				event(row, "observed", "Dispatch started");
				await save(saved, managerAuthority);
				return { run, input };
			});
			tail = claim.catch(() => {});
			const started = await claim;
			if (!started) return client.refresh({ id, runId });
			let delivery: TicketDelivery | null = null;
			try {
				delivery = await dispatcher!.send(started.run.route, started.input, managerAuthority);
				identity(delivery.id);
				if (!["queued", "placed", "done", "unanswered", "unknown"].includes(delivery.state))
					throw Error("Invalid delivery state");
			} catch {
				delivery = null;
			}
			return updateRun(id, runId, delivery);
		}
		const workClient = createWorkClient({
			repository,
			runtime,
			namespace,
			actorId,
			current,
			fingerprint,
			handlers,
		});
		const client: TicketClient = {
			...workClient.client,
			actorId,
			async submit(raw) {
				shape(raw, ["requestId", "title", "body", "sources"]);
				content(raw);
				identity(raw.requestId);
				const input = structuredClone(raw);
				return publishReceipt(
					await prepareReceipt(
						await mutate("submit", input, (data) => {
							if (current() === "reader") throw new TicketError("denied", "Ticket submission denied");
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
						}),
					),
				);
			},
			async edit(raw) {
				shape(raw, ["requestId", "id", "expectedVersion", "title", "body", "sources"]);
				content(raw);
				identity(raw.id);
				integer(raw.expectedVersion);
				const input = structuredClone(raw);
				return publishReceipt(
					await prepareReceipt(
						await mutate("edit", input, (data) => {
							const row = find(data, input.id);
							authorize(row, "edit");
							version(row, input.expectedVersion);
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
						}),
					),
				);
			},
			async observe() {
				const role = current();
				const streams =
					role === "manager"
						? ["changes:all"]
						: ["changes:author:" + actorId, ...(role === "handler" ? ["changes:handler:" + actorId] : [])];
				const revisions = [];
				for (const stream of streams) revisions.push(await repository.records.revision(stream, current));
				if (role !== current()) throw new TicketError("denied", "Observation authority changed");
				return frozen({
					revision: fingerprint([runtime.view().sessionId, namespace, actorId, role, revisions]),
				});
			},
			async get(id) {
				identity(id);
				current();
				const head = await repository.head(id);
				if (!head.value || !visible(head.value)) throw new TicketError("denied", "Ticket access denied");
				const view = await repository.view(id);
				if (!view || !visible(view.ticket)) throw new TicketError("denied", "Ticket access denied");
				return frozen({ ...view, permissions: permissions(view.ticket) });
			},
			async history(raw) {
				shape(raw, ["id", "kind"], ["cursor", "limit"]);
				identity(raw.id);
				if (!["revisions", "events", "runs"].includes(raw.kind))
					throw new TicketError("invalid", "Invalid history kind");
				if (raw.cursor !== undefined) text(raw.cursor, 2048, true);
				if (raw.limit !== undefined) integer(raw.limit, 1, 32);
				const query = structuredClone(raw);
				current();
				const before = await repository.head(query.id);
				if (!before.value || !visible(before.value)) throw new TicketError("denied", "Ticket access denied");
				const page = await repository.history(query);
				const after = await repository.head(query.id);
				if (!after.value || !visible(after.value)) throw new TicketError("denied", "Ticket access denied");
				return frozen(page);
			},
			async list(raw = {}) {
				shape(raw, [], ["state", "mine", "cursor", "limit"]);
				if (raw.state !== undefined) state(raw.state);
				if (raw.mine !== undefined && typeof raw.mine !== "boolean")
					throw new TicketError("invalid", "Invalid ticket query");
				if (raw.cursor !== undefined) text(raw.cursor, 2048, true);
				const query: import("./types.ts").TicketQuery = structuredClone(raw),
					limit = query.limit ?? 20;
				integer(limit, 1, 50);
				const roleNow = current(),
					binding = fingerprint([
						runtime.view().sessionId,
						namespace,
						actorId,
						roleNow,
						query.state ?? null,
						query.mine ?? false,
					]);
				const index =
					query.mine || (roleNow !== "manager" && roleNow !== "handler") ? "author:" + actorId : "all";
				let cursor: string | null = null;
				if (query.cursor) {
					try {
						const parsed: unknown = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
						shape(parsed, ["binding", "cursor"]);
						if (parsed.binding !== binding || typeof parsed.cursor !== "string") throw Error();
						cursor = parsed.cursor;
					} catch {
						throw new TicketError("conflict", "Ticket cursor does not belong to this query");
					}
				}
				const startCursor = cursor;
				for (let attempt = 0; attempt < 4; attempt++) {
					cursor = startCursor;
					const revision = await repository.records.revision("changes:all", current);
					const items = [];
					let bytes = 512;
					for (let scanned = 0; scanned < 128 && items.length < limit; scanned++) {
						current();
						const before = cursor;
						const page = await repository.records.page(
							{ stream: index, limit: 1, ...(cursor ? { cursor } : {}) },
							current,
						);
						if (!page.items.length) {
							cursor = null;
							break;
						}
						const item = page.items[0]!;
						identity(item.data.id);
						const saved = await repository.head(item.data.id),
							row = saved.value;
						if (
							row &&
							visible(row) &&
							(!query.mine || row.authorId === actorId) &&
							(!query.state || row.state === query.state)
						) {
							const { id, title, authorId, state, version, updatedAt, handler } = row;
							const summary = { id, title, authorId, state, version, updatedAt, handler };
							const size = Buffer.byteLength(JSON.stringify(summary));
							if (items.length && bytes + size > 64 * 1024) {
								cursor = before;
								break;
							}
							items.push(summary);
							bytes += size;
						}
						cursor = page.cursor;
						if (!cursor) break;
					}
					if (revision !== (await repository.records.revision("changes:all", current))) continue;
					if (current() !== roleNow) throw new TicketError("denied", "Ticket query authority changed");
					return frozen({
						items,
						cursor: cursor ? Buffer.from(JSON.stringify({ binding, cursor })).toString("base64url") : null,
					});
				}
				throw new TicketError("conflict", "Tickets changed during listing; read again");
			},
			async lookup(requestId) {
				identity(requestId);
				current();
				const request = await repository.lookup(actorId, requestId);
				if (!request) {
					current();
					return null;
				}
				if ("kind" in request.receipt) return frozen(await workClient.readReceipt(request.receipt));
				const saved = await repository.head(request.receipt.id);
				if (!saved.value || !visible(saved.value)) throw new TicketError("denied", "Ticket access denied");
				return frozen(structuredClone(request.receipt));
			},
			async assign(raw) {
				shape(raw, ["requestId", "id", "expectedVersion", "handlerId"]);
				identity(raw.id);
				integer(raw.expectedVersion);
				if (raw.handlerId !== null) identity(raw.handlerId);
				const input = structuredClone(raw);
				return publishReceipt(
					await prepareReceipt(
						await mutate("assign", input, (data) => {
							const row = find(data, input.id);
							authorize(row, "assign");
							version(row, input.expectedVersion);
							const selected =
								input.handlerId === null ? null : handlers.find((r) => r.id === input.handlerId);
							if (selected === undefined) throw new TicketError("invalid", "Unknown ticket handler");
							row.handler = selected === null ? null : structuredClone(selected);
							event(row, "assigned", selected ? `Assigned to ${selected.label}` : "Handler removed");
							return row;
						}),
					),
				);
			},
			async setState(raw) {
				const input = structuredClone(raw);
				shape(input, ["requestId", "id", "expectedVersion", "state", "text", "links"]);
				identity(input.id);
				integer(input.expectedVersion);
				state(input.state);
				text(input.text, 12000, true);
				links(input.links);
				return publishReceipt(
					await prepareReceipt(
						await mutate("setState", input, (data) => {
							const row = find(data, input.id);
							authorize(row, "setState");
							version(row, input.expectedVersion);
							row.state = input.state;
							event(row, "state-changed", input.text, input.links);
							return row;
						}),
					),
				);
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
					const address = dispatcher.plan(row.handler.id);
					route(address);
					if (address.handlerId !== row.handler.id) throw new TicketError("invalid", "Wrong handler route");
					const id = randomUUID();
					const revision = {
						revision: row.contentRevision,
						actorId,
						at: Date.now(),
						title: row.title,
						body: row.body,
						sources: row.sources,
					};
					const dispatchInput = { requestId: "ticket-" + id, text: dispatchText(row.id, revision, id) };
					dispatcher.validate(address, dispatchInput);
					row.runs.push({
						workId: id,
						id,
						ticketId: row.id,
						stage: "planned",
						dispatchRequestId: dispatchInput.requestId,
						payloadHash: payloadHash(dispatchInput.text),
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
				if (!created) return publishReceipt(await prepareReceipt(result));
				const runId = result.runId;
				if (!runId) throw new TicketError("unknown", "Dispatch plan identity missing");
				return publishReceipt(await prepareReceipt(result, () => executeRun(result.id, runId)));
			},
			async recover(raw) {
				shape(raw, ["id", "runId", "requestId", "expectedVersion"]);
				identity(raw.id);
				identity(raw.runId);
				identity(raw.requestId);
				integer(raw.expectedVersion);
				managerAuthority();
				let created = false;
				const result = await mutate("recover", structuredClone(raw), (data) => {
					const row = find(data, raw.id);
					authorize(row, "dispatch");
					version(row, raw.expectedVersion);
					if (!row.runs.some((run) => run.id === raw.runId))
						throw new TicketError("denied", "Run not found for this ticket");
					event(row, "observed", "Explicit run recovery requested");
					created = true;
					return row;
				});
				return publishReceipt(
					await prepareReceipt(result, created ? () => executeRun(raw.id, raw.runId) : undefined),
				);
			},
			async refresh(raw) {
				shape(raw, ["id", "runId"]);
				identity(raw.id);
				identity(raw.runId);
				const query = structuredClone(raw);
				await client.get(query.id);
				const run = await repository.run(query.id, query.runId);
				if (!dispatcher || run.stage === "planned") return client.get(query.id);
				let delivery: TicketDelivery | null = null;
				try {
					delivery = run.receiptId
						? await dispatcher.observe(run.route, run.receiptId, current)
						: await dispatcher.lookup(run.route, await repository.input(run), current);
					if (
						delivery &&
						((run.receiptId && delivery.id !== run.receiptId) ||
							!["queued", "placed", "done", "unanswered", "unknown"].includes(delivery.state))
					)
						throw Error("Invalid delivery observation");
				} catch {
					delivery = null;
				}
				return updateRun(query.id, query.runId, delivery);
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
