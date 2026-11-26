import type { AgentRef as ConversationRef, MasClient } from "@pakka/mas";
import type { Runtime } from "@pakka/agent";
import type { TicketClient } from "./types.ts";
import { createReportNotifier } from "./report-notifier.ts";
export type { ReportNotification, ReportNotificationInput } from "./report-notifier.ts";
import { TicketError, type TicketDispatcher, type TicketRoute } from "./types.ts";
import { frozen, identity } from "./validation.ts";

export interface MasTicketRoute {
	readonly handlerId: string;
	readonly target: ConversationRef;
	readonly client: MasClient;
}
/** Explicit trusted routes. The adapter never creates a member or grants MAS authority. */
export function createMasTicketDispatcher(options: {
	readonly routes: readonly MasTicketRoute[];
}): TicketDispatcher {
	const routes = options.routes.map((row) => {
		identity(row.handlerId);
		return { handlerId: row.handlerId, target: frozen(structuredClone(row.target)), client: row.client };
	});
	if (routes.length > 64 || new Set(routes.map((r) => r.handlerId)).size !== routes.length)
		throw new TicketError("invalid", "Invalid ticket routes");
	const plan = (handlerId: string): TicketRoute => {
		const row = routes.find((r) => r.handlerId === handlerId);
		if (!row) throw new TicketError("invalid", "No approved route for this handler");
		row.client.authorize("send");
		return frozen({
			handlerId,
			target: row.target,
			principal: row.client.identity.principal,
			source: row.client.identity.source,
		});
	};
	const resolve = (address: TicketRoute) => {
		const row = routes.find((r) => r.handlerId === address.handlerId);
		const same = (left: ConversationRef | null, right: ConversationRef | null) =>
			left === null || right === null
				? left === right
				: ["key", "sessionId", "conversationId", "incarnation", "profile"].every(
						(key) => left[key as keyof ConversationRef] === right[key as keyof ConversationRef],
					);
		if (
			!row ||
			!same(row.target, address.target) ||
			!same(row.client.identity.source, address.source) ||
			row.client.identity.principal !== address.principal
		)
			throw new TicketError("denied", "The original MAS route is no longer available");
		return row.client;
	};
	const validate: TicketDispatcher["validate"] = (address, input) => {
		identity(input.requestId);
		if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 65536)
			throw new TicketError("capacity", "Serialized ticket dispatch exceeds MAS input capacity");
		resolve(address).authorize("send");
	};
	return Object.freeze({
		plan,
		validate,
		async send(address, input, check) {
			check();
			validate(address, input);
			const receipt = await resolve(address).withAuthority(check).send(address.target, input);
			check();
			return frozen({ id: receipt.id, state: receipt.status });
		},
		async lookup(address, input, check) {
			check();
			const receipt = await resolve(address).withAuthority(check).lookup(address.target, input);
			check();
			return receipt ? frozen({ id: receipt.id, state: receipt.status }) : null;
		},
		async observe(address, receiptId, check) {
			check();
			const receipt = await resolve(address).withAuthority(check).receipt(receiptId);
			check();
			return frozen({ id: receipt.id, state: receipt.status });
		},
	} satisfies TicketDispatcher);
}

/** Passive outbox construction. notify() explicitly sends an already-saved report reference. */
export function createMasReportNotifier(options: {
	readonly runtime: Runtime;
	readonly namespace: string;
	readonly tickets: TicketClient;
	readonly routes: readonly MasTicketRoute[];
	readonly check: () => void;
}) {
	return createReportNotifier({
		...options,
		dispatcher: createMasTicketDispatcher({ routes: options.routes }),
	});
}
