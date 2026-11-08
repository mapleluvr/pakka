import {
	TicketError,
	type Ticket,
	type TicketHandler,
	type TicketReceipt,
	type TicketState,
	type TicketRoute,
	type TicketContent,
} from "./types.ts";

export function frozen<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.values(value).forEach(frozen);
		Object.freeze(value);
	}
	return value;
}
export function shape(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
		Object.getOwnPropertySymbols(value).length ||
		required.some((key) => !Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => ![...required, ...optional].includes(key))
	)
		throw new TicketError("invalid", "Invalid ticket fields");
}
export function text(value: unknown, max: number, nonempty = false): asserts value is string {
	if (
		typeof value !== "string" ||
		value.length > max ||
		(nonempty && !value.trim()) ||
		/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
	)
		throw new TicketError("invalid", "Invalid ticket text");
}
export function identity(value: unknown): asserts value is string {
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value))
		throw new TicketError("invalid", "Invalid ticket identity");
}
export function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): asserts value is number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
		throw new TicketError("invalid", "Invalid ticket number");
}
export function state(value: unknown): asserts value is TicketState {
	if (typeof value !== "string" || !["open", "active", "waiting", "closed"].includes(value))
		throw new TicketError("invalid", "Invalid ticket state");
}
export function links(value: unknown): asserts value is string[] {
	if (!Array.isArray(value) || value.length > 8)
		throw new TicketError("invalid", "Invalid ticket references");
	value.forEach((item) => text(item, 2048, true));
}
export function content(
	value: Record<string, unknown>,
): asserts value is Record<string, unknown> & TicketContent {
	text(value.title, 200, true);
	text(value.body, 12000, true);
	links(value.sources);
}
export function handler(value: unknown): asserts value is TicketHandler {
	shape(value, ["id", "label", "actorId"]);
	identity(value.id);
	identity(value.actorId);
	text(value.label, 120, true);
}
export function receipt(value: unknown): asserts value is TicketReceipt {
	shape(value, ["id", "requestId", "version", "contentRevision", "state", "runId"]);
	identity(value.id);
	identity(value.requestId);
	integer(value.version);
	integer(value.contentRevision);
	state(value.state);
	if (value.runId !== null) identity(value.runId);
}
export function route(value: unknown): asserts value is TicketRoute {
	shape(value, ["handlerId", "target", "source", "principal"]);
	identity(value.handlerId);
	identity(value.principal);
	for (const ref of [value.target, ...(value.source === null ? [] : [value.source])]) {
		shape(ref, ["key", "sessionId", "conversationId", "incarnation", "profile"]);
		Object.values(ref).forEach(identity);
	}
}
export function ticket(value: unknown): asserts value is Ticket {
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
		"revisions",
		"events",
		"runs",
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
	if (
		!Array.isArray(value.revisions) ||
		!value.revisions.length ||
		value.revisions.length > 128 ||
		!Array.isArray(value.events) ||
		!value.events.length ||
		value.events.length > 256 ||
		!Array.isArray(value.runs) ||
		value.runs.length > 64
	)
		throw new TicketError("invalid", "Invalid ticket history");
	for (const [index, row] of value.revisions.entries()) {
		shape(row, ["revision", "actorId", "at", "title", "body", "sources"]);
		integer(row.revision);
		identity(row.actorId);
		integer(row.at);
		content(row);
		if (row.revision !== index + 1) throw new TicketError("invalid", "Invalid content revision order");
	}
	const latest = value.revisions.at(-1)!;
	if (
		value.contentRevision !== latest.revision ||
		value.title !== latest.title ||
		value.body !== latest.body ||
		JSON.stringify(value.sources) !== JSON.stringify(latest.sources)
	)
		throw new TicketError("invalid", "Inconsistent current ticket content");
	for (const [index, row] of value.events.entries()) {
		shape(row, ["version", "actorId", "at", "kind", "state", "text", "links"]);
		integer(row.version);
		identity(row.actorId);
		integer(row.at);
		state(row.state);
		text(row.text, 12000);
		links(row.links);
		if (
			row.version !== index + 1 ||
			typeof row.kind !== "string" ||
			!["submitted", "edited", "assigned", "reported", "dispatched", "observed"].includes(row.kind)
		)
			throw new TicketError("invalid", "Invalid ticket event order");
	}
	if (value.version !== value.events.length || value.events.at(-1)!.state !== value.state)
		throw new TicketError("invalid", "Inconsistent current ticket state");
	for (const row of value.runs) {
		shape(row, [
			"id",
			"handlerId",
			"contentRevision",
			"actorId",
			"at",
			"requestId",
			"state",
			"receiptId",
			"route",
		]);
		route(row.route);
		if (row.route.handlerId !== row.handlerId) throw new TicketError("invalid", "Inconsistent run route");
		identity(row.id);
		identity(row.handlerId);
		identity(row.actorId);
		identity(row.requestId);
		integer(row.at);
		integer(row.contentRevision, 1, value.contentRevision);
		if (
			typeof row.state !== "string" ||
			!["pending", "queued", "placed", "done", "unanswered", "unknown"].includes(row.state)
		)
			throw new TicketError("invalid", "Invalid run state");
		if (row.receiptId !== null) identity(row.receiptId);
	}
	if (new Set(value.runs.map((r) => r.id)).size !== value.runs.length)
		throw new TicketError("invalid", "Duplicate run identity");
}
