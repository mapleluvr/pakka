import {
	TicketError,
	type TicketClient,
	type TicketPage,
	type TicketReceipt,
	type TicketView,
	type TicketHistoryPage,
} from "./types.ts";
import { shape, identity, content, integer, links, state, text, resultReferences } from "./validation.ts";
export type TicketAction =
	| "submit"
	| "edit"
	| "get"
	| "list"
	| "observe"
	| "history"
	| "lookup"
	| "assign"
	| "report"
	| "dispatch"
	| "recover"
	| "refresh"
	| "capabilities";
export type TicketActionValue =
	| TicketPage
	| TicketView
	| TicketReceipt
	| TicketHistoryPage
	| { readonly revision: string }
	| ReturnType<TicketClient["capabilities"]>
	| null;
export type TicketResult =
	| { readonly status: "ok"; readonly value: TicketActionValue }
	| { readonly status: "invalid" | "denied" | "conflict" | "capacity" | "unknown"; readonly message: string };
/** Shared closed command decoding for native tools and the optional Backend facet. */
export async function executeTicketAction(
	client: TicketClient,
	action: TicketAction,
	value: unknown,
): Promise<TicketActionValue> {
	switch (action) {
		case "capabilities":
			shape(value, []);
			return client.capabilities();
		case "observe":
			shape(value, []);
			return client.observe();
		case "get":
			shape(value, ["id"]);
			identity(value.id);
			return client.get(value.id);
		case "history":
			shape(value, ["id", "kind"], ["cursor", "limit"]);
			identity(value.id);
			if (value.kind !== "revisions" && value.kind !== "events" && value.kind !== "runs")
				throw new TicketError("invalid", "Invalid history kind");
			if (value.cursor !== undefined) text(value.cursor, 2048, true);
			if (value.limit !== undefined) integer(value.limit, 1, 32);
			return client.history({
				id: value.id,
				kind: value.kind,
				...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
				...(value.limit !== undefined ? { limit: value.limit } : {}),
			});
		case "lookup":
			shape(value, ["requestId"]);
			identity(value.requestId);
			return client.lookup(value.requestId);
		case "list": {
			shape(value, [], ["state", "mine", "limit", "cursor"]);
			if (value.state !== undefined) state(value.state);
			if (value.mine !== undefined && typeof value.mine !== "boolean")
				throw new TicketError("invalid", "Invalid mine filter");
			if (value.limit !== undefined) integer(value.limit, 1, 50);
			if (value.cursor !== undefined) text(value.cursor, 2048, true);
			return client.list({
				...(value.state !== undefined ? { state: value.state } : {}),
				...(value.mine !== undefined ? { mine: value.mine } : {}),
				...(value.limit !== undefined ? { limit: value.limit } : {}),
				...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
			});
		}
		case "submit":
			shape(value, ["requestId", "title", "body", "sources"]);
			identity(value.requestId);
			content(value);
			return client.submit({
				requestId: value.requestId,
				title: value.title,
				body: value.body,
				sources: value.sources,
			});
		case "edit":
			shape(value, ["requestId", "id", "expectedVersion", "title", "body", "sources"]);
			identity(value.requestId);
			identity(value.id);
			integer(value.expectedVersion);
			content(value);
			return client.edit({
				requestId: value.requestId,
				id: value.id,
				expectedVersion: value.expectedVersion,
				title: value.title,
				body: value.body,
				sources: value.sources,
			});
		case "assign":
			shape(value, ["requestId", "id", "expectedVersion", "handlerId"]);
			identity(value.requestId);
			identity(value.id);
			integer(value.expectedVersion);
			if (value.handlerId !== null) identity(value.handlerId);
			return client.assign({
				requestId: value.requestId,
				id: value.id,
				expectedVersion: value.expectedVersion,
				handlerId: value.handlerId,
			});
		case "report":
			shape(value, ["requestId", "id", "expectedVersion", "state", "text", "links"], ["runId", "results"]);
			if (value.runId !== undefined) identity(value.runId);
			if (value.results !== undefined) resultReferences(value.results);
			identity(value.requestId);
			identity(value.id);
			integer(value.expectedVersion);
			state(value.state);
			text(value.text, 12000, true);
			links(value.links);
			return client.report({
				requestId: value.requestId,
				id: value.id,
				expectedVersion: value.expectedVersion,
				state: value.state,
				text: value.text,
				links: value.links,
				...(value.runId !== undefined ? { runId: value.runId } : {}),
				...(value.results !== undefined ? { results: value.results } : {}),
			});
		case "dispatch":
			shape(value, ["requestId", "id", "expectedVersion"]);
			identity(value.requestId);
			identity(value.id);
			integer(value.expectedVersion);
			return client.dispatch({
				requestId: value.requestId,
				id: value.id,
				expectedVersion: value.expectedVersion,
			});
		case "recover":
			shape(value, ["id", "runId", "requestId", "expectedVersion"]);
			identity(value.id);
			identity(value.runId);
			identity(value.requestId);
			integer(value.expectedVersion);
			return client.recover({
				id: value.id,
				runId: value.runId,
				requestId: value.requestId,
				expectedVersion: value.expectedVersion,
			});
		case "refresh":
			shape(value, ["id", "runId"]);
			identity(value.id);
			identity(value.runId);
			return client.refresh({ id: value.id, runId: value.runId });
	}
}
export function ticketFailure(error: unknown): Exclude<TicketResult, { status: "ok" }> {
	return error instanceof TicketError
		? { status: error.code, message: error.message }
		: {
				status: "unknown",
				message: "The result could not be confirmed. Check the original request before retrying.",
			};
}
