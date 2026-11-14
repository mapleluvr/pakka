import {
	TicketError,
	type TicketClient,
	type TicketPage,
	type TicketReceipt,
	type TicketView,
	type TicketHistoryPage,
	type TicketRequestReceipt,
	type TicketReport,
	type TicketReportPage,
	type TicketWorkClient,
} from "./types.ts";
import { conversationReference } from "./work-repository.ts";
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
	| "set-state"
	| "register-work"
	| "set-work-contribution"
	| "get-work"
	| "revise-report"
	| "read-report"
	| "reports"
	| "dispatch"
	| "recover"
	| "refresh"
	| "capabilities";
export type TicketActionValue =
	| TicketPage
	| TicketView
	| TicketReceipt
	| TicketRequestReceipt
	| TicketReport
	| TicketReportPage
	| Awaited<ReturnType<TicketWorkClient["getWork"]>>
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
			shape(value, ["requestId", "id", "workId", "text", "links"], ["results"]);
			identity(value.requestId);
			identity(value.id);
			identity(value.workId);
			text(value.text, 12000, true);
			links(value.links);
			if (value.results !== undefined) resultReferences(value.results);
			return client.report({
				requestId: value.requestId,
				id: value.id,
				workId: value.workId,
				text: value.text,
				links: value.links,
				...(value.results !== undefined ? { results: value.results } : {}),
			});
		case "set-state":
			shape(value, ["requestId", "id", "expectedVersion", "state", "text", "links"]);
			identity(value.requestId);
			identity(value.id);
			integer(value.expectedVersion);
			state(value.state);
			text(value.text, 12000, true);
			links(value.links);
			return client.setState({
				requestId: value.requestId,
				id: value.id,
				expectedVersion: value.expectedVersion,
				state: value.state,
				text: value.text,
				links: value.links,
			});
		case "register-work":
			shape(value, ["requestId", "id", "expectedVersion", "handlerId", "contentRevision", "conversation"]);
			identity(value.requestId);
			identity(value.id);
			integer(value.expectedVersion);
			identity(value.handlerId);
			integer(value.contentRevision);
			conversationReference(value.conversation);
			return client.registerWork({
				requestId: value.requestId,
				id: value.id,
				expectedVersion: value.expectedVersion,
				handlerId: value.handlerId,
				contentRevision: value.contentRevision,
				conversation: value.conversation,
			});
		case "set-work-contribution":
			shape(value, ["requestId", "id", "workId", "expectedVersion", "allowed"]);
			identity(value.requestId);
			identity(value.id);
			identity(value.workId);
			integer(value.expectedVersion);
			if (typeof value.allowed !== "boolean") throw new TicketError("invalid", "Invalid contribution state");
			return client.setWorkContribution({
				requestId: value.requestId,
				id: value.id,
				workId: value.workId,
				expectedVersion: value.expectedVersion,
				allowed: value.allowed,
			});
		case "get-work":
			shape(value, ["id", "workId"]);
			identity(value.id);
			identity(value.workId);
			return client.getWork({ id: value.id, workId: value.workId });
		case "revise-report":
			shape(value, ["requestId", "id", "reportId", "expectedVersion", "text", "links"], ["results"]);
			identity(value.requestId);
			identity(value.id);
			identity(value.reportId);
			integer(value.expectedVersion);
			text(value.text, 12000, true);
			links(value.links);
			if (value.results !== undefined) resultReferences(value.results);
			return client.reviseReport({
				requestId: value.requestId,
				id: value.id,
				reportId: value.reportId,
				expectedVersion: value.expectedVersion,
				text: value.text,
				links: value.links,
				...(value.results !== undefined ? { results: value.results } : {}),
			});
		case "read-report":
			shape(value, ["id", "reportId"], ["version"]);
			identity(value.id);
			identity(value.reportId);
			if (value.version !== undefined) integer(value.version);
			return client.readReport({
				id: value.id,
				reportId: value.reportId,
				...(value.version !== undefined ? { version: value.version } : {}),
			});
		case "reports":
			shape(value, ["id"], ["cursor", "limit"]);
			identity(value.id);
			if (value.cursor !== undefined) text(value.cursor, 2048, true);
			if (value.limit !== undefined) integer(value.limit, 1, 32);
			return client.reports({
				id: value.id,
				...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
				...(value.limit !== undefined ? { limit: value.limit } : {}),
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
