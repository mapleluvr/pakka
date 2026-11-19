import type { Runtime } from "@pakka/agent";
import {
	PocketInputLookupUnsupported,
	type PocketAuthority,
	type PocketPeople,
	type PocketWorkspace,
	type PocketCollaboration,
	type PocketNotifications,
} from "@pakka/server/pocket";
import {
	decodeWebUiResult,
	WEBUI_SERVICE_API,
	type WebUiCommand,
	type WebUiResult,
} from "@pakka/protocol/webui";
import type { ManagedSessions } from "./sessions.ts";
import type { ProductModelSource } from "./product-models.ts";
import { createModelConnections } from "./model-connections.ts";
import { createPersonModelDefaults, type PersonModelDefaults } from "./model-defaults.ts";
import { WebUiServiceRefusal } from "./service-refusal.ts";
import { createResourceHistory } from "./resource-history.ts";
import { executeSessionBudget } from "./session-budget.ts";
import { executePeople } from "./people-service.ts";
import { executeConversationConfiguration } from "./conversation-configuration.ts";
import { executeCollaboration } from "./collaboration-service.ts";
import { EXTENSION_VERSION } from "@pakka/protocol/extension-rpc";

export interface WebUiServices {
	readonly defaults: PersonModelDefaults;
	execute(actor: PocketAuthority, command: WebUiCommand, signal?: AbortSignal): Promise<WebUiResult>;
	close(): Promise<void>;
}

/** Service composition only: browser UI instances do not own these persistent services. */
export async function createWebUiServices(options: {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly workspace: PocketWorkspace;
	readonly collaboration?: PocketCollaboration;
	readonly notifications?: PocketNotifications;
	readonly sessions?: ManagedSessions;
	readonly models?: ProductModelSource;
	readonly defaults?: PersonModelDefaults;
}): Promise<WebUiServices> {
	const { runtime, people, sessions } = options;
	const defaults = options.defaults ?? createPersonModelDefaults({ runtime, people });
	const models = options.models
		? await createModelConnections({ runtime, people, source: options.models })
		: undefined;
	const history = createResourceHistory({ runtime, people, sessions });
	let closed = false;
	const current = (actor: PocketAuthority) => {
		if (closed) throw new WebUiServiceRefusal("UNSUPPORTED");
		people.current(actor);
	};
	function modelService() {
		if (!models) throw new WebUiServiceRefusal("UNSUPPORTED");
		return models;
	}

	return Object.freeze({
		defaults,
		execute: async (
			actor: PocketAuthority,
			command: WebUiCommand,
			signal?: AbortSignal,
		): Promise<WebUiResult> => {
			current(actor);
			let result: WebUiResult;
			switch (command.op) {
				case "notification.lookup": {
					if (!options.notifications) throw new WebUiServiceRefusal("UNSUPPORTED");
					const original = command.original,
						target = original.target;
					const authorize = () => {
						current(actor);
						signal?.throwIfAborted();
						people.checkReadGrant(actor, target);
					};
					authorize();
					const intent =
						original.op === "notification.subscribe"
							? {
									kind: "subscribe" as const,
									requestId: original.input.requestId,
									subscription: original.input.subscription,
								}
							: original.op === "notification.unsubscribe"
								? {
										kind: "unsubscribe" as const,
										requestId: original.input.requestId,
										deviceId: original.input.deviceId,
									}
								: {
										kind: "preferences" as const,
										requestId: original.input.requestId,
										preferences: original.input.preferences,
									};
					const status = await options.notifications.bind(actor, authorize).lookup(target, intent);
					authorize();
					result = { kind: "notification-operation", actorId: people.current(actor).id, original, status };
					break;
				}
				case "collaboration.read":
				case "collaboration.write":
				case "collaboration.lookup":
					result = await executeCollaboration(
						{ people, actor, collaboration: options.collaboration, signal, check: () => current(actor) },
						command,
					);
					break;
				case "conversation-configuration.read":
				case "conversation-configuration.write":
				case "conversation-configuration.lookup":
					result = await executeConversationConfiguration(
						{ people, actor, workspace: options.workspace, signal, check: () => current(actor) },
						command,
					);
					break;
				case "people.write":
				case "people.lookup":
				case "people.invite.lookup":
					result = await executePeople({ people, actor, signal, check: () => current(actor) }, command);
					break;
				case "session-budget.read":
				case "session-budget.history":
				case "session-budget.write":
				case "session-budget.lookup":
					result = await executeSessionBudget(
						{
							people,
							actor,
							signal,
							check: () => current(actor),
							runtimeFor: (sessionId) => {
								if (runtime.view().sessionId === sessionId) return runtime;
								if (!sessions) throw new WebUiServiceRefusal("UNSUPPORTED");
								return sessions.runtimeFor({ sessionId });
							},
						},
						command,
					);
					break;
				case "input.history":
				case "input.lookup": {
					const target = command.op === "input.lookup" ? command.original.target : command.target;
					const authorize = () => {
						signal?.throwIfAborted();
						try {
							people.check(actor, "read", people.resourceId(target));
						} catch {
							throw new WebUiServiceRefusal("FORBIDDEN");
						}
					};
					authorize();
					try {
						const client = options.workspace.bind(actor);
						if (command.op === "input.lookup") {
							const input = command.original.input;
							const receipt = await client.inputReceipt(target, input);
							result = { kind: "input-operation", target, requestId: input.requestId, receipt };
						} else {
							result = {
								kind: "input-history",
								target,
								page: await client.inputHistory(target, command.cursor),
							};
						}
						authorize();
					} catch (error) {
						authorize();
						if (error instanceof PocketInputLookupUnsupported) throw new WebUiServiceRefusal("UNSUPPORTED");
						throw error;
					}
					break;
				}
				case "capabilities":
					result = {
						kind: "capabilities",
						capabilities: {
							services: WEBUI_SERVICE_API,
							workbench: 2,
							extensions: EXTENSION_VERSION,
							features: [
								...(options.collaboration ? ["collaboration"] : []),
								...(options.notifications ? ["notification.lookup"] : []),
								"conversation-configuration",
								"people.invite.lookup",
								"people.operations",
								"session-budget",
								"input.lookup",
								"input.history",
								"resource.resolve",
								"resource.history",
								"resource.content",
								"model-defaults",
								...(models ? ["model-connections", "model-catalog"] : []),
							],
						},
					};
					break;
				case "resource.resolve":
					result = { kind: "resource", resolution: await history.resolve(actor, command.reference, signal) };
					break;
				case "resource.history":
					result = {
						kind: "resource-history",
						history: await history.history(actor, command.reference, command.options, signal),
					};
					break;
				case "resource.content":
					result = await history.content(actor, command.reference, command.content, command.range, signal);
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
			try {
				current(actor);
			} catch (error) {
				if (
					[
						"collaboration.write",
						"conversation-configuration.write",
						"people.write",
						"session-budget.write",
						"model-connections.write",
						"model-defaults.write",
						"model-connections.reload",
					].includes(command.op)
				)
					throw new WebUiServiceRefusal("UNKNOWN");
				throw error;
			}
			return decodeWebUiResult(result);
		},
		close: async () => {
			if (closed) return;
			closed = true;
			await history.close();
			await models?.close();
		},
	});
}
