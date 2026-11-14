import { createHash, randomUUID } from "node:crypto";
import type { JsonObject, Runtime, RuntimeRecord } from "@pakka/agent";
import type { TicketClient, TicketDelivery, TicketDispatcher, TicketReport, TicketRoute } from "./types.ts";
import { TicketError } from "./types.ts";
import { frozen, identity, integer, route, shape } from "./validation.ts";
import { recordsRefusal } from "./repository.ts";

export interface ReportNotificationInput {
	readonly requestId: string;
	readonly id: string;
	readonly reportId: string;
	readonly reportVersion: number;
	readonly handlerId: string;
}
export interface ReportNotification extends ReportNotificationInput {
	readonly stage: "planned" | "dispatching" | "accepted" | "unknown";
	readonly delivery: TicketDelivery | null;
}
interface StoredNotification extends ReportNotification {
	readonly actorId: string;
	readonly sessionId: string;
	readonly route: TicketRoute;
	readonly text: string;
	readonly fingerprint: string;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: StoredNotification): JsonObject => {
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		throw new TicketError("invalid", "Notification is not serializable JSON");
	}
};
function input(value: unknown): asserts value is ReportNotificationInput {
	shape(value, ["requestId", "id", "reportId", "reportVersion", "handlerId"]);
	identity(value.requestId);
	identity(value.id);
	identity(value.reportId);
	identity(value.handlerId);
	integer(value.reportVersion);
}
const payload = (value: TicketReport) =>
	JSON.stringify({
		kind: "rsi-report-available",
		ticketId: value.ticketId,
		reportId: value.id,
		reportVersion: value.version,
		workId: value.workId,
		actorId: value.actorId,
		contentRevision: value.contentRevision,
		conversation: value.conversation,
		runId: value.runId,
	});
const fingerprint = (value: ReportNotificationInput, actorId: string) =>
	digest([actorId, value.requestId, value.id, value.reportId, value.reportVersion, value.handlerId]);
function decode(raw: unknown): StoredNotification {
	shape(raw, [
		"requestId",
		"id",
		"reportId",
		"reportVersion",
		"handlerId",
		"actorId",
		"sessionId",
		"stage",
		"delivery",
		"route",
		"text",
		"fingerprint",
	]);
	input({
		requestId: raw.requestId,
		id: raw.id,
		reportId: raw.reportId,
		reportVersion: raw.reportVersion,
		handlerId: raw.handlerId,
	});
	identity(raw.actorId);
	identity(raw.sessionId);
	route(raw.route);
	if (
		!["planned", "dispatching", "accepted", "unknown"].includes(String(raw.stage)) ||
		typeof raw.text !== "string" ||
		raw.text.length > 65536 ||
		typeof raw.fingerprint !== "string" ||
		!/^[a-f0-9]{64}$/.test(raw.fingerprint)
	)
		throw Error("Invalid notification state");
	if (raw.delivery !== null) {
		shape(raw.delivery, ["id", "state"]);
		identity(raw.delivery.id);
		if (!["queued", "placed", "done", "unanswered", "unknown"].includes(String(raw.delivery.state)))
			throw Error("Invalid notification delivery");
	}
	if (raw.stage === "accepted" && raw.delivery === null)
		throw Error("Accepted notification lacks delivery identity");
	// SAFETY: the exact closed state, reference, route and bounded scalar fields were validated above.
	return raw as unknown as StoredNotification;
}

/** Optional RSI pipeline. The native report is already durable before this outbox is prepared. */
export async function createReportNotifier(options: {
	readonly runtime: Runtime;
	readonly namespace: string;
	readonly tickets: TicketClient;
	readonly dispatcher: TicketDispatcher;
	readonly check: () => void;
}) {
	const { runtime, dispatcher } = options;
	identity(options.namespace);
	if (typeof options.check !== "function")
		throw new TicketError("invalid", "Trusted notification authority required");
	const actorId = options.tickets.actorId,
		sessionId = runtime.view().sessionId;
	const records = runtime.records({ namespace: options.namespace });
	const check = () => {
		options.check();
		if (runtime.view().phase !== "ready" || runtime.view().sessionId !== sessionId)
			throw new TicketError("unknown", "Original notification Runtime is not available");
	};
	const tickets = options.tickets.withAuthority(check);
	const key = (requestId: string) => "report-notice:" + digest([actorId, requestId]);
	const unknown = () =>
		new TicketError(
			"unknown",
			"Notification result cannot be published; reconcile its original request. The report is retained.",
		);
	async function read(requestId: string) {
		check();
		const cell = await records.get(key(requestId), check);
		if (!cell.data) return null;
		try {
			const value = decode(cell.data);
			if (
				value.sessionId !== sessionId ||
				value.actorId !== actorId ||
				value.requestId !== requestId ||
				value.route.handlerId !== value.handlerId ||
				fingerprint(value, actorId) !== value.fingerprint
			)
				throw Error("Notification identity differs");
			return { cell, value };
		} catch {
			throw unknown();
		}
	}
	async function authorize(value: StoredNotification) {
		const report = await tickets.readReport({
			id: value.id,
			reportId: value.reportId,
			version: value.reportVersion,
		});
		if (payload(report) !== value.text) throw unknown();
		check();
	}
	async function write(value: StoredNotification, version: number): Promise<boolean> {
		check();
		try {
			const recordKey = key(value.requestId);
			await records.commit(
				{
					requestId: "report-notice-attempt:" + randomUUID(),
					reads: [{ key: recordKey, version }],
					writes: [{ key: recordKey, data: json(value) }],
					append: [],
					work: [{ key: recordKey, state: value.stage === "accepted" ? null : value.stage }],
				},
				check,
			);
			return true;
		} catch (error) {
			if (recordsRefusal(error)) {
				if (error.code === "conflict") return false;
				throw new TicketError(error.code, error.message);
			}
			throw unknown();
		}
	}
	function publish(value: StoredNotification): ReportNotification {
		try {
			check();
			const { actorId: _, sessionId: __, route: ___, text: ____, fingerprint: _____, ...result } = value;
			return frozen(structuredClone(result));
		} catch {
			throw unknown();
		}
	}
	async function reconcileValue(saved: { cell: RuntimeRecord; value: StoredNotification }) {
		await authorize(saved.value);
		if (saved.value.stage === "accepted" || saved.value.stage === "planned") return saved.value;
		let delivery: TicketDelivery | null;
		try {
			delivery = await dispatcher.lookup(
				saved.value.route,
				{ requestId: "notice-" + digest([actorId, saved.value.requestId]), text: saved.value.text },
				check,
			);
		} catch {
			delivery = null;
		}
		const value = {
			...saved.value,
			stage: delivery ? ("accepted" as const) : ("unknown" as const),
			delivery,
		};
		if (!(await write(value, saved.cell.version))) {
			const original = await read(value.requestId);
			if (!original) throw unknown();
			return original.value;
		}
		return value;
	}
	return Object.freeze({
		async notify(raw: ReportNotificationInput): Promise<ReportNotification> {
			const request = structuredClone(raw);
			input(request);
			check();
			let saved = await read(request.requestId);
			if (saved && saved.value.fingerprint !== fingerprint(request, actorId))
				throw new TicketError("conflict", "Notification request differs from the original");
			if (!saved) {
				const report = await tickets.readReport({
					id: request.id,
					reportId: request.reportId,
					version: request.reportVersion,
				});
				const value: StoredNotification = {
					...request,
					actorId,
					sessionId,
					route: dispatcher.plan(request.handlerId),
					text: payload(report),
					fingerprint: fingerprint(request, actorId),
					stage: "planned",
					delivery: null,
				};
				dispatcher.validate(value.route, {
					requestId: "notice-" + digest([actorId, request.requestId]),
					text: value.text,
				});
				await write(value, 0);
				saved = await read(request.requestId);
				if (!saved || saved.value.fingerprint !== value.fingerprint)
					throw new TicketError("conflict", "Notification request already belongs to another operation");
			}
			await authorize(saved.value);
			if (saved.value.stage !== "planned") return publish(await reconcileValue(saved));
			const claimed = { ...saved.value, stage: "dispatching" as const };
			if (!(await write(claimed, saved.cell.version))) {
				const original = await read(request.requestId);
				if (!original) throw unknown();
				return publish(await reconcileValue(original));
			}
			// Only the winning CAS may send. A post-claim failure is uncertain even if lookup finds nothing.
			let delivery: TicketDelivery | null;
			try {
				delivery = await dispatcher.send(
					claimed.route,
					{ requestId: "notice-" + digest([actorId, request.requestId]), text: claimed.text },
					check,
				);
			} catch {
				delivery = null;
			}
			const current = await read(request.requestId);
			if (!current) throw unknown();
			const value = {
				...current.value,
				stage: delivery ? ("accepted" as const) : ("unknown" as const),
				delivery,
			};
			// A concurrent successful reconciliation is a terminal fact, never overwritten by a lost response.
			if (current.value.stage === "accepted") return publish(current.value);
			if (!(await write(value, current.cell.version))) {
				const original = await read(request.requestId);
				if (!original) throw unknown();
				return publish(original.value);
			}
			return publish(value);
		},
		async reconcile(requestId: string): Promise<ReportNotification | null> {
			identity(requestId);
			check();
			const saved = await read(requestId);
			return saved ? publish(await reconcileValue(saved)) : null;
		},
	});
}
