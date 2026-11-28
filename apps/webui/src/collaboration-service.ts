import {
	PocketCollaborationRefusal,
	type PocketAuthority,
	type PocketPeople,
	type PocketPermission,
	type PocketCollaboration,
} from "@pakka/server/pocket";
import type { WebUiCommand, WebUiResult } from "@pakka/protocol/webui";
import { WebUiServiceRefusal } from "./service-refusal.ts";

type Command = Extract<
	WebUiCommand,
	{ readonly op: "collaboration.read" | "collaboration.write" | "collaboration.lookup" }
>;

/** Collaboration owns effects and receipts. The product supplies current HTTP/Person authority. */
export async function executeCollaboration(
	options: {
		readonly actor: PocketAuthority;
		readonly people: PocketPeople;
		readonly collaboration?: PocketCollaboration;
		readonly signal?: AbortSignal;
		readonly check: () => void;
	},
	command: Command,
): Promise<WebUiResult> {
	const { actor, people, collaboration, signal } = options;
	if (!collaboration) throw new WebUiServiceRefusal("UNSUPPORTED");
	const target =
		command.op === "collaboration.read"
			? command.target
			: command.op === "collaboration.write"
				? command.change.target
				: command.original.target;
	const resourceId = people.resourceId(target);
	const authorize = (permission: PocketPermission = "read") => {
		signal?.throwIfAborted();
		options.check();
		if (command.op !== "collaboration.lookup" && people.mode().personal)
			throw new WebUiServiceRefusal("FORBIDDEN");
		try {
			people.check(actor, permission, resourceId);
		} catch {
			throw new WebUiServiceRefusal("FORBIDDEN");
		}
	};
	authorize();
	const client = collaboration.bind(actor);
	if (command.op === "collaboration.read") {
		const snapshot = await client.snapshot(target);
		authorize();
		const can = (permission: PocketPermission) => {
			try {
				people.check(actor, permission, resourceId);
				return true;
			} catch {
				return false;
			}
		};
		return {
			kind: "collaboration",
			view: {
				target,
				snapshot,
				canEditNote: false,
				canPin: can("send"),
				canControl: can("steer"),
				canTake: can("manage"),
			},
		};
	}
	if (command.op === "collaboration.lookup") {
		try {
			const receipt = await client.lookup(command.original);
			authorize();
			return {
				kind: "collaboration-operation",
				actorId: people.current(actor).id,
				original: command.original,
				receipt,
			};
		} catch (error) {
			if (error instanceof PocketCollaborationRefusal) throw new WebUiServiceRefusal(error.code);
			throw error;
		}
	}
	const action = command.change.action;
	authorize(
		action.kind === "driver"
			? action.action === "take"
				? "manage"
				: "steer"
			: action.kind === "note" || action.kind === "pin"
				? "send"
				: "read",
	);
	try {
		const receipt = await client.write(command.change);
		// A refusal here cannot undo an already committed effect/receipt.
		try {
			authorize();
		} catch {
			throw new WebUiServiceRefusal("UNKNOWN");
		}
		return { kind: "collaboration-receipt", receipt };
	} catch (error) {
		if (error instanceof PocketCollaborationRefusal) throw new WebUiServiceRefusal(error.code);
		if (error instanceof WebUiServiceRefusal && error.code === "UNKNOWN") throw error;
		throw new WebUiServiceRefusal("UNKNOWN");
	}
}
