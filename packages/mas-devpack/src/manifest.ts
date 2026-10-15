import type { ExtensionManifest, ExtensionAction } from "@pakka/webui/extension";
import {
	empty,
	inboxSchema,
	replyInput,
	memberSchema,
	receiptInput,
	receiptSchema,
	steerInput,
	textInput,
	viewSchema,
} from "./browser/contract.ts";
const action = (
	id: string,
	permission: ExtensionAction["permission"],
	effect: ExtensionAction["effect"],
	input: ExtensionAction["input"],
	output: ExtensionAction["output"],
	scope: ExtensionAction["scope"] = "conversation",
): ExtensionAction => ({ id, version: 1, scope, permission, effect, timeoutMs: 5000, input, output });
/** Inert source of the delivered manifest. It neither imports native services nor activates any facet. */
export const manifest: ExtensionManifest = {
	api: 1,
	id: "mas-devpack",
	version: "0.2.0",
	title: "MAS team",
	facets: {
		agent: "profiles.js",
		backend: "backend.js",
		client: "client.js",
		webui: { entry: "index.js", publicDir: "public" },
	},
	services: ["mas"],
	actions: [
		action("view", "read", "read", empty, viewSchema, "app"),
		action("inspect", "read", "read", empty, memberSchema),
		action("send", "send", "model", textInput, receiptSchema),
		action("steer", "steer", "model", steerInput, receiptSchema),
		action("inbox", "send", "read", empty, inboxSchema),
		action("reply", "send", "model", replyInput, receiptSchema),
		action("receipt", "read", "read", receiptInput, receiptSchema),
		action("withdraw", "send", "write", receiptInput, receiptSchema),
		action("abort", "manage", "write", empty, memberSchema),
		action("retire", "manage", "write", empty, memberSchema),
	],
	commands: [{ id: "team", title: "Open MAS team", slash: "team", interface: "board" }],
	interfaces: [
		{ id: "board", title: "MAS team", slot: "page", scope: "app", export: "Board", navigation: true },
		{
			id: "member",
			title: "MAS member",
			slot: "panel",
			scope: "conversation",
			export: "MemberPanel",
			navigation: false,
		},
	],
};
