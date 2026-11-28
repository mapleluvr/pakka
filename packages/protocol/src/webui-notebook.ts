import { identity } from "./index.ts";
import { isRecord } from "./extensions.ts";
import { decodeTarget } from "./extension-rpc.ts";
import { isPocketContentReference, type AgentRef, type PocketContentReference } from "./pocket.ts";

/** The outer Conversation is part of the locator, not an authorization token. */
export type ContentRef = { sessionId: string; conversationId: string } & (
	| { kind: "note"; noteId: string }
	| { kind: "message" | "tool-result"; content: PocketContentReference }
);
export type ConversationNote = {
	id: string;
	version: number;
	title: string;
	body: string;
	sources: ContentRef[];
	createdAt: number;
	updatedAt: number;
	createdBy: string;
	updatedBy: string;
};
export type ConversationPin = {
	id: string;
	version: number;
	target: ContentRef;
	createdAt: number;
	createdBy: string;
};
export type NotebookAction =
	| { kind: "save"; id: string; expectedVersion: number; title: string; body: string; sources: ContentRef[] }
	| { kind: "delete"; id: string; expectedVersion: number }
	| { kind: "unpin"; id: string; expectedVersion: number }
	| { kind: "pin"; target: ContentRef }
	| { kind: "move"; id: string; expectedVersion: number; orderVersion: number; beforeId: string | null };
export type NotebookRequest = { requestId: string; target: AgentRef; action: NotebookAction };
export type NotebookReceipt = { id: string; version: number; at: number };
export type NotebookCommand =
	| { op: "notebook.list"; target: AgentRef; collection: "notes" | "pins"; offset: number; query: string }
	| { op: "notebook.note"; target: AgentRef; id: string }
	| { op: "notebook.write"; change: NotebookRequest }
	| { op: "notebook.lookup"; original: NotebookRequest };
export interface NotebookResults {
	"notebook.list": {
		kind: "notebook-page";
		target: AgentRef;
		collection: "notes" | "pins";
		offset: number;
		query: string;
		notes: ConversationNote[];
		pins: ConversationPin[];
		total: number;
		orderVersion: number;
		canEdit: boolean;
	};
	"notebook.note": {
		kind: "notebook-note";
		target: AgentRef;
		id: string;
		note: ConversationNote | null;
		canEdit: boolean;
	};
	"notebook.write": {
		kind: "notebook-receipt";
		actorId: string;
		original: NotebookRequest;
		receipt: NotebookReceipt;
	};
	"notebook.lookup": {
		kind: "notebook-operation";
		actorId: string;
		original: NotebookRequest;
		receipt: NotebookReceipt | null;
	};
}
function shape(v: unknown, keys: string): asserts v is Record<string, unknown> {
	if (!isRecord(v) || Object.keys(v).sort().join(" ") !== keys.split(" ").sort().join(" "))
		throw Error("Invalid notebook shape");
}
function ok(value: unknown): asserts value {
	if (!value) throw Error("Invalid notebook value");
}
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, max: number): v is string =>
	typeof v === "string" && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
export function contentRefKey(ref: ContentRef) {
	return JSON.stringify([
		ref.sessionId,
		ref.conversationId,
		ref.kind === "note" ? "note" : "entry",
		ref.kind === "note" ? ref.noteId : ref.content.id,
	]);
}
export function checkContentRef(v: unknown): asserts v is ContentRef {
	ok(isRecord(v));
	const note = v.kind === "note";
	shape(v, `sessionId conversationId kind ${note ? "noteId" : "content"}`);
	ok(identity(v.sessionId) && identity(v.conversationId));
	if (note) {
		ok(identity(v.noteId));
		return;
	}
	const c = v.content;
	ok(
		isPocketContentReference(c) &&
			c.source === "entry" &&
			c.encoding === "text" &&
			/^\/model\/\d+\/content(?:\/\d+\/text)?$/.test(c.path) &&
			v.kind === (c.callId ? "tool-result" : "message"),
	);
}
/** Store only the authorized view and stable content identity, never optional fork attribution. */
export function canonicalContentRef(r: ContentRef): ContentRef {
	if (r.kind === "note") return r;
	const { sourceConversationId: _attribution, ...content } = r.content;
	return { ...r, content };
}
function fields(v: Record<string, unknown>) {
	ok(
		text(v.title, 240) &&
			text(v.body, 32768) &&
			v.body.trim() &&
			Array.isArray(v.sources) &&
			v.sources.length <= 16,
	);
	v.sources.forEach(checkContentRef);
	ok(
		v.sources.every((r) => r.kind !== "note") &&
			new Set(v.sources.map(contentRefKey)).size === v.sources.length,
	);
}
export function checkConversationNote(v: unknown): asserts v is ConversationNote {
	shape(v, "id version title body sources createdAt updatedAt createdBy updatedBy");
	fields(v);
	ok(
		identity(v.id) &&
			count(v.version) &&
			v.version > 0 &&
			count(v.createdAt) &&
			count(v.updatedAt) &&
			identity(v.createdBy) &&
			identity(v.updatedBy),
	);
}
export function checkConversationPin(v: unknown): asserts v is ConversationPin {
	shape(v, "id version target createdAt createdBy");
	checkContentRef(v.target);
	ok(identity(v.id) && count(v.version) && v.version > 0 && count(v.createdAt) && identity(v.createdBy));
}
export function decodeNotebookRequest(v: unknown): NotebookRequest {
	shape(v, "requestId target action");
	ok(identity(v.requestId));
	const t = decodeTarget(v.target),
		a = v.action;
	ok(isRecord(a));
	switch (a.kind) {
		case "save":
			shape(a, "kind id expectedVersion title body sources");
			fields(a);
			break;
		case "delete":
		case "unpin":
			shape(a, "kind id expectedVersion");
			break;
		case "move":
			shape(a, "kind id expectedVersion orderVersion beforeId");
			ok(count(a.orderVersion) && (a.beforeId === null || (identity(a.beforeId) && a.beforeId !== a.id)));
			break;
		case "pin":
			shape(a, "kind target");
			checkContentRef(a.target);
			break;
		default:
			throw Error("Invalid notebook action");
	}
	if (a.kind !== "pin")
		ok(identity(a.id) && count(a.expectedVersion) && (a.kind === "save" || a.expectedVersion > 0));
	const refs =
		a.kind === "save" ? (a.sources as ContentRef[]) : a.kind === "pin" ? [a.target as ContentRef] : [];
	ok(refs.every((r) => r.sessionId === t.sessionId && r.conversationId === t.conversationId));
	return structuredClone(v) as NotebookRequest;
}
/** Compare exact decoded intent independently of JSON member order. */
export function notebookIntent(v: NotebookRequest | AgentRef) {
	return JSON.stringify(v, (_k, x: unknown) =>
		isRecord(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
	);
}
export function checkNotebookList(v: Record<string, unknown>) {
	ok((v.collection === "notes" || v.collection === "pins") && count(v.offset) && text(v.query, 240));
	decodeTarget(v.target);
}
export function checkNotebookCommand(v: Record<string, unknown>) {
	switch (v.op) {
		case "notebook.list":
			shape(v, "op target collection offset query");
			checkNotebookList(v);
			break;
		case "notebook.note":
			shape(v, "op target id");
			decodeTarget(v.target);
			ok(identity(v.id));
			break;
		case "notebook.write":
			shape(v, "op change");
			decodeNotebookRequest(v.change);
			break;
		case "notebook.lookup":
			shape(v, "op original");
			decodeNotebookRequest(v.original);
			break;
		default:
			throw Error("Invalid notebook command");
	}
}
export function checkNotebookReceipt(v: unknown): asserts v is NotebookReceipt {
	shape(v, "id at version");
	ok(identity(v.id) && count(v.at) && count(v.version) && v.version > 0);
}
export const NOTEBOOK_PAGE_SIZE = 8;
export function checkNotebookResult(v: Record<string, unknown>) {
	switch (v.kind) {
		case "notebook-page":
			shape(v, "kind target collection offset query total notes pins orderVersion canEdit");
			checkNotebookList(v);
			ok(
				count(v.total) &&
					count(v.orderVersion) &&
					typeof v.canEdit === "boolean" &&
					Array.isArray(v.notes) &&
					Array.isArray(v.pins) &&
					v.notes.length + v.pins.length <= NOTEBOOK_PAGE_SIZE &&
					(v.collection === "pins" ? v.notes : v.pins).length === 0,
			);
			v.notes.forEach(checkConversationNote);
			v.pins.forEach(checkConversationPin);
			const pageTarget = decodeTarget(v.target);
			const refs = [...v.notes.flatMap((n) => n.sources), ...v.pins.map((p) => p.target)];
			ok(
				refs.every(
					(r) => r.sessionId === pageTarget.sessionId && r.conversationId === pageTarget.conversationId,
				),
			);
			break;
		case "notebook-note":
			shape(v, "kind target id note canEdit");
			decodeTarget(v.target);
			ok(identity(v.id) && typeof v.canEdit === "boolean");
			if (v.note !== null) {
				checkConversationNote(v.note);
				const t = decodeTarget(v.target);
				ok(
					v.note.id === v.id &&
						v.note.sources.every((r) => r.sessionId === t.sessionId && r.conversationId === t.conversationId),
				);
			}
			break;
		case "notebook-receipt":
		case "notebook-operation":
			shape(v, "kind actorId original receipt");
			ok(identity(v.actorId));
			const { action } = decodeNotebookRequest(v.original);
			if (v.receipt !== null || v.kind === "notebook-receipt") {
				checkNotebookReceipt(v.receipt);
				ok(action.kind === "pin" || action.id === v.receipt.id);
			}
			break;
		default:
			throw Error("Invalid notebook result");
	}
}
