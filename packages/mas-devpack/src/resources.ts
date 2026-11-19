import type { ConversationRef, DeliveryReceipt, Runtime, CatalogConfigurationReceipt } from "@pakka/agent";
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
					...(value.reason === undefined ? {} : { reason: value.reason }),
				});
			};
			const configurationReceipt = (value: CatalogConfigurationReceipt | null) => {
				current();
				if (!value) return null;
				const { principal, ...original } = value.original;
				if (principal !== options.people.current(actor).id) throw Error("MAS configuration authority denied");
				return Object.freeze({ actorId: principal, original, ref: value.ref, at: value.at });
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
				async changeConfiguration(input, guard) {
					const original = structuredClone(input),
						bound = client(guard);
					if (original.selection.kind === "profile")
						await bound.configure(original.target, original.selection.profile, original.requestId);
					else await bound.configureAgent(original.target, original.selection.change, original.requestId);
					const receipt = configurationReceipt(await bound.configurationReceipt(original));
					if (!receipt) throw Error("MAS configuration receipt not confirmed");
					return receipt;
				},
				async configurationReceipt(original, guard) {
					return configurationReceipt(await client(guard).configurationReceipt(original));
				},
				async submit(ref, input, guard) {
					return inputReceipt(await client(guard).send(ref, input));
				},
				async inputReceipt(ref, input, guard) {
					const saved = structuredClone(ref),
						original = structuredClone(input);
					const authorize = () => {
						current();
						guard();
						options.people.check(actor, "read", saved.conversationId);
					};
					authorize();
					const value = await options.mas
						.connect({
							principal: options.people.current(actor).id,
							source: null,
							grants: ["send"],
						})
						.withAuthority(authorize)
						.lookup(saved, original);
					authorize();
					return value === null ? null : inputReceipt(value);
				},
				async inputHistory(ref, cursor, guard) {
					const saved = structuredClone(ref),
						personId = options.people.current(actor).id;
					const authorize = () => {
						current();
						guard();
						options.people.check(actor, "read", saved.conversationId);
					};
					authorize();
					await client(authorize).inspect(saved);
					const page = await options.mas.history(
						{ limit: 16, ...(cursor ? { cursor } : {}) },
						authorize,
						(spec) =>
							spec.principal === personId &&
							spec.source === null &&
							spec.target.sessionId === saved.sessionId &&
							spec.target.conversationId === saved.conversationId,
					);
					authorize();
					return Object.freeze({
						items: Object.freeze(
							page.items.map((item) =>
								Object.freeze({
									receipt: inputReceipt(item.receipt),
									mode: item.mode,
									preview: item.text.slice(0, 1024),
									truncated: item.text.length > 1024,
								}),
							),
						),
						...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
					});
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
