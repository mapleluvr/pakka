import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { Runtime, ConversationRef, JsonObject } from "@pakka/agent";
import type { PocketAuthority, PocketPeople, PocketCollaboration } from "@pakka/server/pocket";
import { identity } from "@pakka/protocol";
import { isRecord } from "@pakka/protocol/extensions";
import {
	canonicalContentRef,
	checkConversationNote,
	checkConversationPin,
	checkNotebookReceipt,
	contentRefKey,
	notebookIntent,
	NOTEBOOK_PAGE_SIZE,
	type ConversationNote,
	type ConversationPin,
	type NotebookReceipt,
	type NotebookCommand,
	type NotebookResults,
	type ContentRef,
} from "@pakka/protocol/webui";
import type { createResourceHistory } from "./resource-history.ts";
import { WebUiServiceRefusal } from "./service-refusal.ts";

type Proof = { actorId: string; requestId: string; digest: string; receipt: NotebookReceipt };
type State = {
	schema: 1;
	sessionId: string;
	conversationId: string;
	notes: ConversationNote[];
	pins: ConversationPin[];
	orderVersion: number;
	proofs: Proof[];
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const MAX_BYTES = 2 * 1024 * 1024;
function decode(data: unknown, target: ConversationRef): State {
	const bad = () => {
		throw Error("Notebook storage unconfirmed");
	};
	if (
		!isRecord(data) ||
		Object.keys(data).sort().join(",") !== "conversationId,notes,orderVersion,pins,proofs,schema,sessionId" ||
		data.schema !== 1 ||
		data.sessionId !== target.sessionId ||
		data.conversationId !== target.conversationId ||
		!Array.isArray(data.notes) ||
		!Array.isArray(data.pins) ||
		!Array.isArray(data.proofs) ||
		typeof data.orderVersion !== "number" ||
		!Number.isSafeInteger(data.orderVersion) ||
		data.orderVersion < 0
	)
		throw Error("Invalid notebook binding");
	data.notes.forEach(checkConversationNote);
	data.pins.forEach(checkConversationPin);
	for (const p of data.proofs) {
		if (
			!isRecord(p) ||
			!identity(p.actorId) ||
			!identity(p.requestId) ||
			typeof p.digest !== "string" ||
			!/^[a-f0-9]{64}$/.test(p.digest)
		)
			bad();
		checkNotebookReceipt(p.receipt);
	}
	const s = structuredClone(data) as State;
	for (const keys of [
		s.notes.map((n) => n.id),
		s.pins.map((p) => p.id),
		s.pins.map((p) => contentRefKey(p.target)),
		s.proofs.map((p) => JSON.stringify([p.actorId, p.requestId])),
	])
		if (keys.length !== new Set(keys).size) bad();
	for (const r of [...s.notes.flatMap((n) => n.sources), ...s.pins.map((p) => p.target)])
		if (
			r.conversationId !== s.conversationId ||
			r.sessionId !== s.sessionId ||
			(r.kind === "note" && !s.notes.some((n) => n.id === r.noteId))
		)
			bad();
	return s;
}
const conflict = (): never => {
	throw new WebUiServiceRefusal("CONFLICT");
};
/** One coordinator per original Conversation. Notes, ordered links and historical receipts share a CAS; no model input or chat rows are written. */
export function createConversationNotebook(options: {
	runtimeFor: (ref: ConversationRef) => Runtime;
	people: PocketPeople;
	collaboration: PocketCollaboration;
	history: ReturnType<typeof createResourceHistory>;
}) {
	const { people } = options;
	const tails = new Map<string, Promise<unknown>>();
	return async (
		actor: PocketAuthority,
		command: NotebookCommand,
		signal?: AbortSignal,
	): Promise<NotebookResults[keyof NotebookResults]> => {
		const target =
			command.op === "notebook.write"
				? command.change.target
				: command.op === "notebook.lookup"
					? command.original.target
					: command.target;
		const resource = people.resourceId(target),
			key = hash(JSON.stringify([target.sessionId, target.conversationId]));
		const check = (permission: "read" | "send" = "read") => {
			signal?.throwIfAborted();
			try {
				people.check(actor, permission, resource);
				const current = options
					.runtimeFor(target)
					.view()
					.conversations.find(
						(r) => r.sessionId === target.sessionId && r.conversationId === target.conversationId,
					);
				if (
					!current ||
					current.key !== target.key ||
					(command.op !== "notebook.lookup" &&
						(current.incarnation !== target.incarnation || current.profile !== target.profile))
				)
					throw Error("Invalid binding");
			} catch {
				throw new WebUiServiceRefusal("FORBIDDEN");
			}
		};
		const run = async (): Promise<NotebookResults[keyof NotebookResults]> => {
			check();
			const actorId = people.current(actor).id,
				store = options.runtimeFor(target).store({ namespace: "notebook." + key, maxBytes: MAX_BYTES });
			const snapshot = await store.snapshot();
			check();
			let state: State;
			if (snapshot.version === 0) {
				if (Object.keys(snapshot.data).length) throw Error("Invalid notebook initial state");
				state = {
					schema: 1,
					sessionId: target.sessionId,
					conversationId: target.conversationId,
					notes: [],
					pins: [],
					orderVersion: 0,
					proofs: [],
				};
				if (command.op !== "notebook.lookup") {
					const old = await options.collaboration.bind(actor).legacyNote(target);
					check();
					if (old.text.trim() && old.authorId && old.updatedAt !== null)
						state.notes.push({
							id: "legacy-" + key,
							title: "",
							body: old.text,
							version: old.version,
							sources: [],
							createdAt: old.updatedAt,
							updatedAt: old.updatedAt,
							createdBy: old.authorId,
							updatedBy: old.authorId,
						});
				}
			} else state = decode(snapshot.data, target);
			const commit = async (permission: "read" | "send") => {
				const data: JsonObject = state;
				if (Buffer.byteLength(JSON.stringify(data)) > MAX_BYTES) throw new WebUiServiceRefusal("CAPACITY");
				check(permission);
				await store.compareAndSet(snapshot.version, data, () => check(permission));
			};
			let canEdit = true;
			try {
				check("send");
			} catch {
				canEdit = false;
			}
			if (command.op === "notebook.list" || command.op === "notebook.note") {
				if (!snapshot.version && state.notes.length) {
					await commit("read");
					check();
				}
				if (command.op === "notebook.note")
					return {
						kind: "notebook-note",
						target,
						id: command.id,
						note: state.notes.find((n) => n.id === command.id) ?? null,
						canEdit,
					};
				const { collection, query, offset } = command;
				const notes =
						collection === "notes"
							? state.notes
									.filter((n) => (n.title + "\n" + n.body).toLowerCase().includes(query.toLowerCase()))
									.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
							: [],
					pins = collection === "pins" ? state.pins : [];
				return {
					kind: "notebook-page",
					target,
					collection,
					offset,
					query,
					notes: notes.slice(offset, offset + NOTEBOOK_PAGE_SIZE),
					pins: pins.slice(offset, offset + NOTEBOOK_PAGE_SIZE),
					total: notes.length + pins.length,
					orderVersion: state.orderVersion,
					canEdit,
				};
			}
			const original = command.op === "notebook.write" ? command.change : command.original,
				digest = hash(notebookIntent(original)),
				proof = state.proofs.find((p) => p.actorId === actorId && p.requestId === original.requestId);
			if (proof && proof.digest !== digest) conflict();
			if (command.op === "notebook.lookup")
				return { kind: "notebook-operation", actorId, original, receipt: proof?.receipt ?? null };
			check("send");
			if (proof) return { kind: "notebook-receipt", actorId, original, receipt: proof.receipt };
			const a = original.action,
				at = Date.now();
			let receipt: NotebookReceipt;
			const verify = async (r: ContentRef) => {
				if (r.kind === "note") {
					if (!state.notes.some((n) => n.id === r.noteId)) conflict();
					return;
				}
				const { chunk } = await options.history.content(
					actor,
					{ kind: "conversation", sessionId: r.sessionId, conversationId: r.conversationId },
					r.content,
					{ offset: 0, length: 8 },
					signal,
				);
				check("send");
				if (chunk.reference.callId !== r.content.callId) throw new WebUiServiceRefusal("INVALID_REQUEST");
			};
			if (a.kind === "save" || a.kind === "delete") {
				const n = state.notes.find((n) => n.id === a.id);
				if (
					(n?.version ?? 0) !== a.expectedVersion ||
					(!n && (a.id.startsWith("legacy-") || state.proofs.some((p) => p.receipt.id === a.id)))
				)
					conflict();
				const version = a.expectedVersion + 1;
				if (a.kind === "delete") {
					state.notes = state.notes.filter((n) => n.id !== a.id);
					const pins = state.pins.filter((p) => p.target.kind !== "note" || p.target.noteId !== a.id);
					if (pins.length !== state.pins.length) state.orderVersion++;
					state.pins = pins;
				} else if (a.kind === "save") {
					const sources = a.sources.map(canonicalContentRef);
					for (const [i, r] of sources.entries())
						if (!n?.sources.some((old) => isDeepStrictEqual(old, r))) await verify(a.sources[i]!);
					const note = {
						id: a.id,
						title: a.title,
						body: a.body,
						sources,
						version,
						createdAt: n?.createdAt ?? at,
						createdBy: n?.createdBy ?? actorId,
						updatedAt: at,
						updatedBy: actorId,
					};
					if (n) Object.assign(n, note);
					else state.notes.push(note);
				}
				receipt = { id: a.id, version, at };
			} else if (a.kind === "pin") {
				await verify(a.target);
				let p = state.pins.find((p) => contentRefKey(p.target) === contentRefKey(a.target));
				if (!p) {
					p = {
						id: randomUUID(),
						version: 1,
						target: canonicalContentRef(a.target),
						createdAt: at,
						createdBy: actorId,
					};
					state.pins.push(p);
					state.orderVersion++;
				}
				receipt = { id: p.id, version: p.version, at };
			} else {
				const p = state.pins.find((p) => p.id === a.id);
				if (!p || p.version !== a.expectedVersion) return conflict();
				state.pins = state.pins.filter((row) => row !== p);
				if (a.kind === "move") {
					if (state.orderVersion !== a.orderVersion) conflict();
					const index =
						a.beforeId === null ? state.pins.length : state.pins.findIndex((row) => row.id === a.beforeId);
					if (index < 0) conflict();
					state.pins.splice(index, 0, p);
				}
				p.version++;
				state.orderVersion++;
				receipt = { id: p.id, version: p.version, at };
			}
			state.proofs.push({ actorId, requestId: original.requestId, digest, receipt });
			await commit("send");
			try {
				check();
			} catch {
				throw new WebUiServiceRefusal("UNKNOWN");
			}
			return { kind: "notebook-receipt", actorId, original, receipt };
		};
		const operation = (tails.get(key) ?? Promise.resolve()).then(run);
		const tail = operation.catch(() => {});
		tails.set(key, tail);
		try {
			return await operation;
		} finally {
			if (tails.get(key) === tail) tails.delete(key);
		}
	};
}
