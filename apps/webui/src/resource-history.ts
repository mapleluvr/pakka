import { StoredHistoryReadRefusal, type Runtime, type ConversationRef } from "@pakka/agent";
import {
	scopeContentReference,
	scopeConversationEntries,
	type PocketAuthority,
	type PocketPeople,
} from "@pakka/server/pocket";
import {
	decodeConversationReference,
	decodeConversationHistory,
	type ConversationReference,
	type ConversationResolution,
	type ConversationHistory,
	type ConversationHistoryOptions,
	type WebUiResults,
} from "@pakka/protocol/webui";
import { isPocketContentChunk, type PocketContentReference } from "@pakka/protocol/pocket";
import type { ManagedSessions } from "./sessions.ts";
import { WebUiServiceRefusal } from "./service-refusal.ts";

/** Reads stable original addresses. UI catalog membership is not source identity or an execution grant. */
export function createResourceHistory(options: {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly sessions?: ManagedSessions;
}) {
	const { runtime, people, sessions } = options;
	const lifetime = new AbortController();
	const pending = new Set<Promise<unknown>>();
	let closing: Promise<void> | undefined;
	function loaded(reference: ConversationReference): { owner: Runtime; target: ConversationRef } | undefined {
		let owner: Runtime | undefined;
		if (reference.sessionId === runtime.view().sessionId) owner = runtime;
		else {
			try {
				owner = sessions?.runtimeFor(reference);
			} catch {
				return undefined;
			}
		}
		if (!owner) return undefined;
		const view = owner.view();
		if (view.sessionId !== reference.sessionId) throw new StoredHistoryReadRefusal("identity-mismatch");
		if (view.phase !== "ready") throw new StoredHistoryReadRefusal("unavailable");
		const target = view.conversations.find((item) => item.conversationId === reference.conversationId);
		if (!target) throw new StoredHistoryReadRefusal("unavailable");
		return { owner, target };
	}
	function run<T>(
		actor: PocketAuthority,
		raw: ConversationReference,
		signal: AbortSignal | undefined,
		read: (reference: ConversationReference, check: () => void, signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		const operation = (async () => {
			const reference = decodeConversationReference(raw);
			const active = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
			const check = () => {
				if (active.aborted) throw new WebUiServiceRefusal("FORBIDDEN");
				try {
					people.checkReadGrant(actor, reference);
				} catch {
					throw new WebUiServiceRefusal("FORBIDDEN");
				}
			};
			check();
			const result = await read(reference, check, active);
			check();
			return result;
		})();
		pending.add(operation);
		void operation.then(
			() => pending.delete(operation),
			() => pending.delete(operation),
		);
		return operation;
	}
	function visible(actor: PocketAuthority, reference: ConversationReference) {
		return (conversationId: string) => {
			try {
				people.checkReadGrant(actor, { sessionId: reference.sessionId, conversationId });
				return true;
			} catch {
				people.current(actor);
				return false;
			}
		};
	}
	function failure(error: unknown): never {
		if (error instanceof WebUiServiceRefusal) throw error;
		if (error instanceof StoredHistoryReadRefusal) {
			if (error.reason === "denied" || error.reason === "cancelled")
				throw new WebUiServiceRefusal("FORBIDDEN");
			if (error.reason === "invalid-request") throw new WebUiServiceRefusal("INVALID_REQUEST");
			if (error.reason === "busy") throw new WebUiServiceRefusal("CAPACITY");
			throw new WebUiServiceRefusal("UNSUPPORTED");
		}
		throw error;
	}
	return Object.freeze({
		resolve: async (
			actor: PocketAuthority,
			raw: ConversationReference,
			signal?: AbortSignal,
		): Promise<ConversationResolution> => {
			try {
				return await run(
					actor,
					raw,
					signal,
					async (reference, _check, active): Promise<ConversationResolution> => {
						const current = loaded(reference);
						if (current) return { status: "loaded", reference, target: current.target };
						if (!sessions) throw new StoredHistoryReadRefusal("unavailable");
						await sessions.readStored(actor, reference, { kind: "source" }, active);
						return { status: "unloaded", reference, history: "readable" };
					},
				);
			} catch (error) {
				people.current(actor);
				const reference = decodeConversationReference(raw);
				if (error instanceof WebUiServiceRefusal && error.code === "FORBIDDEN")
					return { status: "forbidden", reference, history: "unsupported" };
				if (!(error instanceof StoredHistoryReadRefusal)) throw error;
				const reason = error.reason;
				return {
					status:
						reason === "denied" || reason === "cancelled"
							? "forbidden"
							: reason === "identity-mismatch"
								? "identity-mismatch"
								: "unavailable",
					reference,
					history: "unsupported",
					...(reason === "unsupported" || reason === "invalid-source" || reason === "busy" ? { reason } : {}),
				};
			}
		},
		history: (
			actor: PocketAuthority,
			raw: ConversationReference,
			page?: ConversationHistoryOptions,
			signal?: AbortSignal,
		): Promise<ConversationHistory> =>
			run(actor, raw, signal, async (reference, check, active): Promise<ConversationHistory> => {
				const current = loaded(reference);
				if (current) {
					const snapshot = await current.owner.previewConversation(current.target, check, page);
					return decodeConversationHistory({
						status: "loaded",
						snapshot: {
							...snapshot,
							entries: scopeConversationEntries(snapshot.entries, visible(actor, reference)),
						},
					});
				}
				if (!sessions) throw new StoredHistoryReadRefusal("unavailable");
				const result = await sessions.readStored(actor, reference, { kind: "page", options: page }, active);
				if (result.kind !== "page") throw new Error("Invalid stored history result");
				return decodeConversationHistory({
					status: "unloaded",
					page: {
						...result.page,
						reference,
						entries: scopeConversationEntries(result.page.entries, visible(actor, reference)),
					},
				});
			}).catch(failure),
		content: (
			actor: PocketAuthority,
			raw: ConversationReference,
			content: PocketContentReference,
			range: { readonly offset: number; readonly length: number },
			signal?: AbortSignal,
		): Promise<WebUiResults["resource.content"]> =>
			run(actor, raw, signal, async (reference, check, active): Promise<WebUiResults["resource.content"]> => {
				const current = loaded(reference);
				let chunk;
				if (current) chunk = await current.owner.readContent(current.target, content, range, check);
				else {
					if (!sessions) throw new StoredHistoryReadRefusal("unavailable");
					const result = await sessions.readStored(
						actor,
						reference,
						{ kind: "content", content, range },
						active,
					);
					if (result.kind !== "content") throw new Error("Invalid stored content result");
					chunk = result.chunk;
				}
				const scoped = {
					...chunk,
					reference: scopeContentReference(chunk.reference, visible(actor, reference)),
				};
				if (!isPocketContentChunk(scoped)) throw new WebUiServiceRefusal("UNSUPPORTED");
				return { kind: "resource-content", reference, chunk: scoped };
			}).catch(failure),
		close: (): Promise<void> => {
			if (!closing) {
				lifetime.abort();
				closing = Promise.allSettled([...pending]).then(() => {});
			}
			return closing;
		},
	});
}
