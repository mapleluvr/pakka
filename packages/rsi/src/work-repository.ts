import { createHash, randomUUID } from "node:crypto";
import type { ConversationRef, JsonObject } from "@pakka/agent";
import {
	decodeRevision,
	recordsRefusal,
	requestKey,
	type StoredRequest,
	type ticketRepository,
} from "./repository.ts";
import {
	TicketError,
	type TicketWork,
	type TicketReport,
	type TicketReportSummary,
	type TicketRequestReceipt,
} from "./types.ts";
import { identity, integer, shape, resultReferences, links, text, route } from "./validation.ts";

type Repository = Awaited<ReturnType<typeof ticketRepository>>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const workKey = (id: string, workId: string) => "work:" + hash([id, workId]);
const reportKey = (id: string, reportId: string) => "report:" + hash([id, reportId]);
const reportVersionKey = (id: string, reportId: string, version: number) =>
	"report-version:" + hash([id, reportId, version]);
export const reportStream = (id: string, actorId?: string) => "reports:" + hash([id, actorId ?? null]);
const json = (value: unknown): JsonObject => {
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		throw new TicketError("invalid", "Work/report data is not serializable JSON");
	}
};
export function conversationReference(value: unknown): asserts value is ConversationRef {
	// The existing route validator defines the public exact Conversation identity.
	route({ handlerId: "reference", principal: "reference", target: value, source: null });
}
function decodeWork(value: unknown): TicketWork {
	shape(value, [
		"id",
		"ticketId",
		"ticketAuthorId",
		"actorId",
		"contentRevision",
		"conversation",
		"runId",
		"createdAt",
		"version",
		"allowed",
	]);
	for (const key of ["id", "ticketId", "ticketAuthorId", "actorId"] as const) identity(value[key]);
	integer(value.contentRevision);
	integer(value.createdAt);
	integer(value.version);
	conversationReference(value.conversation);
	if (value.runId !== null) identity(value.runId);
	if (typeof value.allowed !== "boolean") throw Error("Invalid contribution state");
	return {
		id: value.id as string,
		ticketId: value.ticketId as string,
		ticketAuthorId: value.ticketAuthorId as string,
		actorId: value.actorId as string,
		contentRevision: value.contentRevision,
		conversation: value.conversation,
		runId: value.runId,
		createdAt: value.createdAt,
		version: value.version,
		allowed: value.allowed,
	};
}
function decodeReport(value: unknown): TicketReport {
	shape(value, [
		"id",
		"ticketId",
		"workId",
		"actorId",
		"revisionActorId",
		"contentRevision",
		"conversation",
		"runId",
		"version",
		"createdAt",
		"updatedAt",
		"text",
		"links",
		"results",
	]);
	for (const key of ["id", "ticketId", "workId", "actorId", "revisionActorId"] as const) identity(value[key]);
	integer(value.contentRevision);
	integer(value.createdAt);
	integer(value.updatedAt);
	integer(value.version);
	conversationReference(value.conversation);
	if (value.runId !== null) identity(value.runId);
	text(value.text, 12000, true);
	links(value.links);
	resultReferences(value.results);
	return {
		id: value.id as string,
		ticketId: value.ticketId as string,
		workId: value.workId as string,
		actorId: value.actorId as string,
		revisionActorId: value.revisionActorId as string,
		contentRevision: value.contentRevision,
		conversation: value.conversation,
		runId: value.runId,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		text: value.text,
		links: value.links,
		results: value.results,
	};
}
export function reportSummary(value: TicketReport): TicketReportSummary {
	const { text: _, links: __, results: ___, ...summary } = value;
	return summary;
}

function decodeSummary(value: unknown): TicketReportSummary {
	shape(value, [
		"id",
		"ticketId",
		"workId",
		"actorId",
		"revisionActorId",
		"contentRevision",
		"conversation",
		"runId",
		"version",
		"createdAt",
		"updatedAt",
	]);
	return reportSummary(decodeReport({ ...value, text: "metadata", links: [], results: [] }));
}

/** Exact object reads and immutable report versions; no whole-ticket history scan. */
export function workReportRepository(repository: Repository) {
	const { records, verified, check } = repository;
	async function work(id: string, workId: string) {
		return verified(async () => {
			const cell = await records.get(workKey(id, workId), check);
			if (!cell.data) throw new TicketError("denied", "Original work not registered");
			const value = decodeWork(cell.data);
			if (value.ticketId !== id || value.id !== workId) throw Error("Original work identity differs");
			return { cell, value };
		});
	}
	async function summary(id: string, reportId: string) {
		return verified(async () => {
			const cell = await records.get(reportKey(id, reportId), check);
			if (!cell.data) throw new TicketError("denied", "Report not found");
			const value = decodeSummary(cell.data);
			if (value.ticketId !== id || value.id !== reportId) throw Error("Report identity differs");
			return { cell, value };
		});
	}
	async function report(id: string, reportId: string, version?: number) {
		return verified(async () => {
			const head = version === undefined ? await summary(id, reportId) : null;
			const cell = await records.get(reportVersionKey(id, reportId, version ?? head!.value.version), check);
			if (!cell.data) throw new TicketError("denied", "Report not found");
			const value = decodeReport(cell.data);
			if (
				value.ticketId !== id ||
				value.id !== reportId ||
				value.version !== (version ?? head!.value.version)
			)
				throw Error("Report identity differs");
			if (head && JSON.stringify(reportSummary(value)) !== JSON.stringify(head.value))
				throw Error("Report head differs from its immutable version");
			return { cell: head?.cell ?? cell, value };
		});
	}
	async function revision(id: string, revision: number) {
		return verified(async () => {
			const cell = await records.get(`revision:${id}:${revision}`, check);
			const value = decodeRevision(cell.data);
			if (value.revision !== revision) throw Error("Original content revision differs");
			return { cell, value };
		});
	}
	async function commit<R extends TicketRequestReceipt>(
		input: {
			readonly request: StoredRequest & { receipt: R };
			readonly reads: readonly { key: string; version: number }[];
			readonly writes: readonly { key: string; data: JsonObject }[];
			readonly append?: readonly { stream: string; data: JsonObject }[];
		},
		authorize: () => void,
	): Promise<R> {
		const key = requestKey(input.request.actorId, input.request.requestId);
		check();
		authorize();
		try {
			await records.commit(
				{
					requestId: "work-report-attempt:" + randomUUID(),
					reads: [...input.reads, { key, version: 0 }],
					writes: [...input.writes, { key, data: json(input.request) }],
					append: [...(input.append ?? [])],
				},
				() => {
					check();
					authorize();
				},
			);
		} catch (error) {
			if (recordsRefusal(error)) {
				if (error.code !== "conflict") throw new TicketError(error.code, error.message);
				const original = await repository.lookup(input.request.actorId, input.request.requestId);
				if (original && original.fingerprint === input.request.fingerprint) return original.receipt as R;
				throw new TicketError("conflict", "Work or report changed; inspect the original request");
			}
			if (error instanceof Error && error.name === "RecordsPublicationError")
				throw new TicketError(
					"unknown",
					"Original work/report committed but publication ended; query original request",
				);
			return verified(async () => {
				throw error;
			});
		}
		return input.request.receipt;
	}
	const workWrite = (value: TicketWork) => ({ key: workKey(value.ticketId, value.id), data: json(value) });
	function reportWrites(value: TicketReport) {
		const data = json(value);
		if (Buffer.byteLength(JSON.stringify(data)) > 180 * 1024)
			throw new TicketError("capacity", "Report exceeds encoded history item budget");
		return [
			{ key: reportKey(value.ticketId, value.id), data: json(reportSummary(value)) },
			{ key: reportVersionKey(value.ticketId, value.id, value.version), data },
		];
	}
	return {
		work,
		report,
		summary,
		revision,
		commit,
		workWrite,
		reportWrites,
		records,
		reportKey,
		reportVersionKey,
	};
}
