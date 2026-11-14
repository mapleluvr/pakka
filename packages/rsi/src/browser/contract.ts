import type { Schema } from "@pakka/webui/extension";
import type { TicketAction } from "../commands.ts";
const string = (maxLength: number, minLength = 0): Schema => ({ type: "string", maxLength, minLength });
const object = (
	properties: Readonly<Record<string, Schema>>,
	required: readonly string[] = Object.keys(properties),
): Schema => ({ type: "object", properties, required });
const array = (items: Schema, maxItems: number): Schema => ({ type: "array", items, maxItems });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const id = string(160, 1),
	number: Schema = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const refs = array(string(2048, 1), 8),
	state: Schema = { enum: ["open", "active", "waiting", "closed"] };
const fields = { title: string(200, 1), body: string(12000, 1), sources: refs };
const mutation = { id, expectedVersion: number };
const results = array(
	object(
		{ uri: string(2048, 1), version: string(160, 1), sha256: string(64, 64), description: string(1024) },
		["uri"],
	),
	8,
);
const handler = object({ id, label: string(120, 1), actorId: id });
const ref = object({ key: id, sessionId: id, conversationId: id, incarnation: id, profile: id });
const route = object({ handlerId: id, target: ref, source: nullable(ref), principal: id });
const runFields = {
	id,
	workId: id,
	ticketId: id,
	stage: { enum: ["planned", "dispatching", "accepted", "unknown"] },
	dispatchRequestId: id,
	payloadHash: string(64, 64),
	route,
	handlerId: id,
	contentRevision: number,
	actorId: id,
	at: number,
	requestId: id,
	state: { enum: ["pending", "queued", "placed", "done", "unanswered", "unknown"] },
	receiptId: nullable(id),
};
const run = object(
	runFields,
	Object.keys(runFields).filter((key) => key !== "workId"),
);
const cursor = string(2048, 1);
const revision = object({ ...fields, revision: number, actorId: id, at: number });
const event = object(
	{
		version: number,
		actorId: id,
		at: number,
		kind: {
			enum: ["submitted", "edited", "assigned", "reported", "state-changed", "dispatched", "observed"],
		},
		state,
		text: string(12000),
		links: refs,
		runId: id,
		results,
	},
	["version", "actorId", "at", "kind", "state", "text", "links"],
);
const ticket = object({
	id,
	authorId: id,
	version: number,
	contentRevision: number,
	state,
	handler: nullable(handler),
	createdAt: number,
	updatedAt: number,
	...fields,
	revisions: array(revision, 32),
	events: array(event, 32),
	runs: array(run, 32),
});
const receipt = object({
	requestId: id,
	id,
	version: number,
	contentRevision: number,
	state,
	runId: nullable(id),
});
const work = object({
	id,
	ticketId: id,
	ticketAuthorId: id,
	actorId: id,
	contentRevision: number,
	conversation: ref,
	runId: nullable(id),
	createdAt: number,
	version: number,
	allowed: { type: "boolean" },
});
const workReceipt = object({
	kind: { enum: ["work"] },
	requestId: id,
	id,
	workId: id,
	workVersion: number,
	contentRevision: number,
});
const reportReceipt = object({
	kind: { enum: ["report"] },
	requestId: id,
	id,
	workId: id,
	reportId: id,
	reportVersion: number,
	contentRevision: number,
});
const reportFields = {
	id,
	ticketId: id,
	workId: id,
	actorId: id,
	revisionActorId: id,
	contentRevision: number,
	conversation: ref,
	runId: nullable(id),
	version: number,
	createdAt: number,
	updatedAt: number,
};

const report = object({ ...reportFields, text: string(12000), links: refs, results });

const reportPage = object({ items: array(object(reportFields), 32), cursor: nullable(cursor) });
const requestReceipt: Schema = { anyOf: [receipt, workReceipt, reportReceipt] };
const view = object({
	ticket,
	cursors: object({ revisions: nullable(cursor), events: nullable(cursor), runs: nullable(cursor) }),
	permissions: object({
		edit: { type: "boolean" },
		setState: { type: "boolean" },
		assign: { type: "boolean" },
		dispatch: { type: "boolean" },
	}),
});
const page = object({
	items: array(
		object({
			id,
			title: string(200, 1),
			authorId: id,
			state,
			version: number,
			updatedAt: number,
			handler: nullable(handler),
		}),
		50,
	),
	cursor: nullable(cursor),
});
const capabilities = object({
	submit: { type: "boolean" },
	manage: { type: "boolean" },
	dispatch: { type: "boolean" },
	handlers: array(handler, 64),
});
export const inputs: Readonly<Record<TicketAction, Schema>> = {
	submit: object(fields),
	edit: object({ ...mutation, ...fields }),
	get: object({ id }),
	observe: object({}),
	history: object(
		{
			id,
			kind: { enum: ["revisions", "events", "runs"] },
			cursor,
			limit: { type: "integer", minimum: 1, maximum: 32 },
		},
		["id", "kind"],
	),
	list: object(
		{ state, mine: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor },
		[],
	),
	lookup: object({ requestId: id }),
	capabilities: object({}),
	assign: object({ ...mutation, handlerId: nullable(id) }),
	report: object({ id, workId: id, text: string(12000), links: refs, results }, [
		"id",
		"workId",
		"text",
		"links",
	]),

	"set-state": object({ ...mutation, state, text: string(12000), links: refs }),

	"register-work": object({ ...mutation, handlerId: id, contentRevision: number, conversation: ref }),

	"set-work-contribution": object({ ...mutation, workId: id, allowed: { type: "boolean" } }),

	"get-work": object({ id, workId: id }),

	"revise-report": object({ ...mutation, reportId: id, text: string(12000), links: refs, results }, [
		"id",
		"reportId",
		"expectedVersion",
		"text",
		"links",
	]),

	"read-report": object({ id, reportId: id, version: number }, ["id", "reportId"]),

	reports: object({ id, cursor, limit: { type: "integer", minimum: 1, maximum: 32 } }, ["id"]),
	dispatch: object(mutation),
	recover: object({ ...mutation, runId: id }),
	refresh: object({ id, runId: id }),
};
const outputs: Readonly<Record<TicketAction, Schema>> = {
	submit: receipt,
	edit: receipt,
	get: view,
	observe: object({ revision: string(64, 64) }),
	history: {
		anyOf: [
			object({ kind: { enum: ["revisions"] }, items: array(revision, 32), cursor: nullable(cursor) }),
			object({ kind: { enum: ["events"] }, items: array(event, 32), cursor: nullable(cursor) }),
			object({ kind: { enum: ["runs"] }, items: array(run, 32), cursor: nullable(cursor) }),
		],
	},
	list: page,
	lookup: nullable(requestReceipt),
	capabilities,
	assign: receipt,
	report: reportReceipt,
	"set-state": receipt,

	"register-work": workReceipt,

	"set-work-contribution": workReceipt,

	"get-work": object({ work, content: revision }),

	"revise-report": reportReceipt,

	"read-report": report,

	reports: reportPage,
	dispatch: receipt,
	recover: receipt,
	refresh: view,
};
const error = object({
	status: { enum: ["invalid", "denied", "conflict", "capacity", "unknown"] },
	message: string(2048),
});
export function resultSchema(action: TicketAction): Schema {
	return { anyOf: [object({ status: { enum: ["ok"] }, value: outputs[action] }), error] };
}
export const writeActions: readonly TicketAction[] = [
	"submit",
	"edit",
	"assign",
	"report",
	"set-state",

	"register-work",

	"set-work-contribution",

	"revise-report",

	"dispatch",
	"recover",
];
