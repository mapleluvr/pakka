import type { ConversationRef, DeliveryReceipt, Runtime } from "@pakka/agent";
import type { Mas } from "@pakka/mas";
import type { PocketConversationSource, PocketInputReceipt, PocketPeople } from "@pakka/server/pocket";
import type { createMasWorkbench } from "./workbench.ts";

/** Trusted composition port; public UI never receives these command closures. */
export function masConversations(options: {
	runtime: Runtime;
	mas: Mas;
	people: PocketPeople;
	board: ReturnType<typeof createMasWorkbench>;
}): PocketConversationSource {
	return Object.freeze<PocketConversationSource>({
		bind(actor) {
			const current = () => {
				options.people.current(actor);
			};
			const client = (guard: () => void = () => {}) =>
				options.board.bind({
					id: options.people.current(actor).id,
					current() {
						current();
						guard();
					},
					check(permission, ref) {
						current();
						guard();
						options.people.check(actor, permission, ref.conversationId);
					},
				});
			const inputReceipt = (value: DeliveryReceipt): PocketInputReceipt => {
				const person = options.people.current(actor);
				options.people.check(actor, "read", value.target.conversationId);
				if (value.source !== null || value.principal !== person.id) throw Error("MAS input authority denied");
				return Object.freeze({
					id: value.id,
					requestId: value.requestId,
					actorId: person.id,
					target: value.target,
					status: value.status,
					...(value.entryId ? { entryId: value.entryId } : {}),
				});
			};
			return Object.freeze<ReturnType<PocketConversationSource["bind"]>>({
				async navigation() {
					const view = await client().view();
					current();
					return view.members.map((row) =>
						Object.freeze({
							ref: row.ref,
							name: row.key,
							version: 0,
							archived: false,
							metadataEditable: false,
						}),
					);
				},
				canManage(ref: ConversationRef) {
					return client().canConfigure(ref);
				},
				async ownsReceipt(id: string) {
					const value = await options.mas.lookupReceipt(id, current);
					return !!value && value.source === null && value.principal === options.people.current(actor).id;
				},
				async configure(ref, profile, guard) {
					return (await client(guard).configure(ref, profile)).ref;
				},
				async configureAgent(ref, change, guard) {
					return (await client(guard).configureAgent(ref, change)).ref;
				},
				async submit(ref, input, guard) {
					return inputReceipt(await client(guard).send(ref, input));
				},
				async receipt(id) {
					return inputReceipt(await client().receipt(id));
				},
				async wait(id, signal) {
					return inputReceipt(await client().wait(id, signal));
				},
				async withdraw(id) {
					return inputReceipt(await client().withdraw(id));
				},
				async abort(ref, guard) {
					await client(guard).abort(ref);
				},
			});
		},
	});
}
