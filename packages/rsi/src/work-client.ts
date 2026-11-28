import { randomUUID } from "node:crypto";
import type { Runtime } from "@pakka/agent";
import type { ticketRepository } from "./repository.ts";
import { workReportRepository, conversationReference, reportStream } from "./work-repository.ts";
import {
	TicketError,
	type TicketWorkClient,
	type TicketWork,
	type TicketReport,
	type TicketRole,
	type TicketHandler,
	type TicketRequestReceipt,
	type TicketWorkReceipt,
	type TicketReportReceipt,
} from "./types.ts";
import { identity, integer, shape, text, links, resultReferences, frozen } from "./validation.ts";

type Repository = Awaited<ReturnType<typeof ticketRepository>>;
export function createWorkClient(options: {
	readonly repository: Repository;
	readonly runtime: Runtime;
	readonly namespace: string;
	readonly handlers: readonly TicketHandler[];
	readonly actorId: string;
	readonly current: () => TicketRole;
	readonly fingerprint: (value: unknown) => string;
}) {
	const { repository, runtime, namespace, actorId, current, fingerprint } = options;
	const store = workReportRepository(repository);
	const ownWork = (work: TicketWork, role = current()) =>
		role === "manager" || work.actorId === actorId || work.ticketAuthorId === actorId;
	// Stable original ownership survives reassignment. Only current-handler access
	// depends on a mutable ticket assignment, using RSI's existing publication flight.
	async function canRead(work: TicketWork) {
		if (work.actorId === actorId || work.ticketAuthorId === actorId) {
			current();
			return { check: current, release() {} };
		}
		const assignment = repository.publication(work.ticketId);
		try {
			const { value } = await repository.head(work.ticketId);
			const check = () => {
				const role = current();
				if (ownWork(work, role)) return;
				if (!value || role !== "handler" || value.handler?.actorId !== actorId)
					throw new TicketError("denied", "Original work access denied");
				try {
					assignment.check();
				} catch {
					throw new TicketError("denied", "Original work assignment changed");
				}
			};
			check();
			return { check, release: assignment.release };
		} catch (error) {
			assignment.release();
			throw error;
		}
	}
	function canWrite(work: TicketWork, role = current()) {
		if (!work.allowed || (role !== "manager" && !(role === "handler" && work.actorId === actorId)))
			throw new TicketError("denied", "Original work contribution denied");
	}
	function canRevise(work: TicketWork, report: TicketReport) {
		const role = current();
		canWrite(work, role);
		if (role !== "manager" && report.actorId !== actorId)
			throw new TicketError("denied", "Only the report author can revise it");
	}
	function manager() {
		if (current() !== "manager")
			throw new TicketError("denied", "Work registration requires manager authority");
	}
	const unknown = () =>
		new TicketError("unknown", "Work/report saved but response cannot be published; query original request");
	async function readReceipt<R extends TicketRequestReceipt>(receipt: R): Promise<R> {
		if (!("kind" in receipt)) throw new TicketError("conflict", "Request belongs to another operation");
		const { value } = await store.work(receipt.id, receipt.workId);
		const access = await canRead(value);
		try {
			access.check();
			return frozen(structuredClone(receipt));
		} finally {
			access.release();
		}
	}
	async function prior<R extends TicketWorkReceipt | TicketReportReceipt>(
		op: string,
		input: { requestId: string },
	): Promise<R | null> {
		current();
		const original = await repository.lookup(actorId, input.requestId);
		if (!original) return null;
		if (original.fingerprint !== fingerprint([op, input]))
			throw new TicketError("conflict", "Request payload differs from the original");
		return (await readReceipt(original.receipt)) as R;
	}
	function request<R extends TicketRequestReceipt>(op: string, input: { requestId: string }, receipt: R) {
		return { actorId, requestId: input.requestId, fingerprint: fingerprint([op, input]), receipt };
	}
	function reportContent(raw: unknown) {
		shape(raw, ["requestId", "id", "text", "links"], ["workId", "reportId", "expectedVersion", "results"]);
		identity(raw.requestId);
		identity(raw.id);
		text(raw.text, 12000, true);
		links(raw.links);
		if (raw.results !== undefined) resultReferences(raw.results);
	}
	function receiptForReport(value: TicketReport, requestId: string): TicketReportReceipt {
		return {
			kind: "report",
			requestId,
			id: value.ticketId,
			workId: value.workId,
			contentRevision: value.contentRevision,
			reportId: value.id,
			reportVersion: value.version,
		};
	}
	async function publish<R extends TicketWorkReceipt | TicketReportReceipt>(value: R) {
		try {
			return await readReceipt(value);
		} catch {
			throw unknown();
		}
	}
	const client: TicketWorkClient = {
		async registerWork(raw) {
			const input = structuredClone(raw);
			shape(input, ["requestId", "id", "expectedVersion", "handlerId", "contentRevision", "conversation"]);
			identity(input.requestId);
			identity(input.id);
			identity(input.handlerId);
			integer(input.expectedVersion);
			integer(input.contentRevision);
			conversationReference(input.conversation);
			const saved = await prior<TicketWorkReceipt>("registerWork", input);
			if (saved) return publish(saved);
			manager();
			const head = await repository.head(input.id),
				row = head.value;
			const handler = options.handlers.find((h) => h.id === input.handlerId);
			if (!row || !handler || row.handler?.id !== handler.id || row.handler.actorId !== handler.actorId)
				throw new TicketError("denied", "Only the approved current handler can be registered");
			if (row.version !== input.expectedVersion || input.contentRevision > row.contentRevision)
				throw new TicketError("conflict", "Ticket or original revision changed");
			const revision = await store.revision(input.id, input.contentRevision);
			const snapshot = await runtime.previewConversation(input.conversation, manager, { limit: 1 });
			if (fingerprint(snapshot.ref) !== fingerprint(input.conversation))
				throw new TicketError("denied", "Original Conversation identity differs");
			const value: TicketWork = {
				id: randomUUID(),
				ticketId: input.id,
				ticketAuthorId: row.authorId,
				actorId: handler.actorId,
				contentRevision: input.contentRevision,
				conversation: input.conversation,
				runId: null,
				createdAt: Date.now(),
				version: 1,
				allowed: true,
			};
			const receipt: TicketWorkReceipt = {
				kind: "work",
				requestId: input.requestId,
				id: input.id,
				workId: value.id,
				workVersion: 1,
				contentRevision: value.contentRevision,
			};
			const write = store.workWrite(value);
			return publish(
				await store.commit(
					{
						request: request("registerWork", input, receipt),
						reads: [
							{ key: head.cell.key, version: head.cell.version },
							{ key: revision.cell.key, version: revision.cell.version },
							{ key: write.key, version: 0 },
						],
						writes: [write],
						append: [{ stream: "works:" + input.id, data: { workId: value.id } }],
					},
					manager,
				),
			);
		},
		async setWorkContribution(raw) {
			const input = structuredClone(raw);
			shape(input, ["requestId", "id", "workId", "expectedVersion", "allowed"]);
			identity(input.requestId);
			identity(input.id);
			identity(input.workId);
			integer(input.expectedVersion);
			if (typeof input.allowed !== "boolean") throw new TicketError("invalid", "Invalid contribution state");
			const saved = await prior<TicketWorkReceipt>("setWorkContribution", input);
			if (saved) return publish(saved);
			manager();
			const { cell, value } = await store.work(input.id, input.workId);
			if (value.version !== input.expectedVersion) throw new TicketError("conflict", "Original work changed");
			const updated = { ...value, version: value.version + 1, allowed: input.allowed };
			const receipt: TicketWorkReceipt = {
				kind: "work",
				requestId: input.requestId,
				id: input.id,
				workId: input.workId,
				workVersion: updated.version,
				contentRevision: value.contentRevision,
			};
			return publish(
				await store.commit(
					{
						request: request("setWorkContribution", input, receipt),
						reads: [{ key: cell.key, version: cell.version }],
						writes: [store.workWrite(updated)],
					},
					manager,
				),
			);
		},
		async getWork(raw) {
			const input = structuredClone(raw);
			shape(input, ["id", "workId"]);
			identity(input.id);
			identity(input.workId);
			current();
			const { value } = await store.work(input.id, input.workId);
			const access = await canRead(value);
			try {
				const revision = await store.revision(input.id, value.contentRevision);
				access.check();
				return frozen({ work: value, content: revision.value });
			} finally {
				access.release();
			}
		},
		async report(raw) {
			const input = structuredClone(raw);
			shape(input, ["requestId", "id", "workId", "text", "links"], ["results"]);
			reportContent(input);
			identity(input.workId);
			const saved = await prior<TicketReportReceipt>("report", input);
			if (saved) return publish(saved);
			const { cell, value: work } = await store.work(input.id, input.workId);
			canWrite(work);
			const at = Date.now();
			const value: TicketReport = {
				id: randomUUID(),
				ticketId: input.id,
				workId: work.id,
				actorId,
				revisionActorId: actorId,
				contentRevision: work.contentRevision,
				conversation: work.conversation,
				runId: work.runId,
				version: 1,
				createdAt: at,
				updatedAt: at,
				text: input.text,
				links: [...input.links],
				results: structuredClone(input.results ?? []),
			};
			const writes = store.reportWrites(value);
			return publish(
				await store.commit(
					{
						request: request("report", input, receiptForReport(value, input.requestId)),
						reads: [
							{ key: cell.key, version: cell.version },
							...writes.map((w) => ({ key: w.key, version: 0 })),
						],
						writes,
						append: [
							{ stream: reportStream(input.id), data: { reportId: value.id } },
							{ stream: reportStream(input.id, actorId), data: { reportId: value.id } },
							{ stream: "changes:all", data: { id: input.id, reportId: value.id } },
							{ stream: "changes:author:" + work.ticketAuthorId, data: { id: input.id, reportId: value.id } },
							{ stream: "changes:handler:" + actorId, data: { id: input.id, reportId: value.id } },
						],
					},
					() => canWrite(work),
				),
			);
		},
		async reviseReport(raw) {
			const input = structuredClone(raw);
			shape(input, ["requestId", "id", "reportId", "expectedVersion", "text", "links"], ["results"]);
			reportContent(input);
			identity(input.reportId);
			integer(input.expectedVersion);
			const saved = await prior<TicketReportReceipt>("reviseReport", input);
			if (saved) return publish(saved);
			const report = await store.report(input.id, input.reportId),
				work = await store.work(input.id, report.value.workId);
			canRevise(work.value, report.value);
			if (report.value.version !== input.expectedVersion) throw new TicketError("conflict", "Report changed");
			const value = {
				...report.value,
				revisionActorId: actorId,
				version: report.value.version + 1,
				updatedAt: Date.now(),
				text: input.text,
				links: [...input.links],
				results: structuredClone(input.results ?? []),
			};
			const writes = store.reportWrites(value);
			return publish(
				await store.commit(
					{
						request: request("reviseReport", input, receiptForReport(value, input.requestId)),
						reads: [
							{ key: work.cell.key, version: work.cell.version },
							{ key: report.cell.key, version: report.cell.version },
							{ key: writes[1]!.key, version: 0 },
						],
						writes,
						append: [
							{ stream: "changes:all", data: { id: input.id, reportId: value.id } },
							{
								stream: "changes:author:" + work.value.ticketAuthorId,
								data: { id: input.id, reportId: value.id },
							},
							{ stream: "changes:handler:" + value.actorId, data: { id: input.id, reportId: value.id } },
						],
					},
					() => canRevise(work.value, report.value),
				),
			);
		},
		async readReport(raw) {
			const input = structuredClone(raw);
			shape(input, ["id", "reportId"], ["version"]);
			identity(input.id);
			identity(input.reportId);
			if (input.version !== undefined) integer(input.version);
			current();
			const { value } = await store.report(input.id, input.reportId, input.version);
			const work = await store.work(input.id, value.workId);
			const access = await canRead(work.value);
			try {
				access.check();
				return frozen(value);
			} finally {
				access.release();
			}
		},
		async reports(raw) {
			const input = structuredClone(raw);
			shape(input, ["id"], ["cursor", "limit"]);
			identity(input.id);
			if (input.cursor !== undefined) text(input.cursor, 2048, true);
			const limit = input.limit ?? 20;
			integer(limit, 1, 32);
			const role = current(),
				head = await repository.head(input.id);
			const all =
				!!head.value &&
				(role === "manager" ||
					head.value.authorId === actorId ||
					(role === "handler" && head.value.handler?.actorId === actorId));
			const stream = reportStream(input.id, all ? undefined : actorId),
				binding = fingerprint([runtime.view().sessionId, namespace, actorId, role, stream]);
			let cursor = input.cursor;
			if (cursor) {
				try {
					const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
					shape(decoded, ["binding", "cursor"]);
					if (decoded.binding !== binding || typeof decoded.cursor !== "string") throw Error();
					cursor = decoded.cursor;
				} catch {
					throw new TicketError("conflict", "Report cursor does not belong to this query");
				}
			}
			const page = await store.records.page(
				{ stream, limit, maxBytes: 64 * 1024, ...(cursor ? { cursor } : {}) },
				current,
			);
			const items = [],
				access = [];
			try {
				for (const entry of page.items) {
					shape(entry.data, ["reportId"]);
					identity(entry.data.reportId);
					const report = await store.summary(input.id, entry.data.reportId),
						work = await store.work(input.id, report.value.workId);
					access.push(await canRead(work.value));
					items.push(report.value);
				}
				if (current() !== role) throw new TicketError("denied", "Report query authority changed");
				access.forEach((value) => value.check());
				return frozen({
					items: items.reverse(),
					cursor: page.cursor
						? Buffer.from(JSON.stringify({ binding, cursor: page.cursor })).toString("base64url")
						: null,
				});
			} finally {
				access.forEach((value) => value.release());
			}
		},
	};
	return { client, readReceipt };
}
