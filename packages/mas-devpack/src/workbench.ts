import type { ConversationRef, DeliveryReceipt, Runtime } from "@pakka/agent";
import { MasRequestDenied, type Mas, type Member, type SendSpec } from "@pakka/mas";
import { masAgentPrincipal } from "./ownership.ts";
import type { WorkbenchMember, WorkbenchView } from "./browser/dto.ts";
export type { WorkbenchMember, WorkbenchView } from "./browser/dto.ts";

/** Created only by the trusted human service binder. No wire token or copied object is an authority. */
export interface WorkbenchAuthority {
	readonly id: string;
	current(): void;
	check(permission: "read" | "send" | "steer" | "manage", target: ConversationRef): void;
}
export interface MasWorkbenchClient {
	view(): Promise<WorkbenchView>;
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
			const rawClient = mas
				.connect({ principal: id, source: null, grants: ["send", "steer", "observe"] })
				.withAuthority(current);
			const project = (member: Member, members: readonly Member[]): WorkbenchMember => {
				check("read", member.ref);
				const parent = members.find((row) => masAgentPrincipal(row.ref) === member.owner),
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
					lifetime: member.lifetime,
					phase: member.phase,
					...(member.reason ? { reason: member.reason } : {}),
					permissions,
				});
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
				view: async () => {
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
					return freeze({ namespace: snapshot.namespace, members: accepted });
				},
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
