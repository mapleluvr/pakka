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
const handler = object({ id, label: string(120, 1), actorId: id });
const ref = object({ key: id, sessionId: id, conversationId: id, incarnation: id, profile: id });
const route = object({ handlerId: id, target: ref, source: nullable(ref), principal: id });
const run = object({
	id,
	route,
	handlerId: id,
	contentRevision: number,
	actorId: id,
	at: number,
	requestId: id,
	state: { enum: ["pending", "queued", "placed", "done", "unanswered", "unknown"] },
	receiptId: nullable(id),
});
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
	revisions: array(object({ ...fields, revision: number, actorId: id, at: number }), 128),
	events: array(
		object({
			version: number,
			actorId: id,
			at: number,
			kind: { enum: ["submitted", "edited", "assigned", "reported", "dispatched", "observed"] },
			state,
			text: string(12000),
			links: refs,
		}),
		256,
	),
	runs: array(run, 64),
});
const receipt = object({
	requestId: id,
	id,
	version: number,
	contentRevision: number,
	state,
	runId: nullable(id),
});
const view = object({
	ticket,
	permissions: object({
		edit: { type: "boolean" },
		report: { type: "boolean" },
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
	cursor: nullable(id),
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
	list: object(
		{ state, mine: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: id },
		[],
	),
	lookup: object({ requestId: id }),
	capabilities: object({}),
	assign: object({ ...mutation, handlerId: nullable(id) }),
	report: object({ ...mutation, state, text: string(12000, 1), links: refs }),
	dispatch: object(mutation),
	refresh: object({ id, runId: id }),
};
const outputs: Readonly<Record<TicketAction, Schema>> = {
	submit: receipt,
	edit: receipt,
	get: view,
	list: page,
	lookup: nullable(receipt),
	capabilities,
	assign: receipt,
	report: receipt,
	dispatch: receipt,
	refresh: view,
};
const error = object({
	status: { enum: ["invalid", "denied", "conflict", "capacity", "unknown"] },
	message: string(2048),
});
export function resultSchema(action: TicketAction): Schema {
	return { anyOf: [object({ status: { enum: ["ok"] }, value: outputs[action] }), error] };
}
export const writeActions: readonly TicketAction[] = ["submit", "edit", "assign", "report", "dispatch"];
