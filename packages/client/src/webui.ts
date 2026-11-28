import {
	decodeWebUiRequest,
	notebookIntent,
	matchesSessionBudgetReceipt,
	matchesPeopleReceipt,
	matchesConversationConfigurationReceipt,
	matchesCollaborationReceipt,
	collaborationIntent,
	sameConversationConfigurationRequest,
	notificationIntent,
	type NotificationRequest,
	decodeWebUiResponse,
	WEBUI_SERVICE_MAX_BYTES,
	WEBUI_SERVICE_PATH,
	WEBUI_SERVICE_API,
	type WebUiCommand,
	type WebUiResult,
	type WebUiResults,
} from "@pakka/protocol/webui";
import { PocketRemoteError, type PocketClientOptions, type PocketRequestOptions } from "./pocket.ts";
import { identity } from "@pakka/protocol";
import { isRecord } from "@pakka/protocol/extensions";
export type * from "@pakka/protocol/webui";

export interface WebUiServiceClient {
	request<C extends WebUiCommand>(command: C, options?: PocketRequestOptions): Promise<WebUiResults[C["op"]]>;
}
const kinds: { readonly [K in keyof WebUiResults]: WebUiResults[K]["kind"] } = {
	"notebook.list": "notebook-page",
	"notebook.note": "notebook-note",
	"notebook.write": "notebook-receipt",
	"notebook.lookup": "notebook-operation",
	"notification.lookup": "notification-operation",
	"collaboration.read": "collaboration",
	"collaboration.write": "collaboration-receipt",
	"collaboration.lookup": "collaboration-operation",
	"conversation-configuration.read": "conversation-configuration",
	"conversation-configuration.write": "conversation-configuration-receipt",
	"conversation-configuration.lookup": "conversation-configuration-operation",
	"people.settings": "people-settings",
	"people.write": "people-receipt",
	"people.lookup": "people-operation",
	"people.invite.lookup": "people-invitation",
	"session-budget.read": "session-budget",
	"session-budget.history": "session-budget-history",
	"session-budget.write": "session-budget-receipt",
	"session-budget.lookup": "session-budget-operation",
	capabilities: "capabilities",
	"input.lookup": "input-operation",
	"input.history": "input-history",
	"resource.resolve": "resource",
	"resource.history": "resource-history",
	"resource.content": "resource-content",
	"model-connections.read": "model-configuration",
	"model-connections.reload": "model-reload",
	"model-connections.validate": "model-validation",
	"model-connections.write": "model-configuration-receipt",
	"model-connections.lookup": "model-configuration-operation",
	"model-catalog.read": "model-catalog",
	"model-catalog.refresh": "model-catalog-refresh",
	"model-defaults.read": "model-defaults",
	"model-defaults.write": "model-defaults-receipt",
	"model-defaults.lookup": "model-defaults-operation",
};
function correlate(command: WebUiCommand, result: WebUiResult, personId: string | null): boolean {
	if (kinds[command.op] !== result.kind) return false;
	if (command.op === "notebook.list")
		return (
			result.kind === "notebook-page" &&
			notebookIntent(result.target) === notebookIntent(command.target) &&
			result.collection === command.collection &&
			result.offset === command.offset &&
			result.query === command.query
		);
	if (command.op === "notebook.note")
		return (
			result.kind === "notebook-note" &&
			notebookIntent(result.target) === notebookIntent(command.target) &&
			result.id === command.id
		);
	if (command.op === "notebook.write" || command.op === "notebook.lookup")
		return (
			(result.kind === "notebook-operation" || result.kind === "notebook-receipt") &&
			result.actorId === personId &&
			notebookIntent(result.original) ===
				notebookIntent(command.op === "notebook.write" ? command.change : command.original)
		);
	if (command.op === "notification.lookup")
		return (
			result.kind === "notification-operation" &&
			result.actorId === personId &&
			notificationIntent(result.original) === notificationIntent(command.original)
		);
	if (command.op === "collaboration.read" && result.kind === "collaboration") {
		const a = result.view.target,
			b = command.target;
		return (
			a.key === b.key &&
			a.sessionId === b.sessionId &&
			a.conversationId === b.conversationId &&
			a.incarnation === b.incarnation &&
			a.profile === b.profile
		);
	}
	if (command.op === "collaboration.write" || command.op === "collaboration.lookup") {
		if (
			personId === null ||
			(result.kind !== "collaboration-receipt" && result.kind !== "collaboration-operation")
		)
			return false;
		const original = command.op === "collaboration.write" ? command.change : command.original;
		if (
			result.kind === "collaboration-operation" &&
			(result.actorId !== personId || collaborationIntent(result.original) !== collaborationIntent(original))
		)
			return false;
		return result.receipt === null || matchesCollaborationReceipt(result.receipt, original, personId);
	}
	if (command.op === "conversation-configuration.read" && result.kind === "conversation-configuration") {
		const target = result.view.configuration.ref;
		return ["key", "sessionId", "conversationId", "incarnation", "profile"].every(
			(key) => target[key as keyof typeof target] === command.target[key as keyof typeof target],
		);
	}
	if (
		command.op === "conversation-configuration.write" ||
		command.op === "conversation-configuration.lookup"
	) {
		if (
			personId === null ||
			(result.kind !== "conversation-configuration-receipt" &&
				result.kind !== "conversation-configuration-operation")
		)
			return false;
		const original = command.op === "conversation-configuration.write" ? command.change : command.original;
		if (
			result.kind === "conversation-configuration-operation" &&
			(result.actorId !== personId || !sameConversationConfigurationRequest(result.original, original))
		)
			return false;
		return (
			result.receipt === null || matchesConversationConfigurationReceipt(result.receipt, original, personId)
		);
	}
	if (command.op === "people.write" || command.op === "people.lookup") {
		if (personId === null || (result.kind !== "people-receipt" && result.kind !== "people-operation"))
			return false;
		const original = command.op === "people.write" ? command.change : command.original;
		if (
			result.kind === "people-operation" &&
			(result.actorId !== personId || result.requestId !== original.requestId)
		)
			return false;
		return result.receipt === null || matchesPeopleReceipt(result.receipt, original, personId);
	}
	if (command.op === "people.invite.lookup" && result.kind === "people-invitation") {
		const original = command.original;
		return (
			result.issuerId === personId &&
			result.requestId === original.requestId &&
			(result.invite === null ||
				(result.invite.role === original.role &&
					JSON.stringify(result.invite.resources === "*" ? "*" : [...result.invite.resources].sort()) ===
						JSON.stringify(original.resources === "*" ? "*" : [...original.resources].sort())))
		);
	}
	if (command.op === "session-budget.read" && result.kind === "session-budget")
		return result.sessionId === command.sessionId;
	if (command.op === "session-budget.history" && result.kind === "session-budget-history")
		return (
			result.sessionId === command.sessionId &&
			result.page.items.length <= (command.limit ?? 50) &&
			result.page.items.every(
				(row) => command.beforeVersion === undefined || row.version < command.beforeVersion,
			)
		);
	if (command.op === "session-budget.write" || command.op === "session-budget.lookup") {
		if (result.kind !== "session-budget-receipt" && result.kind !== "session-budget-operation") return false;
		const original = command.op === "session-budget.write" ? command.change : command.original;
		return (
			result.sessionId === command.sessionId &&
			(result.receipt === null ||
				(personId !== null && matchesSessionBudgetReceipt(result.receipt, original, personId)))
		);
	}
	if (command.op === "input.history" && result.kind === "input-history") {
		const sameResource = (value: typeof command.target) =>
			value.sessionId === command.target.sessionId && value.conversationId === command.target.conversationId;
		return (
			sameResource(result.target) &&
			result.target.key === command.target.key &&
			result.target.incarnation === command.target.incarnation &&
			result.target.profile === command.target.profile &&
			result.page.items.every(
				(item) => item.receipt.actorId === personId && sameResource(item.receipt.target),
			) &&
			new Set(result.page.items.map((item) => item.receipt.id)).size === result.page.items.length &&
			(result.page.nextCursor === undefined ||
				result.page.nextCursor === result.page.items.at(-1)?.receipt.id)
		);
	}
	if (command.op === "input.lookup" && result.kind === "input-operation") {
		const { target, input } = command.original;
		const sameTarget = (value: typeof target) =>
			value.key === target.key &&
			value.sessionId === target.sessionId &&
			value.conversationId === target.conversationId &&
			value.incarnation === target.incarnation &&
			value.profile === target.profile;
		return (
			result.requestId === input.requestId &&
			sameTarget(result.target) &&
			(result.receipt === null ||
				(result.receipt.requestId === input.requestId &&
					result.receipt.actorId === personId &&
					sameTarget(result.receipt.target)))
		);
	}
	if (command.op === "resource.resolve" && result.kind === "resource")
		return (
			result.resolution.reference.sessionId === command.reference.sessionId &&
			result.resolution.reference.conversationId === command.reference.conversationId
		);
	if (command.op === "resource.history" && result.kind === "resource-history") {
		const page = result.history.status === "loaded" ? result.history.snapshot : result.history.page;
		const reference =
			result.history.status === "loaded" ? result.history.snapshot.ref : result.history.page.reference;
		return (
			reference.sessionId === command.reference.sessionId &&
			reference.conversationId === command.reference.conversationId &&
			(command.options?.limit === undefined || page.entries.length <= command.options.limit) &&
			new TextEncoder().encode(JSON.stringify(page)).byteLength <= (command.options?.maxBytes ?? 262144)
		);
	}
	if (command.op === "resource.content" && result.kind === "resource-content")
		return (
			result.reference.sessionId === command.reference.sessionId &&
			result.reference.conversationId === command.reference.conversationId &&
			[
				"id",
				"source",
				"entryId",
				"sourceConversationId",
				"taskId",
				"callId",
				"revision",
				"path",
				"encoding",
				"byteLength",
				"previewComplete",
			].every(
				(key) =>
					(key === "callId" && command.content.source === "entry" && command.content.callId === undefined) ||
					command.content[key] === result.chunk.reference[key],
			) &&
			result.chunk.offset === command.range.offset &&
			result.chunk.nextOffset <= command.range.offset + command.range.length
		);
	if (command.op === "model-connections.write" || command.op === "model-connections.lookup") {
		const original = command.op === "model-connections.write" ? command.change : command.original;
		if (result.kind !== "model-configuration-receipt" && result.kind !== "model-configuration-operation")
			return false;
		return (
			result.receipt === null ||
			(result.receipt.requestId === original.requestId && (!personId || result.receipt.actorId === personId))
		);
	}
	if (command.op === "model-defaults.write" || command.op === "model-defaults.lookup") {
		const original = command.op === "model-defaults.write" ? command.change : command.original;
		if (result.kind !== "model-defaults-receipt" && result.kind !== "model-defaults-operation") return false;
		return (
			result.receipt === null ||
			(result.receipt.requestId === original.requestId &&
				(!personId || result.receipt.actorId === personId) &&
				result.receipt.defaults.version === original.expectedVersion + 1 &&
				result.receipt.defaults.thinkingLevel === original.thinkingLevel &&
				result.receipt.defaults.model?.provider === original.model?.provider &&
				result.receipt.defaults.model?.id === original.model?.id)
		);
	}
	if (command.op === "model-catalog.read" && result.kind === "model-catalog")
		return (
			(command.query.revision === undefined || command.query.revision === result.page.revision) &&
			result.page.models.length <= (command.query.limit ?? 50) &&
			result.page.models.every(
				(item) =>
					(!command.query.type || item.type === command.query.type) &&
					(!command.query.provider || item.provider === command.query.provider),
			)
		);
	return true;
}
/** Fingerprint of the normalized browser subscription used by the native device registry. */
export async function notificationSubscriptionKey(
	subscription: Extract<
		NotificationRequest,
		{ readonly op: "notification.subscribe" }
	>["input"]["subscription"],
): Promise<string> {
	const value = {
		endpoint: subscription.endpoint,
		keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
	};
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function readBody(response: Response): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing service response");
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let body = "",
		bytes = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > WEBUI_SERVICE_MAX_BYTES) {
				await reader.cancel();
				throw new Error("Service response capacity exceeded");
			}
			body += decoder.decode(chunk.value, { stream: true });
		}
		return JSON.parse(body + decoder.decode());
	} finally {
		reader.releaseLock();
	}
}
/** Inert until explicitly called. Cookie/CSRF are supplied by the host; writes are never retried. */
export function createWebUiServiceClient(
	options: PocketClientOptions & {
		readonly personId: () => string | null;
		readonly serverId: () => string | null;
	},
): WebUiServiceClient {
	let endpoint: URL;
	try {
		endpoint = new URL(options.endpoint);
	} catch {
		throw new Error("Invalid WebUI service endpoint");
	}
	if (
		!["http:", "https:"].includes(endpoint.protocol) ||
		endpoint.pathname !== WEBUI_SERVICE_PATH ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash ||
		(typeof globalThis.location !== "undefined" && globalThis.location.origin !== endpoint.origin)
	)
		throw new Error("Explicit same-origin WebUI service endpoint required");
	const timeoutMs = options.timeoutMs ?? 10000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
		throw new Error("Invalid service deadline");
	async function request<C extends WebUiCommand>(
		command: C,
		input: PocketRequestOptions = {},
	): Promise<WebUiResults[C["op"]]> {
		const requestId = input.requestId ?? globalThis.crypto.randomUUID();
		if (input.signal?.aborted) throw new PocketRemoteError("FORBIDDEN", "denied", requestId);
		const personId = options.personId();
		const expectedServer = options.serverId();
		if (!identity(personId) || !identity(expectedServer))
			throw new PocketRemoteError("FORBIDDEN", "denied", requestId);
		const encoded = decodeWebUiRequest({
			api: WEBUI_SERVICE_API,
			requestId,
			binding: { personId, serverId: expectedServer },
			command,
		});
		const controller = new AbortController(),
			abort = () => controller.abort();
		input.signal?.addEventListener("abort", abort, { once: true });
		const timeout = setTimeout(abort, timeoutMs);
		try {
			const csrf = options.csrf?.() ?? null;
			if (csrf !== null && !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new Error("Invalid CSRF binding");
			const response = await (options.fetch ?? fetch)(endpoint.href, {
				method: "POST",
				credentials: "same-origin",
				redirect: "error",
				cache: "no-store",
				headers: { "Content-Type": "application/json", ...(csrf ? { "X-Pakka-CSRF": csrf } : {}) },
				body: JSON.stringify(encoded),
				signal: controller.signal,
			});
			const body = await readBody(response);
			if (
				isRecord(body) &&
				Number.isSafeInteger(body.api) &&
				body.api !== WEBUI_SERVICE_API &&
				body.requestId === requestId &&
				body.serverId === expectedServer &&
				options.serverId() === expectedServer &&
				options.personId() === personId
			)
				// An unsupported peer cannot certify a write's outcome; never retry it as a fresh operation.
				throw new PocketRemoteError("VERSION_MISMATCH", "unknown", requestId);
			const decoded = decodeWebUiResponse(body, requestId);
			if (
				decoded.serverId !== expectedServer ||
				options.serverId() !== expectedServer ||
				options.personId() !== personId
			)
				throw new Error("Service identity changed");
			if ("error" in decoded)
				throw new PocketRemoteError(decoded.error.code, decoded.error.outcome, requestId);
			if (!response.ok || !correlate(command, decoded.result, personId))
				throw new Error("Uncorrelated service result");
			if (
				command.op === "notification.lookup" &&
				command.original.op === "notification.subscribe" &&
				decoded.result.kind === "notification-operation" &&
				decoded.result.status !== null
			) {
				const key = await notificationSubscriptionKey(command.original.input.subscription);
				if (!decoded.result.status.devices.some((device) => device.subscriptionKey === key))
					throw new Error("Wrong notification subscription result");
				controller.signal.throwIfAborted();
				if (options.serverId() !== expectedServer || options.personId() !== personId)
					throw new Error("Service identity changed");
			}
			// SAFETY: the closed result decoder and correlate checked the command's exact result kind and identities.
			return decoded.result as WebUiResults[C["op"]];
		} catch (error) {
			if (error instanceof PocketRemoteError) throw error;
			throw new PocketRemoteError("UNKNOWN", "unknown", requestId);
		} finally {
			clearTimeout(timeout);
			input.signal?.removeEventListener("abort", abort);
		}
	}
	return Object.freeze({ request });
}
