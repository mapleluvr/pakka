import type { ExtensionManifest } from "@pakka/protocol/extensions";
import type { TicketAction } from "./commands.ts";
import { inputs, resultSchema, writeActions } from "./browser/contract.ts";
export const manifest: ExtensionManifest = {
	api: 1,
	id: "rsi",
	version: "0.1.0",
	title: "Tickets",
	facets: { backend: "backend.js", client: "client.js", webui: { entry: "index.js", publicDir: "public" } },
	services: ["tickets"],
	actions: (Object.keys(inputs) as TicketAction[]).map((id) => ({
		id,
		version: 1,
		scope: "app",
		permission: "read",
		effect:
			id === "dispatch" || id === "recover"
				? "model"
				: writeActions.includes(id) || id === "refresh"
					? "write"
					: "read",
		timeoutMs: 10000,
		input: inputs[id],
		output: resultSchema(id),
	})),
	commands: [{ id: "tickets", title: "Open tickets", slash: "tickets", interface: "tickets" }],
	interfaces: [
		{ id: "tickets", title: "Tickets", slot: "page", scope: "app", export: "Tickets", navigation: true },
	],
};
