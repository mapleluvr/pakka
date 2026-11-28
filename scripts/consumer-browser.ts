import { readTicketResult, ticketCall } from "@pakka/rsi/client";
import { Tickets } from "@pakka/rsi/webui";
import { Button } from "@astryxdesign/core/Button";
import type { UiViewProps } from "@pakka/webui-sdk";
import { createExtensionClient, type ExtensionServiceBinding } from "@pakka/client/extensions";
import { decodeManifest } from "@pakka/protocol/extensions";
import { createElement } from "react";

export function publicTicketsBrowser({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
	const value = readTicketResult("list", { status: "ok", value: { items: [], cursor: null } });
	void ticketCall(bindings, "get", { id: "ticket" });
	// @ts-expect-error Browser ticket results have no Runtime authority.
	value.runtime.createConversation({ key: "forged" });
	return createElement(Tickets, { ui, bindings });
}
import * as masBrowser from "@pakka/mas-devpack/client";
import { createPocketClient, type PocketCommand, type PocketSnapshot } from "@pakka/client/pocket";
import { POCKET_VERSION, decodePocketRequest, decodePocketResponse } from "@pakka/protocol/pocket";
import { createClient, type ClientResult, type ClientOptions, RemoteError } from "@pakka/client";
import { decodeRequest, decodeResponse, type AgentRef, type Command } from "@pakka/protocol";
export function publicMasBrowser(value: unknown) {
	const view = masBrowser.readBoard(value);
	// @ts-expect-error The browser-only MAS DTO is not a Runtime or a native command capability.
	view.runtime.createConversation({ key: "forged" });
	// @ts-expect-error Agent profile/tool composition does not belong to the browser export graph.
	masBrowser.createMasProfilePacks({ profiles: {} });
	return view.members.map((member) => member.ref.conversationId);
}

export function PublicExtension({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
	const client = createExtensionClient({
		endpoint: "http://127.0.0.1:1/pakka-webui/extensions/rpc",
		personId: () => bindings.personId,
		serverId: () => bindings.serverId,
	});
	const original = {
		extension: bindings.extensionId,
		requestId: "original-browser-action",
		...(bindings.target ? { target: bindings.target } : {}),
	};
	void client.operationByRequest(original);
	void bindings.operationByRequest(original.requestId);
	// @ts-expect-error The original-operation query binds its actor on the server, not from the browser.
	client.operationByRequest({ ...original, actorId: "forged" });
	// @ts-expect-error A browser binding receives no native runtime/storage/provider handles.
	bindings.runtime.session.commit();
	// @ts-expect-error UI instance capabilities carry no service or actor authority.
	ui.call("save", {});
	const control = {
		extension: "example",
		facet: "backend" as const,
		action: "enable" as const,
		expectedGeneration: "current",
		requestId: "control",
	};
	// @ts-expect-error A browser cannot forge actor/grants through the extension client.
	client.control({ ...control, actorId: "forged" });
	return createElement(Button, { label: "Close", onClick: () => ui.close() });
}
export { decodeManifest };
export function pocketBrowserOnly(endpoint: string, csrf: () => string | null, ref: AgentRef) {
	const client = createPocketClient({ endpoint, csrf });
	const command: PocketCommand = { op: "read", target: ref, page: { limit: 8 } };
	const decoded = decodePocketRequest({ version: POCKET_VERSION, requestId: "read", command });
	// @ts-expect-error A browser cannot choose another actor/principal for a command.
	client.request({ ...command, actorId: "forged" });
	// @ts-expect-error Model credentials are not browser client configuration.
	createPocketClient({ endpoint, apiKey: "forged" });
	const check: (value: PocketSnapshot) => string = (value) => value.ref.conversationId;
	return { read: client.request(command), decoded, check, decodePocketResponse };
}

export async function privateConfigurationBrowser(endpoint: string, csrf: () => string | null) {
	const client = createPocketClient({ endpoint, csrf });
	const value = await client.request({ op: "credential.status" });
	if (value.kind !== "credential") throw new Error("Unexpected private configuration response");
	// @ts-expect-error Public credential status does not return the saved secret.
	void value.status.secret;
	void client.request({
		op: "credential.replace",
		input: {
			requestId: "replace",
			expectedVersion: value.status.version,
			secret: "synthetic",
			// @ts-expect-error A private configuration command cannot change the provider endpoint.
			endpoint: "https://forged.invalid",
		},
	});
	return value.status.configured;
}

export async function notificationBrowser(endpoint: string, target: AgentRef) {
	const client = createPocketClient({ endpoint });
	const result = await client.request({ op: "notification.status", target });
	if (result.kind !== "notification") throw new Error("Unexpected notification status");
	for (const device of result.status.devices) {
		const subscriptionKey: string = device.subscriptionKey;
		void subscriptionKey;
		// @ts-expect-error Status never returns a push endpoint or subscription secret.
		void device.endpoint;
	}
	// @ts-expect-error Only the trusted server event producer can choose a notification recipient.
	void client.request({ op: "notification.publish", target, actorId: "forged" });
	return result.status.preferences;
}

export function browserOnly(endpoint: string, token: string, ref: AgentRef) {
	const options: ClientOptions = { endpoint, token };
	const client = createClient(options);
	const command: Command = {
		op: "send",
		target: ref,
		input: { requestId: "browser-identity", text: "approved input" },
	};
	const response: Promise<ClientResult> = client.request(command, { signal: new AbortController().signal });
	const decoded = decodeRequest({ version: 1, requestId: "rpc", command });
	// @ts-expect-error Remote callers cannot declare another caller/source/principal.
	client.request({ ...command, principal: "forged" });
	// @ts-expect-error No model credential or mutable host config in browser client options.
	createClient({ ...options, apiKey: "forged" });
	return { response, decoded, decodeResponse, RemoteError, fresh: client.reconnect() };
}
