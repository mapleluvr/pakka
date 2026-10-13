import type { ConversationRef, JsonObject, RuntimeStore } from "@pakka/agent";
import type { MasClient, SendSpec } from "./types.ts";
import type {
	BrokerOptions,
	BrokerAgentRef,
	BrokerReceipt,
	PlacementSpec,
	SessionPlacement,
	SessionEndpoint,
} from "./broker-types.ts";
import { createBroker } from "./broker.ts";
import { digest, immutable, record, validIdentity, agentRef } from "./broker-codec.ts";

/** Definitive refusal raised before this request reserves capacity or invokes an effectful endpoint. */
export class MasRequestDenied extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MasRequestDenied";
	}
}
export interface ApprovedSessionTemplate {
	readonly location: "existing-session" | "new-session";
	readonly principal: string;
	readonly source: ConversationRef;
	readonly targetKey: string;
	/** Host-fixed slot/plan and finite budgets. No part of this is accepted from tool JSON. */
	readonly broker: BrokerOptions;
	readonly plan: readonly PlacementSpec[];
}
export interface ApprovedSessionResult {
	readonly status: "created" | "unknown";
	readonly template: string;
	readonly ref?: BrokerAgentRef;
}
export interface ApprovedSessions {
	request(
		client: MasClient,
		input: {
			readonly template: string;
			readonly requestId: string;
			readonly location: "existing-session" | "new-session";
		},
	): Promise<ApprovedSessionResult>;
	send(client: MasClient, template: string, target: BrokerAgentRef, input: SendSpec): Promise<BrokerReceipt>;
	reply(client: MasClient, template: string, receiptId: string, input: SendSpec): Promise<BrokerReceipt>;
	inbox(client: MasClient, template: string): Promise<readonly BrokerReceipt[]>;
	wait(client: MasClient, template: string, receiptId: string): Promise<BrokerReceipt>;
}
function same(a: ConversationRef, b: ConversationRef) {
	return [a.key, a.sessionId, a.conversationId, a.incarnation, a.profile].every(
		(value, index) => value === [b.key, b.sessionId, b.conversationId, b.incarnation, b.profile][index],
	);
}
function guardStore(store: RuntimeStore, check: () => void): RuntimeStore {
	return Object.freeze({
		snapshot: () => {
			check();
			return store.snapshot();
		},
		compareAndSet: (version: number, data: JsonObject, authority: () => void) => {
			check();
			return store.compareAndSet(version, data, () => {
				check();
				authority();
			});
		},
	});
}
/** Bounded create-once template slots. Unknown startup never frees a slot or selects a replacement. */
export function createApprovedSessions(options: {
	readonly store: RuntimeStore;
	readonly templates: Readonly<Record<string, ApprovedSessionTemplate>>;
}): ApprovedSessions {
	const templates = new Map(Object.entries(options.templates));
	if (
		!templates.size ||
		[...templates].some(
			([id, t]) =>
				!validIdentity(id) ||
				!validIdentity(t.principal) ||
				!["existing-session", "new-session"].includes(t.location) ||
				!t.plan.some((p) => p.key === t.targetKey && p.owner === t.principal),
		)
	)
		throw new Error("Invalid approved Session templates");
	const configuration = digest(
		[...templates]
			.map(([id, t]) => [id, t.location, t.principal, t.source, t.targetKey, t.plan, t.broker.namespace])
			.sort(),
	);
	const store = options.store;
	type Claim = {
		requestId: string;
		fingerprint: string;
		status: "pending" | "created" | "unknown";
		ref?: BrokerAgentRef;
	};
	async function read() {
		const snapshot = await store.snapshot();
		if (Object.keys(snapshot.data).length === 0)
			return { version: snapshot.version, claims: {} as Record<string, Claim> };
		if (snapshot.data.configuration !== configuration)
			throw new Error("Session reservation configuration conflict");
		if (!record(snapshot.data.claims)) throw new Error("Invalid Session reservation table");
		const raw = snapshot.data.claims,
			claims: Record<string, Claim> = {};
		for (const [key, row] of Object.entries(raw)) {
			if (!record(row)) throw new Error("Invalid Session reservation record");
			if (
				!templates.has(key) ||
				typeof row.requestId !== "string" ||
				!validIdentity(row.requestId) ||
				typeof row.fingerprint !== "string" ||
				!["pending", "created", "unknown"].includes(String(row.status))
			)
				throw new Error("Invalid Session reservation");
			const status = row.status as Claim["status"];
			if (status === "created" && row.ref === undefined)
				throw new Error("Created Session receipt lacks identity");
			if (row.ref !== undefined && !agentRef(row.ref)) throw new Error("Invalid Session receipt reference");
			const ref = row.ref === undefined ? undefined : agentRef(row.ref) ? row.ref : undefined;
			claims[key] = {
				requestId: row.requestId,
				fingerprint: row.fingerprint,
				status,
				...(ref === undefined ? {} : { ref }),
			};
		}
		return { version: snapshot.version, claims };
	}
	// Serialize local writes, not provisioning. CAS still protects other service instances.
	let writes: Promise<unknown> = Promise.resolve();
	function change(check: () => void, apply: (claims: Record<string, Claim>) => void) {
		const next = writes.then(() => commitChange(check, apply));
		writes = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}
	async function commitChange(check: () => void, apply: (claims: Record<string, Claim>) => void) {
		for (let attempt = 0; attempt < 32; attempt++) {
			check();
			const current = await read();
			apply(current.claims);
			check();
			let data: JsonObject;
			try {
				data = JSON.parse(JSON.stringify({ configuration, claims: current.claims }));
			} catch (error) {
				throw new Error("Session reservation encoding failed", { cause: error });
			}
			try {
				return await store.compareAndSet(current.version, data, check);
			} catch (error) {
				if (!/CAS conflict/.test(String(error))) throw error;
			}
		}
		throw new Error("Session reservation CAS contention");
	}
	function selected(id: string) {
		const t = templates.get(id);
		if (!t) throw new MasRequestDenied("Unapproved Session template");
		return t;
	}
	async function bound(id: string, client: MasClient, action: "spawn" | "send" | "reply") {
		const template = selected(id),
			check = () => client.authorize(action);
		check();
		const placements: Record<string, SessionPlacement> = {};
		for (const [key, placement] of Object.entries(template.broker.placements))
			placements[key] = Object.freeze({
				open: async (expected?: string) => {
					check();
					const endpoint = await placement.open(expected);
					check();
					const guarded: SessionEndpoint = {
						view: async () => {
							check();
							const value = await endpoint.view();
							check();
							return value;
						},
						prepare: async (members) => {
							check();
							const value = await endpoint.prepare(members);
							check();
							return value;
						},
						activate: async () => {
							check();
							const value = await endpoint.activate();
							check();
							return value;
						},
						deliver: async (envelope, signal) => {
							check();
							const value = await endpoint.deliver(envelope, signal);
							check();
							return value;
						},
						receipt: async (envelope, nativeId) => {
							check();
							const value = await endpoint.receipt(envelope, nativeId);
							check();
							return value;
						},
						wait: async (envelope, nativeId) => {
							check();
							const value = await endpoint.wait(envelope, nativeId);
							check();
							return value;
						},
					};
					return Object.freeze(guarded);
				},
			});
		const broker = await createBroker({
			...template.broker,
			placements,
			store: guardStore(template.broker.store, check),
		});
		return { template, broker, check };
	}
	async function communication(id: string, client: MasClient, action: "send" | "reply") {
		client.authorize(action);
		if ((await read()).claims[id]?.status !== "created") throw new Error("Session reservation not confirmed");
		const { broker, check } = await bound(id, client, action);
		const view = await broker.view();
		check();
		const source = client.identity.source;
		const found = view.members.find(
			(member) => member.ref && source && same(member.ref.conversation, source),
		);
		if (!found?.ref) throw new Error("Foreign Session participant");
		return broker.connect({ principal: client.identity.principal, source: found.ref, grants: [action] });
	}
	return Object.freeze({
		request: async (client: MasClient, input: Parameters<ApprovedSessions["request"]>[1]) => {
			const template = selected(input.template),
				check = () => client.authorize("spawn");
			check();
			if (
				input.location !== template.location ||
				!validIdentity(input.requestId) ||
				client.identity.principal !== template.principal ||
				!client.identity.source ||
				!same(client.identity.source, template.source)
			)
				throw new MasRequestDenied("Unapproved creation source or location");
			const fingerprint = digest([client.identity, input]);
			await change(check, (claims) => {
				const old = claims[input.template];
				if (old && (old.requestId !== input.requestId || old.fingerprint !== fingerprint))
					throw new MasRequestDenied("Session reservation occupied/conflict");
				if (!old) claims[input.template] = { requestId: input.requestId, fingerprint, status: "pending" };
			});
			try {
				const { broker } = await bound(input.template, client, "spawn");
				const prepared = await broker.bootstrap(template.plan);
				check();
				const active = prepared.phase === "ready" ? await broker.activate() : prepared;
				check();
				const ref = active.members.find((member) => member.spec.key === template.targetKey)?.ref;
				if (active.phase !== "active" || !ref) throw new Error("Creation identity unknown");
				if (template.location === "new-session" && ref.sessionId === template.source.sessionId)
					throw new Error("New Session reused source storage");
				await change(check, (claims) => {
					claims[input.template] = { requestId: input.requestId, fingerprint, status: "created", ref };
				});
				return immutable({ status: "created" as const, template: input.template, ref });
			} catch {
				// A failed lease/storage write cannot erase the original reservation; pending is honest too.
				await change(check, (claims) => {
					const old = claims[input.template]!;
					if (old.status !== "created") old.status = "unknown";
				}).catch(() => {});
				return immutable({ status: "unknown" as const, template: input.template });
			}
		},
		send: async (client: MasClient, id: string, target: BrokerAgentRef, input: SendSpec) =>
			(await communication(id, client, "send")).send(target, input),
		reply: async (client: MasClient, id: string, receiptId: string, input: SendSpec) =>
			(await communication(id, client, "reply")).reply(receiptId, input),
		wait: async (client: MasClient, id: string, receiptId: string) =>
			(await communication(id, client, "send")).wait(receiptId),
		inbox: async (client: MasClient, id: string) => {
			const { broker, check } = await bound(id, client, "reply");
			const view = await broker.view();
			check();
			const source = client.identity.source;
			if (!source || !view.members.some((member) => member.ref && same(member.ref.conversation, source)))
				throw new Error("Foreign Session participant");
			return immutable(view.deliveries.filter((receipt) => same(receipt.target.conversation, source)));
		},
	});
}
