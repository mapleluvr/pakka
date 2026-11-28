import { PocketPeopleChangeRefused, type PocketAuthority, type PocketPeople } from "@pakka/server/pocket";
import type { WebUiCommand, WebUiResult } from "@pakka/protocol/webui";
import { WebUiServiceRefusal } from "./service-refusal.ts";

type PeopleCommand = Extract<WebUiCommand, { op: `people.${string}` }>;
export async function executePeople(
	options: {
		readonly people: PocketPeople;
		readonly actor: PocketAuthority;
		readonly check: () => void;
		readonly signal?: AbortSignal;
	},
	command: PeopleCommand,
): Promise<WebUiResult> {
	const { people, actor } = options;
	const check = () => {
		options.signal?.throwIfAborted();
		options.check();
		try {
			if (command.op === "people.settings") people.current(actor);
			else people.check(actor, "invite");
		} catch {
			throw new WebUiServiceRefusal("FORBIDDEN");
		}
	};
	check();
	const actorId = people.current(actor).id;
	try {
		let result: WebUiResult;
		switch (command.op) {
			case "people.settings":
				result = { kind: "people-settings", settings: await people.settings(actor) };
				break;
			case "people.invite.lookup":
				result = {
					kind: "people-invitation",
					issuerId: actorId,
					requestId: command.original.requestId,
					invite: await people.lookupInvite(actor, command.original),
				};
				break;
			case "people.lookup":
				result = {
					kind: "people-operation",
					actorId,
					requestId: command.original.requestId,
					receipt: await people.lookupChange(actor, command.original),
				};
				break;
			case "people.write":
				result = {
					kind: "people-receipt",
					receipt: await people.change(actor, command.change, check),
				};
				break;
		}
		check();
		return result;
	} catch (error) {
		if (error instanceof PocketPeopleChangeRefused) throw new WebUiServiceRefusal(error.code);
		if (command.op === "people.write") throw new WebUiServiceRefusal("UNKNOWN");
		check();
		throw error;
	}
}
