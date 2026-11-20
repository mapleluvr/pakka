import {
	PocketConfigurationRefused,
	type PocketAuthority,
	type PocketPeople,
	type PocketWorkspace,
} from "@pakka/server/pocket";
import type { WebUiCommand, WebUiResult } from "@pakka/protocol/webui";
import { WebUiServiceRefusal } from "./service-refusal.ts";

type ConfigurationCommand = Extract<WebUiCommand, { op: `conversation-configuration.${string}` }>;
export async function executeConversationConfiguration(
	options: {
		readonly people: PocketPeople;
		readonly actor: PocketAuthority;
		readonly workspace: PocketWorkspace;
		readonly check: () => void;
		readonly signal?: AbortSignal;
	},
	command: ConfigurationCommand,
): Promise<WebUiResult> {
	const check = () => {
		options.signal?.throwIfAborted();
		options.check();
	};
	check();
	const client = options.workspace.bind(options.actor);
	try {
		let result: WebUiResult;
		if (command.op === "conversation-configuration.read")
			result = {
				kind: "conversation-configuration",
				view: await client.configurationOptions(command.target),
			};
		else if (command.op === "conversation-configuration.write")
			result = {
				kind: "conversation-configuration-receipt",
				receipt: await client.changeConfiguration(command.change, check),
			};
		else
			result = {
				kind: "conversation-configuration-operation",
				actorId: options.people.current(options.actor).id,
				original: command.original,
				receipt: await client.configurationReceipt(command.original, check),
			};
		check();
		return result;
	} catch (error) {
		if (error instanceof PocketConfigurationRefused) throw new WebUiServiceRefusal(error.code);
		if (command.op === "conversation-configuration.write") throw new WebUiServiceRefusal("UNKNOWN");
		check();
		throw error;
	}
}
