import type { Runtime } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "@pakka/server/pocket";
import {
	decodeConversationReference,
	decodeWebUiResult,
	type ConversationReference,
	type ConversationResolution,
	type WebUiCommand,
	type WebUiResult,
} from "@pakka/protocol/webui";
import type { ManagedSessions } from "./sessions.ts";
import type { ProductModelSource } from "./product-models.ts";
import { createModelConnections } from "./model-connections.ts";
import { createPersonModelDefaults, type PersonModelDefaults } from "./model-defaults.ts";
import { WebUiServiceRefusal } from "./service-refusal.ts";

export interface WebUiServices {
	readonly defaults: PersonModelDefaults;
	execute(actor: PocketAuthority, command: WebUiCommand): Promise<WebUiResult>;
	close(): Promise<void>;
}

/** Service composition only: browser UI instances do not own these persistent services. */
export async function createWebUiServices(options: {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly sessions?: ManagedSessions;
	readonly models?: ProductModelSource;
	readonly defaults?: PersonModelDefaults;
}): Promise<WebUiServices> {
	const { runtime, people, sessions } = options;
	const defaults = options.defaults ?? createPersonModelDefaults({ runtime, people });
	const models = options.models
		? await createModelConnections({ runtime, people, source: options.models })
		: undefined;
	let closed = false;
	const current = (actor: PocketAuthority) => {
		if (closed) throw new WebUiServiceRefusal("UNSUPPORTED");
		people.current(actor);
	};
	function modelService() {
		if (!models) throw new WebUiServiceRefusal("UNSUPPORTED");
		return models;
	}
	async function resolve(
		actor: PocketAuthority,
		raw: ConversationReference,
	): Promise<ConversationResolution> {
		const reference = decodeConversationReference(raw);
		const unavailable = (
			status: "unloaded" | "unavailable" | "forbidden" | "identity-mismatch",
		): ConversationResolution => ({ status, reference, history: "unsupported" });
		try {
			people.check(actor, "read", people.resourceId(reference));
		} catch {
			current(actor);
			return unavailable("forbidden");
		}
		let owner: Runtime | undefined;
		if (reference.sessionId === runtime.view().sessionId) owner = runtime;
		else if (sessions) {
			try {
				owner = sessions.runtimeFor(reference);
			} catch {
				const known = (await sessions.list(actor)).find((session) => session.id === reference.sessionId);
				current(actor);
				return unavailable(
					known?.status === "unavailable" && known.problem?.kind === "open-failed"
						? "unloaded"
						: "unavailable",
				);
			}
		}
		current(actor);
		if (!owner) return unavailable("unavailable");
		const view = owner.view();
		if (view.sessionId !== reference.sessionId) return unavailable("identity-mismatch");
		if (view.phase !== "ready") return unavailable("unavailable");
		const target = view.conversations.find((item) => item.conversationId === reference.conversationId);
		if (!target) return unavailable("unavailable");
		people.check(actor, "read", people.resourceId(target));
		return { status: "loaded", reference, target };
	}
	return Object.freeze({
		defaults,
		execute: async (actor: PocketAuthority, command: WebUiCommand): Promise<WebUiResult> => {
			current(actor);
			let result: WebUiResult;
			switch (command.op) {
				case "capabilities":
					result = {
						kind: "capabilities",
						capabilities: {
							services: 1,
							workbench: 2,
							extensions: 2,
							features: [
								"resource.resolve",
								"model-defaults",
								...(models ? ["model-connections", "model-catalog"] : []),
							],
						},
					};
					break;
				case "resource.resolve":
					result = { kind: "resource", resolution: await resolve(actor, command.reference) };
					break;
				case "model-connections.read":
					result = { kind: "model-configuration", configuration: await modelService().read(actor) };
					break;
				case "model-connections.validate":
					result = {
						kind: "model-validation",
						valid: await modelService().validate(actor, command.change),
						validator: "pi-coding-agent-model-runtime",
					};
					break;
				case "model-connections.write":
					result = {
						kind: "model-configuration-receipt",
						receipt: await modelService().write(actor, command.change),
					};
					break;
				case "model-connections.lookup":
					result = {
						kind: "model-configuration-operation",
						receipt: await modelService().lookup(actor, command.original),
					};
					break;
				case "model-connections.reload":
					result = { kind: "model-reload", load: await modelService().reload(actor) };
					break;
				case "model-catalog.read":
					result = { kind: "model-catalog", page: await modelService().catalog(actor, command.query) };
					break;
				case "model-catalog.refresh":
					result = {
						kind: "model-catalog-refresh",
						status: await modelService().refreshCatalog(actor, {
							allowNetwork: command.allowNetwork,
							...(command.provider ? { provider: command.provider } : {}),
						}),
					};
					break;
				case "model-defaults.read":
					result = { kind: "model-defaults", defaults: await defaults.read(actor) };
					break;
				case "model-defaults.write":
					result = { kind: "model-defaults-receipt", receipt: await defaults.write(actor, command.change) };
					break;
				case "model-defaults.lookup":
					result = {
						kind: "model-defaults-operation",
						receipt: await defaults.lookup(actor, command.original),
					};
					break;
			}
			current(actor);
			return decodeWebUiResult(result);
		},
		close: async () => {
			if (closed) return;
			closed = true;
			await models?.close();
		},
	});
}
