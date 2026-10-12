import type { JsonObject, RuntimeStoreSnapshot } from "@pakka/agent";
import type { SendSpec } from "./types.ts";
import type {
	Broker,
	BrokerAgentRef,
	BrokerClient,
	BrokerOptions,
	BrokerReceipt,
	BrokerView,
	PlacementSpec,
	RelayEnvelope,
	SessionEndpoint,
} from "./broker-types.ts";
import { digest, immutable, validIdentity, agentRef, record } from "./broker-codec.ts";

type Outbox = { action: "send" | "reply"; envelope: RelayEnvelope; receipt: BrokerReceipt };
type State = {
	schema: "pakka.broker.v1";
	configuration: { namespace: string; maxMembers: number; maxMessages: number; placements: string[] };
	phase: BrokerView["phase"];
	reason?: string;
	plan: PlacementSpec[];
	refs: Record<string, BrokerAgentRef>;
	outbox: Record<string, Outbox>;
};

/** Trusted composition root; durable addressing is not restored runtime authority. */
export async function createBroker(rawOptions: BrokerOptions): Promise<Broker> {
	if (
		!validIdentity(rawOptions.namespace) ||
		![rawOptions.maxMembers, rawOptions.maxMessages].every((n) => Number.isSafeInteger(n) && n > 0)
	)
		throw new Error("Invalid finite broker options");
	const placements = new Map(Object.entries(rawOptions.placements));
	if (!placements.size || [...placements.keys()].some((key) => !validIdentity(key)))
		throw new Error("Invalid approved placements");
	const configuration = immutable({
		namespace: rawOptions.namespace,
		maxMembers: rawOptions.maxMembers,
		maxMessages: rawOptions.maxMessages,
		placements: [...placements.keys()].sort(),
	});
	const store = rawOptions.store,
		revoked = new Map<string, number>(),
		active = new Map<string, Set<AbortController>>();
	const seed = (): State => ({
		schema: "pakka.broker.v1",
		configuration,
		phase: "preparing",
		plan: [],
		refs: {},
		outbox: {},
	});
	function decode(snapshot: RuntimeStoreSnapshot): State {
		if (snapshot.version === 0) return seed();
		const data = snapshot.data;
		if (
			data.schema !== "pakka.broker.v1" ||
			digest(data.configuration) !== digest(configuration) ||
			!["preparing", "ready", "active", "unknown"].includes(String(data.phase)) ||
			!Array.isArray(data.plan) ||
			!record(data.refs) ||
			!record(data.outbox) ||
			data.plan.length > configuration.maxMembers ||
			Object.keys(data.outbox).length > configuration.maxMessages
		)
			throw new Error("Broker persistent configuration/state conflict");
		const plan: readonly unknown[] = data.plan;
		if (
			plan.some(
				(spec) =>
					!record(spec) ||
					!validIdentity(spec.key) ||
					!validIdentity(spec.owner) ||
					!placements.has(String(spec.placement)),
			) ||
			new Set(plan.map((spec) => (record(spec) ? spec.key : null))).size !== plan.length
		)
			throw new Error("Broker persistent plan invalid");
		if (
			Object.entries(data.refs).some(
				([key, ref]) =>
					!agentRef(ref) ||
					ref.key !== key ||
					!plan.some((spec) => record(spec) && spec.key === key && spec.placement === ref.placement),
			)
		)
			throw new Error("Broker persistent reference invalid");
		for (const [id, item] of Object.entries(data.outbox)) {
			if (
				!record(item) ||
				!["send", "reply"].includes(String(item.action)) ||
				!record(item.envelope) ||
				!record(item.receipt)
			)
				throw new Error("Broker persistent outbox invalid");
			const envelope = item.envelope,
				receipt = item.receipt;
			if (
				envelope.id !== id ||
				!validIdentity(envelope.principal) ||
				!agentRef(envelope.target) ||
				(envelope.source !== null && !agentRef(envelope.source)) ||
				!record(envelope.input) ||
				!validIdentity(envelope.input.requestId) ||
				typeof envelope.input.text !== "string" ||
				!["prompt", "steer", "followUp"].includes(String(envelope.input.mode))
			)
				throw new Error("Broker persistent envelope invalid");
			if (
				receipt.id !== id ||
				receipt.principal !== envelope.principal ||
				receipt.requestId !== envelope.input.requestId ||
				digest(receipt.source) !== digest(envelope.source) ||
				digest(receipt.target) !== digest(envelope.target) ||
				!["pending", "queued", "placed", "done", "unanswered", "unknown"].includes(String(receipt.status))
			)
				throw new Error("Broker persistent receipt invalid");
		}
		// SAFETY: finite JSON comes from the store; schema/configuration, plan, refs and outbox envelopes/receipts are validated above before any effect.
		return data as unknown as State;
	}
	async function read() {
		const snapshot = await store.snapshot();
		return { snapshot, state: decode(snapshot) };
	}
	async function change(update: (state: State) => void, check: () => void = () => {}) {
		const { snapshot, state } = await read();
		const next = structuredClone(state);
		update(next);
		check();
		// SAFETY: only validated State plus normalized JSON plans/envelopes/receipts is stored; the adapter revalidates finite JSON and byte capacity.
		await store.compareAndSet(snapshot.version, next as unknown as JsonObject, check);
		return next;
	}
	function address(state: State, ref: BrokerAgentRef): BrokerAgentRef {
		const current = state.refs[ref?.key];
		if (!current || digest(current) !== digest(ref)) throw new Error("Stale or foreign broker reference");
		return current;
	}
	async function open(ref: BrokerAgentRef): Promise<SessionEndpoint> {
		const endpoint = await placements.get(ref.placement)!.open(ref.sessionId);
		const view = await endpoint.view();
		if (
			view.sessionId !== ref.sessionId ||
			!view.mas.members.some(
				(member) =>
					member.key === ref.key &&
					digest(member.ref) === digest(ref.conversation) &&
					member.phase === "active",
			)
		)
			throw new Error("Broker member Session identity inactive or changed");
		return endpoint;
	}
	async function view(): Promise<BrokerView> {
		const { state } = await read();
		return immutable({
			phase: state.phase,
			...(state.reason ? { reason: state.reason } : {}),
			members: state.plan.map((spec) => ({
				spec,
				...(state.refs[spec.key] ? { ref: state.refs[spec.key] } : {}),
			})),
			deliveries: Object.values(state.outbox).map((item) => item.receipt),
		});
	}
	async function bootstrap(input: readonly PlacementSpec[]) {
		const plan = input.map((spec) => ({
			key: spec.key,
			placement: spec.placement,
			owner: spec.owner,
			...(spec.profile ? { profile: spec.profile } : {}),
		}));
		if (
			!plan.length ||
			plan.length > configuration.maxMembers ||
			new Set(plan.map((spec) => spec.key)).size !== plan.length ||
			plan.some(
				(spec) =>
					!validIdentity(spec.key) ||
					!validIdentity(spec.owner) ||
					!placements.has(spec.placement) ||
					(spec.profile !== undefined && !validIdentity(spec.profile)),
			)
		)
			throw new Error("Invalid or over-capacity broker enrollment plan");
		const initial = await read();
		if (initial.state.plan.length && digest(initial.state.plan) !== digest(plan))
			throw new Error("Enrollment plan conflict");
		if (initial.state.phase === "active") return view();
		if (!initial.state.plan.length)
			await change((state) => {
				if (state.plan.length) throw new Error("Enrollment CAS conflict");
				state.plan = plan;
			});
		try {
			for (const placement of new Set(plan.map((spec) => spec.placement))) {
				const group = plan.filter((spec) => spec.placement === placement),
					{ state } = await read();
				const expected = state.refs[group[0]!.key]?.sessionId;
				const endpoint = await placements.get(placement)!.open(expected);
				await endpoint.prepare(
					group.map(({ key, owner, profile }) => ({ key, owner, ...(profile ? { profile } : {}) })),
				);
				const observed = await endpoint.view();
				if (expected && observed.sessionId !== expected)
					throw new Error("Enrollment Session identity changed");
				if (
					observed.mas.members.length !== group.length ||
					group.some(
						(spec) =>
							!observed.mas.members.some(
								(member) =>
									member.key === spec.key &&
									member.owner === spec.owner &&
									(member.phase === "ready" || member.phase === "active"),
							),
					)
				)
					throw new Error("Enrollment not actually prepared");
				await change((current) => {
					for (const spec of group) {
						const native = observed.mas.members.find((member) => member.key === spec.key)!;
						const ref = { key: spec.key, placement, sessionId: observed.sessionId, conversation: native.ref };
						if (current.refs[spec.key] && digest(current.refs[spec.key]) !== digest(ref))
							throw new Error("Enrollment reference changed");
						current.refs[spec.key] = ref;
					}
				});
			}
			await change((state) => {
				state.phase = "ready";
				delete state.reason;
			});
		} catch (error) {
			await change((state) => {
				state.phase = "unknown";
				state.reason = String(error).slice(0, 4096);
			});
		}
		return view();
	}
	async function activate() {
		const { state } = await read();
		if (state.phase === "active") return view();
		if (state.phase !== "ready" || state.plan.some((spec) => !state.refs[spec.key]))
			throw new Error("Enrollment is not ready/prepared");
		try {
			for (const placement of new Set(state.plan.map((spec) => spec.placement))) {
				const refs = state.plan
					.filter((spec) => spec.placement === placement)
					.map((spec) => state.refs[spec.key]!);
				const endpoint = await placements.get(placement)!.open(refs[0]!.sessionId);
				const current = await endpoint.view();
				if (
					current.sessionId !== refs[0]!.sessionId ||
					refs.some((ref) => !current.mas.members.some((m) => digest(m.ref) === digest(ref.conversation)))
				)
					throw new Error("Activation identity changed");
				await endpoint.activate();
			}
			await change((current) => {
				if (digest(current.refs) !== digest(state.refs)) throw new Error("Activation roster changed");
				current.phase = "active";
				delete current.reason;
			});
		} catch (error) {
			await change((current) => {
				current.phase = "unknown";
				current.reason = String(error).slice(0, 4096);
			});
		}
		return view();
	}
	function connect(spec: Parameters<Broker["connect"]>[0]): BrokerClient {
		if (
			!validIdentity(spec.principal) ||
			!Array.isArray(spec.grants) ||
			spec.grants.some((grant) => !["discover", "send", "reply"].includes(grant))
		)
			throw new Error("Invalid broker principal/grants");
		const principal = spec.principal,
			source = spec.source === null ? null : immutable(spec.source),
			grants = new Set(spec.grants),
			epoch = revoked.get(principal) ?? 0;
		function check(state?: State, action?: "discover" | "send" | "reply") {
			if ((revoked.get(principal) ?? 0) !== epoch) throw new Error("Broker principal revoked");
			if (action && !grants.has(action)) throw new Error("Missing broker " + action + " grant");
			if (state && source) address(state, source);
		}
		async function owned(id: string) {
			const { state } = await read();
			check(state);
			const item = state.outbox[id];
			if (
				!item ||
				(item.envelope.principal !== principal &&
					(!source || digest(item.envelope.target) !== digest(source)))
			)
				throw new Error("Foreign broker receipt");
			return item;
		}
		async function updateReceipt(item: Outbox, receipt: BrokerReceipt) {
			let committed = receipt;
			await change((state) => {
				const current = state.outbox[item.envelope.id];
				if (!current || digest(current.envelope) !== digest(item.envelope))
					throw new Error("Outbox identity conflict");
				if (current.receipt.status === "done" || current.receipt.status === "unanswered")
					committed = current.receipt;
				else current.receipt = receipt;
			});
			return immutable(committed);
		}
		async function transmit(item: Outbox): Promise<BrokerReceipt> {
			const current = (await read()).state;
			check(current, item.action);
			if (current.phase !== "active" || digest(source) !== digest(item.envelope.source))
				throw new Error("Outbox source authority inactive or changed");
			address(current, item.envelope.target);
			const controller = new AbortController(),
				pending = active.get(principal) ?? new Set<AbortController>();
			pending.add(controller);
			active.set(principal, pending);
			try {
				const endpoint = await open(item.envelope.target);
				if (source) await open(source);
				check((await read()).state, item.action);
				const native = await endpoint.deliver(item.envelope, controller.signal);
				return await updateReceipt(item, { ...item.receipt, status: native.status, native });
			} catch (error) {
				const uncertain: BrokerReceipt = { ...item.receipt, status: "unknown", reason: String(error) };
				let reported = uncertain;
				try {
					reported = await updateReceipt(item, uncertain);
				} catch {
					/* coordinator poison stays sealed; do not report a durable success */
				}
				check();
				return immutable(reported);
			} finally {
				pending.delete(controller);
				if (!pending.size) active.delete(principal);
			}
		}
		async function sendAs(target: BrokerAgentRef, original: SendSpec, action: "send" | "reply") {
			let { state } = await read();
			check(state, action);
			if (state.phase !== "active") throw new Error("Broker enrollment is not active");
			const to = address(state, target);
			if (
				!validIdentity(original.requestId) ||
				typeof original.text !== "string" ||
				!original.text.trim() ||
				original.text.length > 65536 ||
				original.text.startsWith("/") ||
				!["prompt", "steer", "followUp"].includes(original.mode ?? "prompt")
			)
				throw new Error("Invalid broker delivery");
			if (source) {
				await open(source);
				check((await read()).state, action);
			}
			const input = immutable({
				requestId: original.requestId,
				text: original.text,
				mode: original.mode ?? "prompt",
			});
			const id = digest([
				configuration.namespace,
				principal,
				source?.conversation.incarnation ?? null,
				input.requestId,
			]);
			const envelope = immutable({ id, principal, source, target: to, input });
			state = (await read()).state;
			check(state, action);
			let item = state.outbox[id];
			if (item && digest(item.envelope) !== digest(envelope))
				throw new Error("Delivery payload/mode/identity conflict");
			if (!item) {
				const receipt: BrokerReceipt = {
					id,
					requestId: input.requestId,
					principal,
					source,
					target: to,
					status: "pending",
				};
				item = { action, envelope, receipt };
				await change(
					(current) => {
						check(current, action);
						if (current.phase !== "active") throw new Error("Broker not active");
						address(current, to);
						if (Object.keys(current.outbox).length >= configuration.maxMessages)
							throw new Error("Outbox capacity exhausted");
						if (current.outbox[id]) throw new Error("Concurrent outbox reservation; retry same identity");
						current.outbox[id] = item!;
					},
					() => check(undefined, action),
				);
			}
			if (item.receipt.status === "done" || item.receipt.status === "unanswered")
				return immutable(item.receipt);
			return transmit(item);
		}
		return Object.freeze({
			discover: async () => {
				const { state } = await read();
				check(state, "discover");
				return immutable(Object.values(state.refs));
			},
			send: (target: BrokerAgentRef, input: SendSpec) => sendAs(target, input, "send"),
			reply: async (id: string, input: SendSpec) => {
				check(undefined, "reply");
				const item = await owned(id);
				if (!source || digest(item.envelope.target) !== digest(source) || !item.envelope.source)
					throw new Error("No authorized logical reply target");
				return sendAs(item.envelope.source, input, "reply");
			},
			receipt: async (id: string) => immutable((await owned(id)).receipt),
			wait: async (id: string) => {
				let item = await owned(id);
				if (item.receipt.status === "done" || item.receipt.status === "unanswered")
					return immutable(item.receipt);
				if (!item.receipt.native) {
					if (item.envelope.principal !== principal) return immutable(item.receipt);
					await transmit(item);
					item = await owned(id);
				}
				if (!item.receipt.native) return immutable(item.receipt);
				try {
					const endpoint = await open(item.envelope.target);
					check((await read()).state);
					const native = await endpoint.wait(item.envelope, item.receipt.native.id);
					check();
					return await updateReceipt(item, { ...item.receipt, status: native.status, native });
				} catch (error) {
					check();
					return updateReceipt(item, { ...item.receipt, status: "unknown", reason: String(error) });
				}
			},
		});
	}
	await read();
	return Object.freeze({
		bootstrap,
		activate,
		view,
		connect,
		revoke: (principal: string) => {
			revoked.set(principal, (revoked.get(principal) ?? 0) + 1);
			for (const pending of active.get(principal) ?? []) pending.abort();
		},
	});
}
