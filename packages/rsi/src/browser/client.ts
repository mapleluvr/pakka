import { decodeValue, isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import type { WebInterfaceContext } from "@pakka/webui/ui";
import type { TicketClient, TicketPage, TicketReceipt, TicketView, TicketHistoryPage } from "../types.ts";
import type { TicketAction } from "../commands.ts";
import { resultSchema } from "./contract.ts";
export type {
	TicketView,
	TicketPage,
	TicketReceipt,
	TicketSummary,
	TicketState,
	TicketHandler,
} from "../types.ts";
export interface ActionValues {
	submit: TicketReceipt;
	edit: TicketReceipt;
	get: TicketView;
	observe: { readonly revision: string };
	history: TicketHistoryPage;
	list: TicketPage;
	lookup: TicketReceipt | null;
	capabilities: ReturnType<TicketClient["capabilities"]>;
	assign: TicketReceipt;
	report: TicketReceipt;
	dispatch: TicketReceipt;
	recover: TicketReceipt;
	refresh: TicketView;
}
export class TicketCallError extends Error {
	readonly status: string;
	constructor(status: string, message: string) {
		super(message);
		this.name = "TicketCallError";
		this.status = status;
	}
}
export function readTicketResult<K extends TicketAction>(action: K, raw: unknown): ActionValues[K] {
	const result = decodeValue(resultSchema(action), raw);
	if (!isRecord(result)) throw new TicketCallError("unknown", "Invalid ticket response");
	if (result.status !== "ok") throw new TicketCallError(String(result.status), String(result.message));
	// SAFETY: the per-action closed schema above validates the full value before this typed publication.
	return result.value as ActionValues[K];
}
export async function ticketCall<K extends TicketAction>(
	context: Pick<WebInterfaceContext, "call">,
	action: K,
	input: ExtensionJson = {},
	requestId?: string,
): Promise<ActionValues[K]> {
	const operation = await context.call(action, input, requestId ? { requestId } : undefined);
	if (operation.state !== "done")
		throw new TicketCallError("unknown", "Result unconfirmed. Check the original request.");
	return readTicketResult(action, operation.value);
}
