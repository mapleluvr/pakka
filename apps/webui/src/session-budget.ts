import { BudgetChangeRefusedError, type Runtime } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "@pakka/server/pocket";
import { matchesSessionBudgetReceipt, type WebUiCommand, type WebUiResult } from "@pakka/protocol/webui";
import { WebUiServiceRefusal } from "./service-refusal.ts";

type BudgetCommand = Extract<WebUiCommand, { op: `session-budget.${string}` }>;
/** Native Runtime owns policy, consumed reservations and receipts. The service authorizes and routes DTOs. */
export async function executeSessionBudget(
	options: {
		readonly people: PocketPeople;
		readonly actor: PocketAuthority;
		readonly runtimeFor: (sessionId: string) => Runtime;
		readonly check: () => void;
		readonly signal?: AbortSignal;
	},
	command: BudgetCommand,
): Promise<WebUiResult> {
	const check = () => {
		options.signal?.throwIfAborted();
		options.check();
		try {
			options.people.check(options.actor, "extensions.install");
		} catch {
			throw new WebUiServiceRefusal("FORBIDDEN");
		}
	};
	check();
	const actorId = options.people.current(options.actor).id;
	let runtime: Runtime;
	try {
		runtime = options.runtimeFor(command.sessionId);
	} catch {
		throw new WebUiServiceRefusal("UNSUPPORTED");
	}
	if (runtime.view().sessionId !== command.sessionId) throw new WebUiServiceRefusal("UNSUPPORTED");
	let result: WebUiResult;
	try {
		switch (command.op) {
			case "session-budget.read":
				result = {
					kind: "session-budget",
					sessionId: command.sessionId,
					policy: await runtime.budgetPolicy(check),
				};
				break;
			case "session-budget.history":
				result = {
					kind: "session-budget-history",
					sessionId: command.sessionId,
					page: await runtime.budgetHistory(
						{ limit: command.limit, beforeVersion: command.beforeVersion },
						check,
					),
				};
				break;
			case "session-budget.write":
				result = {
					kind: "session-budget-receipt",
					sessionId: command.sessionId,
					receipt: await runtime.changeBudget({ ...command.change, actorId }, check),
				};
				break;
			case "session-budget.lookup": {
				const receipt = await runtime.budgetReceipt(
					{ actorId, requestId: command.original.requestId },
					check,
				);
				if (receipt && !matchesSessionBudgetReceipt(receipt, command.original, actorId))
					throw new WebUiServiceRefusal("CONFLICT");
				result = { kind: "session-budget-operation", sessionId: command.sessionId, receipt };
				break;
			}
		}
		check();
	} catch (error) {
		// A post-commit authority/publication failure cannot prove that the write had no effect.
		if (command.op === "session-budget.write")
			throw new WebUiServiceRefusal(error instanceof BudgetChangeRefusedError ? error.code : "UNKNOWN");
		check();
		throw error;
	}
	return result;
}
