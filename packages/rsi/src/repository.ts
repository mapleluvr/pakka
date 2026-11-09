import type { JsonObject, Runtime, RuntimeRecord } from "@pakka/agent";
import { createHash, randomUUID } from "node:crypto";
import {
	TicketError,
	type Ticket,
	type TicketReceipt,
	type TicketRun,
	type TicketRevision,
	type TicketEvent,
	type TicketHistoryQuery,
	type TicketHistoryPage,
} from "./types.ts";
import {
	shape,
	identity,
	integer,
	state,
	content,
	handler,
	receipt,
	route,
	text,
	links,
	ticket,
	resultReferences,
} from "./validation.ts";

function recordsRefusal(
	value: unknown,
): value is Error & { code: "invalid" | "conflict" | "capacity" | "denied" } {
	return (
		value instanceof Error &&
		value.name === "RecordsRequestRefusedError" &&
		"code" in value &&
		(value.code === "invalid" ||
			value.code === "conflict" ||
			value.code === "capacity" ||
			value.code === "denied")
	);
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };
export type Row = Mutable<Ticket>;
type Head = Omit<Ticket, "revisions" | "events" | "runs"> & { readonly activeRunId: string | null };
export type StoredRequest = {
	actorId: string;
	requestId: string;
	fingerprint: string;
	receipt: TicketReceipt;
};
export type Draft = {
	cell: RuntimeRecord | null;
	prior: Head | null;
	data: { tickets: Row[]; requests: StoredRequest[] };
};
const keyHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const requestKey = (actor: string, request: string) => "request:" + keyHash([actor, request]);
const headKey = (id: string) => "ticket:" + id;
const runKey = (ticketId: string, id: string) => "run:" + keyHash([ticketId, id]);
export const dispatchText = (ticketId: string, revision: TicketRevision) =>
	JSON.stringify({
		ticketId,
		revision: revision.revision,
		title: revision.title,
		body: revision.body,
		sources: revision.sources,
	});
export const payloadHash = (text: string) => createHash("sha256").update(text).digest("hex");
const stream = (id: string, kind: string) => kind + ":" + id;
function jsonValue(value: unknown): JsonObject {
	let result: unknown;
	try {
		result = JSON.parse(JSON.stringify(value));
	} catch {
		throw new TicketError("invalid", "Ticket data is not serializable JSON");
	}
	if (!result || typeof result !== "object" || Array.isArray(result)) throw Error("Invalid stored object");
	return result as JsonObject;
}
function decodeHead(value: unknown): Head {
	shape(value, [
		"id",
		"authorId",
		"version",
		"contentRevision",
		"state",
		"handler",
		"createdAt",
		"updatedAt",
		"title",
		"body",
		"sources",
		"activeRunId",
	]);
	identity(value.id);
	identity(value.authorId);
	integer(value.version);
	integer(value.contentRevision);
	state(value.state);
	integer(value.createdAt);
	integer(value.updatedAt);
	content(value);
	if (value.handler !== null) handler(value.handler);
	if (value.activeRunId !== null) identity(value.activeRunId);
	return {
		id: value.id,
		authorId: value.authorId,
		version: value.version,
		contentRevision: value.contentRevision,
		state: value.state,
		handler: value.handler,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		title: value.title,
		body: value.body,
		sources: value.sources,
		activeRunId: value.activeRunId,
	};
}
export function decodeRevision(value: unknown): TicketRevision {
	shape(value, ["revision", "actorId", "at", "title", "body", "sources"]);
	integer(value.revision);
	identity(value.actorId);
	integer(value.at);
	content(value);
	return {
		revision: value.revision,
		actorId: value.actorId,
		at: value.at,
		title: value.title,
		body: value.body,
		sources: value.sources,
	};
}
export function decodeEvent(value: unknown): TicketEvent {
	shape(value, ["version", "actorId", "at", "kind", "state", "text", "links"], ["runId", "results"]);
	if (value.runId !== undefined) identity(value.runId);
	if (value.results !== undefined) resultReferences(value.results);
	integer(value.version);
	identity(value.actorId);
	integer(value.at);
	state(value.state);
	text(value.text, 12000);
	links(value.links);
	const kind = value.kind;
	if (
		kind !== "submitted" &&
		kind !== "edited" &&
		kind !== "assigned" &&
		kind !== "reported" &&
		kind !== "dispatched" &&
		kind !== "observed"
	)
		throw Error("Invalid event kind");
	return {
		version: value.version,
		actorId: value.actorId,
		at: value.at,
		kind,
		state: value.state,
		text: value.text,
		links: value.links,
		...(value.runId !== undefined ? { runId: value.runId } : {}),
		...(value.results !== undefined ? { results: value.results } : {}),
	};
}
export function decodeRun(value: unknown): TicketRun {
	shape(value, [
		"id",
		"handlerId",
		"contentRevision",
		"actorId",
		"at",
		"requestId",
		"state",
		"receiptId",
		"route",
		"ticketId",
		"stage",
		"dispatchRequestId",
		"payloadHash",
	]);
	identity(value.ticketId);
	identity(value.dispatchRequestId);
	const stage = value.stage;
	if (stage !== "planned" && stage !== "dispatching" && stage !== "accepted" && stage !== "unknown")
		throw Error("Invalid dispatch checkpoint");
	if (typeof value.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(value.payloadHash))
		throw Error("Invalid dispatch payload identity");
	route(value.route);
	identity(value.id);
	identity(value.handlerId);
	identity(value.actorId);
	identity(value.requestId);
	integer(value.at);
	integer(value.contentRevision);
	const status = value.state;
	if (
		value.route.handlerId !== value.handlerId ||
		(status !== "pending" &&
			status !== "queued" &&
			status !== "placed" &&
			status !== "done" &&
			status !== "unanswered" &&
			status !== "unknown")
	)
		throw Error("Invalid run");
	if (value.receiptId !== null) identity(value.receiptId);
	return {
		ticketId: value.ticketId,
		stage,
		dispatchRequestId: value.dispatchRequestId,
		payloadHash: value.payloadHash,
		id: value.id,
		handlerId: value.handlerId,
		contentRevision: value.contentRevision,
		actorId: value.actorId,
		at: value.at,
		requestId: value.requestId,
		state: status,
		receiptId: value.receiptId,
		route: value.route,
	};
}
function decodeRequest(value: unknown): StoredRequest {
	shape(value, ["actorId", "requestId", "fingerprint", "receipt"]);
	identity(value.actorId);
	identity(value.requestId);
	receipt(value.receipt);
	if (
		value.requestId !== value.receipt.requestId ||
		typeof value.fingerprint !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.fingerprint)
	)
		throw Error("Invalid request receipt");
	return {
		actorId: value.actorId,
		requestId: value.requestId,
		fingerprint: value.fingerprint,
		receipt: value.receipt,
	};
}

/** Only finite pages and exact keys are read; mutable Pi objects never cross this boundary. */
export async function ticketRepository(
	runtime: Runtime,
	namespace: string,
	legacyMaxBytes: number,
	migrateLegacy: boolean,
) {
	const records = runtime.records({ namespace }),
		sessionId = runtime.view().sessionId;
	const check = () => {
		if (runtime.view().phase !== "ready") throw new TicketError("unknown", "Ticket storage is unavailable");
	};
	let broken = false;
	async function verified<T>(operation: () => Promise<T>): Promise<T> {
		if (broken) throw new TicketError("unknown", "Ticket records could not be verified");
		check();
		try {
			return await operation();
		} catch (error) {
			if (recordsRefusal(error)) throw new TicketError(error.code, error.message);
			if (error instanceof TicketError && error.code !== "invalid") throw error;
			broken = true;
			throw new TicketError("unknown", "Ticket records could not be verified");
		}
	}
	async function head(id: string) {
		return verified(async () => {
			const cell = await records.get(headKey(id), check);
			if (!cell.data) return { cell, value: null };
			const value = decodeHead(cell.data);
			if (value.id !== id) throw Error("Wrong ticket identity");
			return { cell, value };
		});
	}
	async function run(ticketId: string, id: string): Promise<TicketRun> {
		return verified(async () => {
			const cell = await records.get(runKey(ticketId, id), check);
			if (!cell.data) throw new TicketError("denied", "Run not found for this ticket");
			const value = decodeRun(cell.data);
			if (value.id !== id || value.ticketId !== ticketId) throw Error("Wrong run identity");
			return value;
		});
	}
	async function lookup(actorId: string, requestId: string): Promise<StoredRequest | null> {
		return verified(async () => {
			const cell = await records.get(requestKey(actorId, requestId), check);
			if (!cell.data) return null;
			const value = decodeRequest(cell.data);
			if (value.actorId !== actorId || value.requestId !== requestId) throw Error("Wrong request identity");
			return value;
		});
	}
	async function draft(id?: string, runId?: string): Promise<Draft> {
		if (!id) return { cell: null, prior: null, data: { tickets: [], requests: [] } };
		const saved = await head(id);
		if (!saved.value) return { cell: saved.cell, prior: null, data: { tickets: [], requests: [] } };
		const { activeRunId, ...value } = saved.value;
		const selected = runId ?? activeRunId;
		return {
			cell: saved.cell,
			prior: saved.value,
			data: {
				tickets: [
					{
						...structuredClone(value),
						sources: [...value.sources],
						revisions: [],
						events: [],
						runs: selected ? [structuredClone(await run(id, selected))] : [],
					},
				],
				requests: [],
			},
		};
	}
	async function save(saved: Draft, authorize: () => void) {
		const row = saved.data.tickets[0];
		if (!row) throw Error("Missing mutation ticket");
		const { revisions, events, runs, ...value } = row;
		let activeRunId = saved.prior?.activeRunId ?? null;
		for (const item of runs) {
			if (["pending", "queued", "placed", "unknown"].includes(item.state)) activeRunId = item.id;
			else if (activeRunId === item.id) activeRunId = null;
		}
		const reads = [{ key: headKey(row.id), version: saved.cell?.version ?? 0 }];
		const writes = [{ key: headKey(row.id), data: jsonValue({ ...value, activeRunId }) }];
		const signals = new Set(["changes:all", "changes:author:" + row.authorId]);
		for (const handler of [row.handler, saved.prior?.handler])
			if (handler) signals.add("changes:handler:" + handler.actorId);
		const append: { stream: string; data: JsonObject }[] = [...signals].map((stream) => ({
			stream,
			data: { id: row.id, version: row.version },
		}));
		if (!saved.prior)
			for (const index of ["all", "author:" + row.authorId])
				append.push({ stream: index, data: { id: row.id } });
		if (row.handler && row.handler.actorId !== saved.prior?.handler?.actorId)
			append.push({
				stream: "handler:" + row.handler.actorId,
				data: { id: row.id, assignedVersion: row.version },
			});
		for (const revision of revisions) {
			const key = `revision:${row.id}:${revision.revision}`;
			reads.push({ key, version: 0 });
			writes.push({ key, data: jsonValue(revision) });
			append.push({ stream: stream(row.id, "revisions"), data: { key } });
		}
		for (const event of events) {
			const data = jsonValue(event);
			if (Buffer.byteLength(JSON.stringify(data)) > 180 * 1024)
				throw new TicketError("capacity", "Ticket event exceeds history item byte budget");
			append.push({ stream: stream(row.id, "events"), data });
		}
		for (const item of runs) {
			const key = runKey(row.id, item.id),
				current = await records.get(key, check);
			reads.push({ key, version: current.version });
			writes.push({ key, data: jsonValue(item) });
			if (!current.data) append.push({ stream: stream(row.id, "runs"), data: { id: item.id } });
		}
		for (const request of saved.data.requests) {
			const key = requestKey(request.actorId, request.requestId);
			reads.push({ key, version: 0 });
			writes.push({ key, data: jsonValue(request) });
		}
		const verify = () => {
			check();
			authorize();
		};
		verify();
		try {
			await records.commit(
				{
					// Business requests have their own durable key; each CAS attempt must earn ownership.
					requestId: "mutation:" + randomUUID(),
					reads,
					writes,
					append,
					work: runs.map((run) => ({
						key: runKey(row.id, run.id),
						state: run.state === "done" || run.state === "unanswered" ? null : run.stage + ":" + run.state,
					})),
				},
				verify,
			);
		} catch (error) {
			if (recordsRefusal(error) && error.code !== "conflict")
				throw new TicketError(error.code, error.message);
			if (error instanceof Error && error.name === "RecordsPublicationError")
				throw new TicketError(
					"unknown",
					"Write committed but publication denied; reconcile original request",
				);
			// A known optimistic mismatch is distinguished from an uncertain storage result.
			if (runtime.view().phase === "ready") {
				for (const request of saved.data.requests) {
					const original = await lookup(request.actorId, request.requestId);
					if (original) {
						authorize();
						return original;
					}
				}
				const now = await records.get(headKey(row.id), check);
				if (now.version !== (saved.cell?.version ?? 0))
					throw new TicketError("conflict", "Ticket changed; reload before editing");
			}
			broken = true;
			throw new TicketError(
				"unknown",
				"Ticket write could not be confirmed; query the original request after recovery",
			);
		}
		try {
			authorize();
		} catch {
			throw new TicketError(
				"unknown",
				"Write committed but current access ended; reconcile original request",
			);
		}
		return null;
	}
	async function history(query: TicketHistoryQuery, budget = 192 * 1024): Promise<TicketHistoryPage> {
		return verified(async () => {
			let cursor = query.cursor ?? null,
				bytes = 512;
			const revisions: TicketRevision[] = [],
				events: TicketEvent[] = [],
				runs: TicketRun[] = [];
			for (let count = 0; count < (query.limit ?? 32); count++) {
				const page = await records.page(
					{
						stream: stream(query.id, query.kind),
						...(cursor ? { cursor } : {}),
						limit: 1,
						maxBytes: 192 * 1024,
					},
					check,
				);
				if (!page.items.length) {
					cursor = null;
					break;
				}
				const item = page.items[0]!;
				let value: TicketRevision | TicketEvent | TicketRun;
				if (query.kind === "events") value = decodeEvent(item.data);
				else if (query.kind === "runs") {
					shape(item.data, ["id"]);
					identity(item.data.id);
					value = await run(query.id, item.data.id);
				} else {
					shape(item.data, ["key"]);
					identity(item.data.key);
					value = decodeRevision((await records.get(item.data.key, check)).data);
					if (item.data.key !== `revision:${query.id}:${value.revision}`)
						throw Error("Revision belongs to another ticket");
				}
				const size = Buffer.byteLength(JSON.stringify(value)) + 1;
				if (bytes + size > budget) {
					cursor = page.startCursor;
					break;
				}
				bytes += size;
				if ("revision" in value) revisions.push(value);
				else if ("kind" in value) events.push(value);
				else runs.push(value);
				cursor = page.cursor;
				if (!cursor) break;
			}
			if (query.kind === "events") return { kind: "events", items: events.reverse(), cursor };
			if (query.kind === "runs") return { kind: "runs", items: runs.reverse(), cursor };
			return { kind: "revisions", items: revisions.reverse(), cursor };
		});
	}
	async function view(id: string) {
		// Head version brackets all pages. A concurrent writer cannot publish a mixed view.
		for (let attempt = 0; attempt < 4; attempt++) {
			const first = await head(id);
			if (!first.value) return null;
			let remaining = 248 * 1024 - Buffer.byteLength(JSON.stringify(first.value));
			const revisions = await history({ id, kind: "revisions" }, Math.min(112 * 1024, remaining));
			remaining -= Buffer.byteLength(JSON.stringify(revisions));
			const events = await history({ id, kind: "events" }, Math.min(112 * 1024, remaining));
			remaining -= Buffer.byteLength(JSON.stringify(events));
			const runs = await history({ id, kind: "runs" }, remaining);
			if (revisions.kind !== "revisions" || events.kind !== "events" || runs.kind !== "runs")
				throw Error("Invalid history kind");
			if ((await head(id)).cell.version !== first.cell.version) continue;
			const { activeRunId: _, ...current } = first.value;
			return {
				ticket: { ...current, revisions: revisions.items, events: events.items, runs: runs.items },
				cursors: { revisions: revisions.cursor, events: events.cursor, runs: runs.cursor },
			};
		}
		throw new TicketError("conflict", "Ticket changed while reading; read again");
	}
	const meta = await records.get("layout", check);
	const migrate = async () => {
		const old = await runtime.store({ namespace, maxBytes: legacyMaxBytes }).snapshot();
		const oldData = old.data;
		const legacyDigest = keyHash(oldData);
		if (meta.data && meta.data.schema !== 1) throw new TicketError("unknown", "Unrecognized records layout");
		if (old.version === 0 && Object.keys(oldData).length === 0) {
			if (meta.data) throw new TicketError("unknown", "Migration source is missing");
			await records.commit(
				{
					requestId: "layout-v2-empty",
					reads: [{ key: "layout", version: meta.version }],
					writes: [{ key: "layout", data: { schema: 2, sessionId } }],
					append: [],
				},
				check,
			);
			return;
		}
		if (!migrateLegacy)
			throw new TicketError(
				"conflict",
				"Legacy ticket storage requires a cold backup and explicit migrateLegacy",
			);
		shape(oldData, ["schema", "sessionId", "tickets", "requests"]);
		if (
			oldData.schema !== 1 ||
			oldData.sessionId !== sessionId ||
			!Array.isArray(oldData.tickets) ||
			!Array.isArray(oldData.requests)
		)
			throw new TicketError("unknown", "Unrecognized ticket storage layout");
		if (
			meta.data &&
			(meta.data.schema !== 1 || meta.data.sessionId !== sessionId || meta.data.sourceHash !== legacyDigest)
		)
			throw new TicketError("unknown", "Ticket migration source changed");
		const rows: Ticket[] = [];
		for (const raw of oldData.tickets) {
			ticket(raw);
			rows.push(structuredClone(raw));
		}
		const ids = new Set(rows.map((row) => row.id));
		const requests = oldData.requests.map((raw) => decodeRequest(raw));
		if (
			new Set(requests.map((row) => row.actorId + "\u0000" + row.requestId)).size !== requests.length ||
			requests.some((row) => !ids.has(row.receipt.id))
		)
			throw new TicketError("unknown", "Legacy ticket request identity is invalid");
		if (
			ids.size !== rows.length ||
			new Set(rows.flatMap((row) => row.runs.map((run) => run.id))).size !==
				rows.reduce((n, row) => n + row.runs.length, 0)
		)
			throw new TicketError("unknown", "Duplicate legacy record identity");
		const marker = meta.data ? { schema: 1, sessionId, sourceHash: legacyDigest } : null;
		if (!marker)
			await records.commit(
				{
					requestId: "migration-begin:" + legacyDigest,
					reads: [{ key: "layout", version: meta.version }],
					writes: [{ key: "layout", data: { schema: 1, sessionId, sourceHash: legacyDigest } }],
					append: [],
					freezeLegacy: { expectedVersion: old.version, maxBytes: legacyMaxBytes },
				},
				check,
			);
		const commit = async (
			part: string,
			reads: { key: string; version: number }[],
			writes: { key: string; data: JsonObject }[],
			append: { stream: string; data: JsonObject }[],
		) => {
			await records.commit(
				{
					requestId: "migration:" + legacyDigest.slice(0, 24) + ":" + part,
					reads,
					writes,
					append,
					work: writes
						.filter((row) => row.key.startsWith("run:"))
						.map((row) => ({
							key: row.key,
							state:
								row.data.state === "done" || row.data.state === "unanswered"
									? null
									: String(row.data.stage) + ":" + String(row.data.state),
						})),
				},
				check,
			);
		};
		for (const row of rows) {
			const headData = {
				id: row.id,
				authorId: row.authorId,
				version: row.version,
				contentRevision: row.contentRevision,
				state: row.state,
				handler: row.handler,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
				title: row.title,
				body: row.body,
				sources: row.sources,
				activeRunId:
					row.runs.find((run) => ["pending", "queued", "placed", "unknown"].includes(run.state))?.id ?? null,
			};
			await commit(
				"head:" + row.id,
				[{ key: headKey(row.id), version: 0 }],
				[{ key: headKey(row.id), data: jsonValue(headData) }],
				[
					{ stream: "all", data: { id: row.id } },
					{ stream: "author:" + row.authorId, data: { id: row.id } },
				],
			);
			for (let offset = 0; offset < row.revisions.length; offset += 4) {
				const part = row.revisions.slice(offset, offset + 4),
					writes = part.map((revision) => ({
						key: `revision:${row.id}:${revision.revision}`,
						data: jsonValue(revision),
					}));
				await commit(
					"revision:" + row.id + ":" + offset,
					writes.map((write) => ({ key: write.key, version: 0 })),
					writes,
					part.map((revision) => ({
						stream: stream(row.id, "revisions"),
						data: { key: `revision:${row.id}:${revision.revision}` },
					})),
				);
			}
			for (let offset = 0; offset < row.events.length; offset += 4)
				await commit(
					"event:" + row.id + ":" + offset,
					[],
					[],
					row.events
						.slice(offset, offset + 4)
						.map((event) => ({ stream: stream(row.id, "events"), data: jsonValue(event) })),
				);
			for (let offset = 0; offset < row.runs.length; offset += 32) {
				const part = row.runs.slice(offset, offset + 32),
					writes = part.map((run) => {
						const revision = row.revisions.find((item) => item.revision === run.contentRevision);
						if (!revision) throw new TicketError("unknown", "Legacy run revision missing");
						return {
							key: runKey(row.id, run.id),
							data: jsonValue({
								...run,
								ticketId: row.id,
								stage: run.receiptId ? "accepted" : "unknown",
								dispatchRequestId: "ticket-" + run.id,
								payloadHash: payloadHash(dispatchText(row.id, revision)),
							}),
						};
					});
				await commit(
					"run:" + row.id + ":" + offset,
					writes.map((write) => ({ key: write.key, version: 0 })),
					writes,
					part.map((run) => ({ stream: stream(row.id, "runs"), data: { id: run.id } })),
				);
			}
		}
		for (let offset = 0; offset < requests.length; offset += 64) {
			const part = requests.slice(offset, offset + 64),
				writes = part.map((request) => ({
					key: requestKey(request.actorId, request.requestId),
					data: jsonValue(request),
				}));
			await commit(
				"request:" + offset,
				writes.map((write) => ({ key: write.key, version: 0 })),
				writes,
				[],
			);
		}
		const published = await records.get("layout", check);
		await records.commit(
			{
				requestId: "migration-complete:" + legacyDigest,
				reads: [{ key: "layout", version: published.version }],
				writes: [{ key: "layout", data: { schema: 2, sessionId, migratedFrom: legacyDigest } }],
				append: [],
			},
			check,
		);
	};
	if (meta.data?.schema === 2) {
		if (meta.data.sessionId !== sessionId) throw new TicketError("unknown", "Wrong ticket storage layout");
	} else await migrate();
	async function input(run: TicketRun) {
		return verified(async () => {
			const revision = decodeRevision(
				(await records.get(`revision:${run.ticketId}:${run.contentRevision}`, check)).data,
			);
			if (revision.revision !== run.contentRevision) throw Error("Run content revision mismatch");
			const text = dispatchText(run.ticketId, revision);
			if (payloadHash(text) !== run.payloadHash) throw Error("Run payload identity mismatch");
			return { requestId: run.dispatchRequestId, text };
		});
	}
	return { records, head, run, input, draft, lookup, save, history, view, check };
}
