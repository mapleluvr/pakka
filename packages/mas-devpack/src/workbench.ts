import type {
	ConversationRef,
	DeliveryReceipt,
	Runtime,
	ConversationConfigurationChange,
} from "@pakka/agent";
import { MasRequestDenied, type Mas, type Member, type SendSpec } from "@pakka/mas";
import { projectActivity } from "./activity.ts";
import { masAgentPrincipal } from "./ownership.ts";
import type {
	WorkbenchActivity,
	WorkbenchHistoryPage,
	WorkbenchHistoryItem,
	WorkbenchHistoryQuery,
	WorkbenchMember,
	WorkbenchView,
} from "./browser/dto.ts";
export type {
	WorkbenchActivity,
	WorkbenchHistoryPage,
	WorkbenchHistoryQuery,
	WorkbenchMember,
	WorkbenchView,
} from "./browser/dto.ts";

/** Created only by the trusted human service binder. No wire token or copied object is an authority. */
export interface WorkbenchAuthority {
	readonly id: string;
	current(): void;
	check(permission: "read" | "send" | "steer" | "manage", target: ConversationRef): void;
}
export interface MasWorkbenchClient {
	canConfigure(ref: ConversationRef): boolean;
	configure(ref: ConversationRef, profile: string): Promise<WorkbenchMember>;
	configureAgent(ref: ConversationRef, change: ConversationConfigurationChange): Promise<WorkbenchMember>;
	view(): Promise<WorkbenchView>;
	history(query?: WorkbenchHistoryQuery): Promise<WorkbenchHistoryPage>;
	activities(refs: readonly ConversationRef[]): Promise<readonly WorkbenchActivity[]>;
	inspect(ref: ConversationRef): Promise<WorkbenchMember>;
	send(ref: ConversationRef, input: SendSpec): Promise<DeliveryReceipt>;
	inbox(ref: ConversationRef): Promise<readonly DeliveryReceipt[]>;
	reply(ref: ConversationRef, receiptId: string, input: SendSpec): Promise<DeliveryReceipt>;
	receipt(id: string, member?: ConversationRef): Promise<DeliveryReceipt>;
	wait(id: string, signal?: AbortSignal, member?: ConversationRef): Promise<DeliveryReceipt>;
	withdraw(id: string, member?: ConversationRef): Promise<DeliveryReceipt>;
	abort(ref: ConversationRef): Promise<WorkbenchMember>;
	retire(ref: ConversationRef): Promise<WorkbenchMember>;
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function same(a: ConversationRef, b: ConversationRef) {
	return ["key", "sessionId", "conversationId", "incarnation", "profile"].every(
		(key) => a[key as keyof ConversationRef] === b[key as keyof ConversationRef],
	);
}
function denied(): never {
	throw new MasRequestDenied("Human MAS authority denied");
}

/** Pure controlled-service composition. This module neither starts a Web server nor installs model tools. */
export function createMasWorkbench(options: { readonly mas: Mas; readonly runtime: Runtime }) {
	const { mas, runtime } = options;
	return Object.freeze({
		bind(authority: WorkbenchAuthority): MasWorkbenchClient {
			const id = authority.id;
			if (
				typeof id !== "string" ||
				!/^[a-zA-Z0-9][-a-zA-Z0-9._:]{0,127}$/.test(id) ||
				typeof authority.check !== "function"
			)
				return denied();
			const current = () => {
				authority.current();
				if (runtime.view().phase !== "ready") throw new Error("MAS Session unavailable");
			};
			const check = (permission: Parameters<WorkbenchAuthority["check"]>[0], ref: ConversationRef) => {
				current();
				authority.check(permission, ref);
			};
			const visible = (ref: ConversationRef) => {
				try {
					check("read", ref);
					return true;
				} catch {
					return false;
				}
			};
			const rootOwned = (member: Member, members: readonly Member[]): boolean => {
				const parents = new Map(members.map((row) => [masAgentPrincipal(row.ref), row])),
					visited = new Set<string>();
				let current = member;
				while (current.owner !== id) {
					if (visited.has(current.key)) return false;
					visited.add(current.key);
					const parent = parents.get(current.owner);
					if (!parent || !visible(parent.ref)) return false;
					current = parent;
				}
				return true;
			};
			const all = () => mas.connect({ principal: id, source: null, grants: ["discover"] }).discover();
			const authorizeOwner = (ref: ConversationRef) => {
				check("manage", ref);
				const members = all(),
					member = members.find((row) => same(row.ref, ref));
				if (!member || !rootOwned(member, members)) return denied();
				return member;
			};
			const resourceSame = (a: ConversationRef, b: ConversationRef) =>
				a.sessionId === b.sessionId && a.conversationId === b.conversationId;
			const rawClient = mas
				.connect({
					principal: id,
					source: null,
					grants: ["send", "steer", "observe"],
					initiator: { kind: "human", id },
				})
				.withAuthority(current);
			const project = (member: Member, members: readonly Member[]): WorkbenchMember => {
				check("read", member.ref);
				const parent = members.find((row) => masAgentPrincipal(row.ref) === member.owner),
					creationSource = member.creation?.source,
					creator =
						creationSource && members.some((row) => resourceSame(row.ref, creationSource) && visible(row.ref))
							? (members.find((row) => resourceSame(row.ref, creationSource))?.key ?? null)
							: null,
					creationKnown = !!member.creation && (!creationSource || creator !== null),
					forkSource =
						member.creation?.fork &&
						members.some((row) => resourceSame(row.ref, member.creation!.fork!.source) && visible(row.ref))
							? (members.find((row) => resourceSame(row.ref, member.creation!.fork!.source))?.key ?? null)
							: null,
					permissions: ("send" | "steer" | "manage")[] = [];
				for (const permission of ["send", "steer", "manage"] as const) {
					try {
						if (permission === "manage") authorizeOwner(member.ref);
						else check(permission, member.ref);
						permissions.push(permission);
					} catch {
						/* Only explicitly checked operations are advertised. */
					}
				}
				return freeze({
					key: member.key,
					ref: member.ref,
					owner: member.owner === id ? id : parent && visible(parent.ref) ? member.owner : null,
					parent: parent && visible(parent.ref) ? parent.key : null,
					creator,
					creationKnown,
					...(creationKnown && member.creation ? { createdAt: member.creation.at } : {}),
					forkSource,
					lifetime: member.lifetime,
					phase: member.phase,
					...(member.reason ? { reason: member.reason } : {}),
					permissions,
				});
			};
			const observeHistory = async (query: WorkbenchHistoryQuery = {}) => {
				current();
				const members = await allVisible();
				const byKey = new Map(members.map((row) => [row.key, row])),
					byResource = new Map(
						members.map((row) => [JSON.stringify([row.ref.sessionId, row.ref.conversationId]), row.key]),
					),
					memberKey = (ref: ConversationRef) =>
						byResource.get(JSON.stringify([ref.sessionId, ref.conversationId])),
					search = query.search?.trim().toLocaleLowerCase();
				if ((search?.length ?? 0) > 160) throw new Error("History search is outside the allowed range");
				if (query.member && !byKey.has(query.member)) return denied();
				if (query.from && !byKey.has(query.from)) return denied();
				if (query.to && !byKey.has(query.to)) return denied();
				if (query.cursor) {
					const cursor = await mas.lookupReceipt(query.cursor, current);
					if (!cursor || !visible(cursor.target) || (cursor.source && !visible(cursor.source)))
						return denied();
				}
				const accepts = (spec: import("@pakka/agent").CatalogDeliverySpec) => {
					current();
					if (!visible(spec.target) || (spec.source && !visible(spec.source))) return false;
					const from = spec.source ? memberKey(spec.source) : undefined,
						to = memberKey(spec.target);
					if (!to || (spec.source && !from)) return false;
					if (query.member && from !== query.member && to !== query.member) return false;
					if (query.mode && spec.mode !== query.mode) return false;
					if (query.initiator && (spec.initiator?.kind ?? "unknown") !== query.initiator) return false;
					if (query.from && from !== query.from) return false;
					if (query.to && to !== query.to) return false;
					return !search || spec.text.toLocaleLowerCase().includes(search);
				};
				const limit = query.limit ?? 32;
				if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new Error("Invalid history limit");
				let cursor = query.cursor;
				const collected: import("@pakka/agent").CatalogDeliveryObservation[] = [];
				do {
					const page = await mas.history({ limit: 64, ...(cursor ? { cursor } : {}) }, current, accepts);
					for (const item of page.items) {
						if (!query.status || item.receipt.status === query.status) collected.push(item);
						if (collected.length > limit) break;
					}
					if (collected.length > limit || !page.nextCursor) break;
					if (page.nextCursor === cursor) throw new Error("History cursor did not advance");
					cursor = page.nextCursor;
				} while (true);
				current();
				const selectedItems = collected.slice(0, limit);
				const items = selectedItems.map((item) => {
					const source = item.receipt.source,
						from = source ? memberKey(source) : null,
						to = memberKey(item.receipt.target);
					check("read", item.receipt.target);
					if (source) check("read", source);
					if (!to || (source && !from)) return denied();
					return freeze({
						receipt: {
							id: item.receipt.id,
							status: item.receipt.status,
							...(item.receipt.entryId ? { entryId: item.receipt.entryId } : {}),
						},
						from: from ?? null,
						to,
						text: item.text,
						mode: item.mode,
						at: item.at ?? null,
						initiator: (item.initiator?.kind ?? "unknown") as WorkbenchHistoryItem["initiator"],
						replyTo: item.replyTo ?? null,
					});
				});
				return freeze({
					items,
					...(collected.length > limit ? { nextCursor: selectedItems.at(-1)!.receipt.id } : {}),
				});
			};
			const allVisible = async () => {
				current();
				const snapshot = await mas.view();
				current();
				const accepted: WorkbenchMember[] = [];
				for (const row of snapshot.members) {
					if (!visible(row.ref)) continue;
					accepted.push(await inspect(row.ref));
				}
				current();
				for (const row of accepted) check("read", row.ref);
				return accepted;
			};
			const activityFor = async (ref: ConversationRef): Promise<WorkbenchActivity> => {
				const saved = structuredClone(ref);
				check("read", saved);
				const member = await rawClient.inspect(saved);
				check("read", saved);
				const snapshot = await runtime.readConversation(saved, () => check("read", saved));
				check("read", saved);
				const readiness =
					member.phase === "failed"
						? { phase: "failed" as const, ...(member.reason ? { reason: member.reason } : {}) }
						: member.phase === "ended" || member.phase === "retired"
							? { phase: "ended" as const }
							: { phase: "ready" as const };
				return freeze({ ref: snapshot.ref, ...projectActivity(snapshot, readiness) });
			};
			const observeActivities = async (refs: readonly ConversationRef[]) => {
				current();
				if (!Array.isArray(refs) || refs.length > 128)
					throw new Error("Activity batch is outside the allowed range");
				const result = await Promise.all(refs.map((ref) => activityFor(ref)));
				current();
				for (const ref of refs) check("read", ref);
				return freeze(result);
			};
			const inspect = async (ref: ConversationRef): Promise<WorkbenchMember> => {
				const saved = structuredClone(ref);
				check("read", saved);
				const member = await rawClient.inspect(saved);
				check("read", saved);
				return project(member, all());
			};
			const memberClient = (ref: ConversationRef) => {
				const saved = structuredClone(ref);
				check("send", saved);
				return mas
					.connect({
						principal: masAgentPrincipal(saved),
						source: saved,
						grants: ["reply", "observe", "steer"],
						initiator: { kind: "human", id },
					})
					.withAuthority(() => check("send", saved));
			};
			const readReceipt = async (receiptId: string, member?: ConversationRef) => {
				current();
				let client = rawClient,
					value: DeliveryReceipt;
				try {
					value = await client.receipt(receiptId);
				} catch (error) {
					if (!(error instanceof MasRequestDenied) || !member) throw error;
					client = memberClient(member);
					value = await client.receipt(receiptId);
				}
				check("read", value.target);
				if (value.source) check("read", value.source);
				return { value, client };
			};
			const receipt = async (receiptId: string, member?: ConversationRef) =>
				(await readReceipt(receiptId, member)).value;
			const manage = async (ref: ConversationRef, action: "abort" | "retire") => {
				const saved = structuredClone(ref);
				check("manage", saved);
				await mas.view();
				const owner = authorizeOwner(saved);
				const client = mas
					.connect({ principal: owner.owner, source: null, grants: [action] })
					.withAuthority(() => {
						authorizeOwner(saved);
					});
				await client[action](saved);
				check("manage", saved);
				return inspect(saved);
			};
			return Object.freeze({
				canConfigure(ref: ConversationRef) {
					try {
						authorizeOwner(ref);
						return true;
					} catch {
						return false;
					}
				},
				configure: async (ref: ConversationRef, profile: string) => {
					const owned = authorizeOwner(ref);
					const client = mas
						.connect({ principal: owned.owner, source: null, grants: ["configure"] })
						.withAuthority(() => authorizeOwner(ref));
					return project(await client.configure(ref, profile), all());
				},
				configureAgent: async (ref: ConversationRef, change: ConversationConfigurationChange) => {
					const owned = authorizeOwner(ref);
					const client = mas
						.connect({ principal: owned.owner, source: null, grants: ["configure"] })
						.withAuthority(() => authorizeOwner(ref));
					return project(await client.configureAgent(ref, change), all());
				},
				view: async () => {
					current();
					const allAccepted = await allVisible(),
						accepted = allAccepted.slice(0, 128),
						byKey = new Map(accepted.map((row) => [row.key, row]));
					const connections = new Map<
						string,
						{ kind: "creation" | "communication"; from: string; to: string; count: number; at?: number }
					>();
					for (const member of accepted) {
						if (!member.creationKnown || !member.creator) continue;
						const id = `creation:${member.creator}:${member.key}`;
						connections.set(id, {
							kind: "creation",
							from: member.creator,
							to: member.key,
							count: 1,
							...(member.createdAt ? { at: member.createdAt } : {}),
						});
					}
					let cursor: string | undefined,
						pages = 0,
						connectionsTruncated = allAccepted.length > accepted.length;
					while (pages < 64) {
						const page = await observeHistory({ limit: 64, ...(cursor ? { cursor } : {}) });
						for (const row of page.items) {
							if (!row.from || !byKey.has(row.from) || !byKey.has(row.to)) continue;
							const id = `communication:${row.from}:${row.to}`,
								existing = connections.get(id);
							connections.set(id, {
								kind: "communication",
								from: row.from,
								to: row.to,
								count: (existing?.count ?? 0) + 1,
								...(row.at !== null
									? { at: Math.max(existing?.at ?? 0, row.at) }
									: existing?.at
										? { at: existing.at }
										: {}),
							});
						}
						pages++;
						if (!page.nextCursor) {
							cursor = undefined;
							break;
						}
						cursor = page.nextCursor;
					}
					if (cursor) connectionsTruncated = true;
					const namespace = (await mas.view()).namespace;
					current();
					for (const row of accepted) check("read", row.ref);
					return freeze({
						sessionId: runtime.view().sessionId,
						namespace,
						members: accepted,
						connections: [...connections].slice(0, 512).map(([id, connection]) => ({ id, ...connection })),
						connectionsTruncated: connectionsTruncated || connections.size > 512,
					});
				},
				history: observeHistory,
				activities: observeActivities,
				inspect,
				send: async (ref: ConversationRef, input: SendSpec) => {
					const saved = structuredClone(ref),
						data = structuredClone(input),
						permission = data.mode === undefined || data.mode === "prompt" ? "send" : "steer";
					check(permission, saved);
					const client = rawClient.withAuthority(() => check(permission, saved));
					const value = await client.send(saved, data);
					check(permission, saved);
					return value;
				},
				inbox: async (ref: ConversationRef) => {
					const saved = structuredClone(ref),
						client = memberClient(saved);
					const incoming = (await client.inbox()).filter(
						(value) => value.source && same(value.target, saved) && visible(value.source),
					);
					check("send", saved);
					for (const value of incoming) {
						check("read", value.target);
						if (value.source) check("read", value.source);
					}
					return freeze(incoming);
				},
				reply: async (ref: ConversationRef, receiptId: string, input: SendSpec) => {
					const saved = structuredClone(ref),
						data = structuredClone(input),
						client = memberClient(saved);
					const original = await client.receipt(receiptId);
					if (!same(original.target, saved) || !original.source) return denied();
					const peer = original.source,
						permission = data.mode === undefined || data.mode === "prompt" ? "send" : "steer";
					const recheck = () => {
						check(permission, saved);
						check(permission, peer);
					};
					recheck();
					const value = await client.withAuthority(recheck).reply(receiptId, data);
					recheck();
					return value;
				},
				receipt,
				wait: async (receiptId: string, signal?: AbortSignal, member?: ConversationRef) => {
					const { value: before, client } = await readReceipt(receiptId, member);
					const recheck = () => {
						check("read", before.target);
						if (before.source) check("read", before.source);
					};
					const value = await client.withAuthority(recheck).wait(receiptId, signal);
					recheck();
					return value;
				},
				withdraw: async (receiptId: string, member?: ConversationRef) => {
					const { value: before, client } = await readReceipt(receiptId, member);
					const recheck = () => {
						check("send", before.target);
						if (before.source) check("send", before.source);
					};
					recheck();
					const value = await client.withAuthority(recheck).withdraw(receiptId);
					recheck();
					return value;
				},
				abort: (ref: ConversationRef) => manage(ref, "abort"),
				retire: (ref: ConversationRef) => manage(ref, "retire"),
			});
		},
	});
}
