import { fileURLToPath } from "node:url";
import type { BackendModule, ExtensionService, PocketServiceContext } from "@pakka/webui/backend";
import { decodeValue, isRecord } from "@pakka/webui/extension";
import type { TicketClient, TicketRole, TicketService } from "./types.ts";
import { executeTicketAction, ticketFailure, type TicketAction } from "./commands.ts";
import { inputs, resultSchema, writeActions } from "./browser/contract.ts";

export const rsiExtensionRoot = fileURLToPath(new URL(".", import.meta.url));
export function ticketExtensionService(
	context: PocketServiceContext,
	service: TicketService,
	options: {
		readonly roleForPerson?: (
			person: ReturnType<PocketServiceContext["people"]["current"]>,
		) => TicketRole | null;
	} = {},
): ExtensionService<TicketClient> {
	return Object.freeze({
		permission: "read" as const,
		bind(actor, target, check) {
			if (target) throw new Error("Tickets use an app-scoped service");
			const person = context.people.current(actor);
			return service.connect({
				id: "person:" + person.id,
				role: () => {
					const current = context.people.current(actor);
					return options.roleForPerson
						? options.roleForPerson(current)
						: current.role === "admin" && current.resources === "*"
							? "manager"
							: current.role === "viewer"
								? "reader"
								: "submitter";
				},
				check: () => {
					check();
					context.people.current(actor);
				},
			});
		},
	} satisfies ExtensionService<TicketClient>);
}
const actionNames = Object.keys(inputs) as TicketAction[];
export const actions: BackendModule["actions"] = Object.fromEntries(
	actionNames.map((action) => [
		action,
		async (context, raw) => {
			context.check();
			const input = decodeValue(inputs[action], raw);
			if (!isRecord(input)) throw new Error("Ticket action requires an object");
			try {
				const client = context.service<TicketClient>("tickets");
				const value = await executeTicketAction(
					client,
					action,
					writeActions.includes(action) ? { ...input, requestId: context.requestId } : input,
				);
				context.check();
				return decodeValue(resultSchema(action), { status: "ok", value });
			} catch (error) {
				context.check();
				return decodeValue(resultSchema(action), ticketFailure(error));
			}
		},
	]),
);
