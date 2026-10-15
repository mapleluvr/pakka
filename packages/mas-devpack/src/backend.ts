import { fileURLToPath } from "node:url";
import type { Mas } from "@pakka/mas";
import type {
	BackendContext,
	BackendModule,
	ExtensionService,
	PocketServiceContext,
} from "@pakka/webui/backend";
import { decodeValue, isRecord } from "@pakka/webui/extension";
import { createMasWorkbench, type MasWorkbenchClient } from "./workbench.ts";
import { inboxSchema, memberSchema, receiptSchema, viewSchema } from "./browser/contract.ts";

/** Optional trusted facet root. The default Agent entry does not import this module or WebUI. */
export const masExtensionRoot = fileURLToPath(new URL(".", import.meta.url));
export function masWorkbenchService(
	options: PocketServiceContext & { readonly mas: Mas },
): ExtensionService<MasWorkbenchClient> {
	const board = createMasWorkbench(options);
	return Object.freeze({
		permission: "read" as const,
		bind(
			actor: Parameters<ExtensionService["bind"]>[0],
			target: Parameters<ExtensionService["bind"]>[1],
			check: () => void,
		) {
			const id = options.people.current(actor).id;
			const bound = board.bind({
				id,
				current: () => {
					check();
					options.people.current(actor);
				},
				check(permission, ref) {
					check();
					options.people.check(actor, permission, ref.conversationId);
				},
			});
			const selected = (ref: NonNullable<typeof target>) => {
				if (
					target &&
					["key", "sessionId", "conversationId", "incarnation", "profile"].some(
						(key) => ref[key as keyof typeof ref] !== target[key as keyof typeof target],
					)
				)
					throw new Error("Foreign action target");
			};
			const scoped: MasWorkbenchClient = {
				...bound,
				inspect: (ref) => {
					selected(ref);
					return bound.inspect(ref);
				},
				send: (ref, input) => {
					selected(ref);
					return bound.send(ref, input);
				},
				inbox: (ref) => {
					selected(ref);
					return bound.inbox(ref);
				},
				reply: (ref, id, input) => {
					selected(ref);
					return bound.reply(ref, id, input);
				},
				receipt: (id, member = target) => {
					if (member) selected(member);
					return bound.receipt(id, member);
				},
				wait: (id, signal, member = target) => {
					if (member) selected(member);
					return bound.wait(id, signal, member);
				},
				withdraw: (id, member = target) => {
					if (member) selected(member);
					return bound.withdraw(id, member);
				},
				abort: (ref) => {
					selected(ref);
					return bound.abort(ref);
				},
				retire: (ref) => {
					selected(ref);
					return bound.retire(ref);
				},
			};
			return Object.freeze(scoped);
		},
	});
}
function board(context: BackendContext) {
	return context.service<MasWorkbenchClient>("mas");
}
function target(context: BackendContext) {
	if (!context.target) throw new Error("Explicit member required");
	return context.target;
}
function string(input: unknown, key: string) {
	if (!isRecord(input) || typeof input[key] !== "string") throw new Error("Invalid MAS input");
	return input[key];
}
export const actions: BackendModule["actions"] = Object.freeze({
	view: async (context) => decodeValue(viewSchema, await board(context).view()),
	inspect: async (context) => decodeValue(memberSchema, await board(context).inspect(target(context))),
	send: async (context, input) =>
		decodeValue(
			receiptSchema,
			await board(context).send(target(context), {
				requestId: context.requestId,
				text: string(input, "text"),
			}),
		),
	steer: async (context, input) => {
		const mode = string(input, "mode");
		if (mode !== "steer" && mode !== "followUp") throw new Error("Invalid mode");
		return decodeValue(
			receiptSchema,
			await board(context).send(target(context), {
				requestId: context.requestId,
				text: string(input, "text"),
				mode,
			}),
		);
	},
	inbox: async (context) =>
		decodeValue(inboxSchema, (await board(context).inbox(target(context))).slice(-128)),
	reply: async (context, input) =>
		decodeValue(
			receiptSchema,
			await board(context).reply(target(context), string(input, "id"), {
				requestId: context.requestId,
				text: string(input, "text"),
			}),
		),
	receipt: async (context, input) =>
		decodeValue(receiptSchema, await board(context).receipt(string(input, "id"))),
	withdraw: async (context, input) =>
		decodeValue(receiptSchema, await board(context).withdraw(string(input, "id"))),
	abort: async (context) => decodeValue(memberSchema, await board(context).abort(target(context))),
	retire: async (context) => decodeValue(memberSchema, await board(context).retire(target(context))),
});
