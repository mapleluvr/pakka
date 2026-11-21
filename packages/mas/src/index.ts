export { createApprovedSessions } from "./approved-sessions.ts";
import { MasRequestDenied } from "./errors.ts";
export { MasRequestDenied } from "./errors.ts";
export type {
	ApprovedSessions,
	ApprovedSessionTemplate,
	ApprovedSessionResult,
} from "./approved-sessions.ts";
export { createBroker } from "./broker.ts";
export { inProcessPlacement } from "./session-endpoint.ts";
export type * from "./broker-types.ts";
import type {
	CatalogSnapshot,
	CatalogMember,
	ConversationRef,
	RuntimeCatalog,
	RuntimeRecords,
	ToolInvocationScope,
	DeliveryReceipt,
} from "@pakka/agent";
import type {
	Admission,
	Mas,
	MasClient,
	MasGrant,
	MasInformSpec,
	MasOptions,
	Member,
	MemberPhase,
	MemberSpec,
	SendSpec,
	MasConfigurationRequest,
} from "./types.ts";
import { bindMasInformContext, a2aRecordsNamespace, masInformRevision } from "./inform-context.ts";
import { approveMasResponse, releaseMasResponseAfterRefusal, reserveMasResponse } from "./response-ledger.ts";
export { createMasInformContext } from "./inform-context.ts";
export type { MasInformContextOptions, MasInformContext } from "./inform-context.ts";
export type * from "./types.ts";

function frozen<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.values(value).forEach(frozen);
		Object.freeze(value);
	}
	return value;
}
function dto<T>(value: T): T {
	return frozen(structuredClone(value));
}
function same(a: ConversationRef, b: ConversationRef): boolean {
	return (
		a.key === b.key &&
		a.sessionId === b.sessionId &&
		a.conversationId === b.conversationId &&
		a.incarnation === b.incarnation &&
		a.profile === b.profile
	);
}
const phases: readonly MemberPhase[] = [
	"preparing",
	"ready",
	"active",
	"stopping",
	"retired",
	"failed",
	"unknown",
	"ended",
];
const grants: readonly MasGrant[] = [
	"discover",
	"send",
	"inform",
	"reply",
	"observe",
	"spawn",
	"steer",
	"abort",
	"retire",
	"configure",
	"fork",
];
function member(value: CatalogMember): Member {
	if (typeof value.data.owner !== "string" || !phases.includes(value.data.phase as MemberPhase))
		throw new Error("Invalid persistent MAS membership");
	return dto({
		key: value.key,
		ref: value.ref,
		owner: value.data.owner,
		lifetime: value.lifetime,
		...(value.creation ? { creation: value.creation } : {}),
		phase: value.data.phase as MemberPhase,
		...(typeof value.data.reason === "string" ? { reason: value.data.reason } : {}),
	});
}

/** MAS owns policy and metadata; native state and mutations are behind the trusted catalog port. */
export async function createMas(options: MasOptions): Promise<Mas> {
	const catalog: RuntimeCatalog = options.runtime.catalog(options),
		records: RuntimeRecords = options.runtime.records({ namespace: a2aRecordsNamespace(options.namespace) }),
		runtimeBinding = options.runtime.view(),
		revision = masInformRevision(options.runtime, options.namespace);
	// A definite admission refusal permits only a same-session, root/fingerprint-CAS cleanup after client revocation.
	const checkResponseCleanup = () => {
		const current = options.runtime.view();
		if (
			current.phase !== "ready" ||
			current.sessionId !== runtimeBinding.sessionId ||
			current.sessionFile !== runtimeBinding.sessionFile
		)
			throw new Error("MAS response cleanup Runtime binding changed");
	};
	const inform = options.informContext
		? bindMasInformContext(options.informContext, {
				namespace: options.namespace,
				runtime: options.runtime,
				catalog,
				records,
				revision,
			})
		: undefined;
	let cache: CatalogSnapshot = await catalog.snapshot();
	const revocations = new Map<string, number>();
	let admission: (request: Admission) => boolean | Promise<boolean> = () => true;
	async function refresh() {
		cache = await catalog.snapshot();
		return cache;
	}
	function target(ref: ConversationRef): Member {
		const found = cache.members.find((m) => same(m.ref, ref));
		if (!found) throw new Error("Stale or foreign member reference");
		return member(found);
	}
	async function change(key: string, phase: MemberPhase, check: () => void, reason?: string) {
		await refresh();
		const found = cache.members.find((m) => m.key === key);
		if (!found) throw new Error("Member missing");
		const nextData = { ...found.data, phase, reason };
		if (reason === undefined) Reflect.deleteProperty(nextData, "reason");
		cache = await catalog.update(key, nextData, cache.version, check);
		revision.bump();
		return member(cache.members.find((m) => m.key === key)!);
	}
	async function ready(keys: readonly string[]) {
		for (const key of keys) {
			await refresh();
			const current = cache.members.find((m) => m.key === key)!;
			const observed = await catalog.readiness(current.ref);
			await change(key, observed.phase === "ready" ? "ready" : observed.phase, () => {}, observed.reason);
		}
	}
	async function view() {
		const runtime = options.runtime.view();
		if (runtime.phase === "failed")
			return dto({
				namespace: options.namespace,
				version: cache.version,
				phase: "unknown" as const,
				members: cache.members.map((entry) => ({
					...member(entry),
					phase: "unknown" as const,
					reason: runtime.lastError ?? "Session persistence unknown",
				})),
			});
		await refresh();
		const members = cache.members.map(member);
		const phase: MemberPhase =
			members.length === 0 || members.some((m) => m.phase === "preparing")
				? "preparing"
				: members.some((m) => m.phase === "unknown")
					? "unknown"
					: members.some((m) => m.phase === "failed")
						? "failed"
						: members.some((m) => m.phase === "stopping")
							? "stopping"
							: members.every((m) => m.phase === "retired" || m.phase === "ended")
								? "retired"
								: members.some((m) => m.phase === "active")
									? "active"
									: "ready";
		return dto({ namespace: options.namespace, version: cache.version, phase, members });
	}
	function connect(
		spec: Parameters<Mas["connect"]>[0],
		invocation?: ToolInvocationScope,
		parentCheck?: () => void,
	): MasClient {
		if (
			!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(spec.principal) ||
			!Array.isArray(spec.grants) ||
			spec.grants.some((g) => !grants.includes(g))
		)
			throw new Error("Invalid principal/grants");
		const principal = spec.principal,
			source = spec.source === null ? null : dto(spec.source),
			initiator = spec.initiator ? dto(spec.initiator) : undefined,
			allowed = new Set(spec.grants),
			configurationPrincipal = initiator?.id ?? principal,
			revocationEpoch = revocations.get(principal) ?? 0;
		if (source) target(source);
		function check() {
			parentCheck?.();
			if ((revocations.get(principal) ?? 0) !== revocationEpoch) throw new Error("Principal revoked");
			if (options.runtime.view().phase !== "ready") throw new Error("Runtime is not ready");
			if (source) {
				const from = target(source);
				if (from.phase !== "active") throw new Error("Source admission is not active");
				if (invocation) catalog.checkInvocation(source, invocation);
			}
		}
		function grant(action: MasGrant) {
			check();
			if (!allowed.has(action)) throw new Error("Missing " + action + " grant");
		}
		function owner(ref: ConversationRef, action: "abort" | "retire" | "configure" | "fork") {
			grant(action);
			if (target(ref).owner !== principal) throw new MasRequestDenied("Caller is not resource owner");
		}
		async function receipt(id: string): Promise<DeliveryReceipt> {
			check();
			const found = await catalog.receipt(id, check);
			if (found.principal !== principal && (!source || !same(found.target, source)))
				throw new MasRequestDenied("Foreign delivery receipt");
			return found;
		}
		async function prepareSend(ref: ConversationRef, input: SendSpec, action: "send" | "reply") {
			await refresh();
			grant(action);
			const to = target(ref),
				actual = dto(input);
			if (to.phase !== "active") throw new MasRequestDenied("Recipient admission inactive or retired");
			if (actual.mode === "steer") grant("steer");
			return { to, actual };
		}
		function deliverySpec(to: Member, actual: SendSpec, replyTo?: string) {
			return {
				requestId: actual.requestId,
				principal,
				source,
				target: to.ref,
				text: actual.text,
				mode: actual.mode ?? "prompt",
				...(replyTo ? { replyTo } : {}),
				...(invocation && source
					? { initiator: { kind: "agent" as const, id: source.conversationId } }
					: initiator
						? { initiator }
						: {}),
			};
		}
		async function admit(to: Member, actual: SendSpec, action: "send" | "reply") {
			let decision: boolean;
			try {
				decision = await admission(dto({ principal, source, target: to, input: actual }));
			} catch (error) {
				throw new Error("Recipient admission unconfirmed", { cause: error });
			}
			grant(action);
			if (decision !== true) throw new Error("Recipient admission denied");
		}
		async function replyRecipientReady(ref: ConversationRef) {
			await refresh();
			grant("reply");
			const recipient = target(ref);
			if (recipient.phase !== "active") return false;
			const readiness = await catalog.readiness(recipient.ref);
			check();
			return readiness.phase === "ready";
		}
		async function sendAs(
			ref: ConversationRef,
			input: SendSpec,
			action: "send" | "reply" = "send",
			replyTo?: string,
		) {
			const { to, actual } = await prepareSend(ref, input, action);
			await admit(to, actual, action);
			return catalog.deliver(deliverySpec(to, actual, replyTo), check);
		}
		async function originalRequest(id: string, targetRef: ConversationRef) {
			let cursor: string | undefined;
			do {
				const page = await catalog.history({ limit: 64, ...(cursor ? { cursor } : {}) }, check, (spec) =>
					same(spec.target, targetRef),
				);
				check();
				const found = page.items.find((item) => item.receipt.id === id);
				if (found) return found;
				cursor = page.nextCursor;
			} while (cursor);
			throw new MasRequestDenied("Incoming request identity is unavailable");
		}
		return Object.freeze({
			identity: dto({ principal, source }),
			inbox: async () => {
				grant("reply");
				if (!source) throw new Error("Inbox requires source Conversation");
				return catalog.received(source, check);
			},
			authorize: grant,
			withAuthority: (additional: () => void) => {
				check();
				if (typeof additional !== "function") throw new Error("Invalid authority check");
				return connect(
					{
						principal,
						source,
						grants: [...allowed],
						...(initiator ? { initiator } : {}),
					},
					invocation,
					() => {
						check();
						additional();
					},
				);
			},
			discover: () => {
				grant("discover");
				return dto(cache.members.map(member));
			},
			inspect: async (ref: ConversationRef) => {
				await refresh();
				grant("observe");
				const found = target(ref),
					observed = await catalog.readiness(found.ref);
				check();
				return dto(
					found.phase === "retired" || observed.phase === "ready"
						? found
						: { ...found, phase: observed.phase, reason: observed.reason },
				);
			},
			lookup: async (ref: ConversationRef, input: SendSpec) => {
				const query = dto(input),
					address = dto(ref);
				await refresh();
				grant("send");
				const value = await catalog.lookupRequest(
					{
						principal,
						source,
						target: address,
						requestId: query.requestId,
						text: query.text,
						mode: query.mode ?? "prompt",
					},
					() => grant("send"),
				);
				grant("send");
				return value;
			},
			send: (ref: ConversationRef, input: SendSpec) => sendAs(ref, input, "send"),
			inform: async (ref: ConversationRef, input: MasInformSpec) => {
				if (!inform) throw new MasRequestDenied("Passive inform context is not configured");
				await refresh();
				grant("inform");
				const recipient = target(ref);
				if (recipient.phase !== "active") throw new MasRequestDenied("Inform recipient inactive or retired");
				const startRevision = revision.value,
					guard = () => {
						check();
						if (revision.value !== startRevision)
							throw new Error("MAS membership changed during inform admission");
					};
				return inform.inform(principal, source, recipient.ref, input, guard, async (request) => {
					let decision: boolean;
					try {
						decision = await admission(dto(request));
					} catch (error) {
						throw new Error("Recipient admission unconfirmed", { cause: error });
					}
					return decision === true;
				});
			},
			lookupInform: async (ref: ConversationRef, input: MasInformSpec) => {
				if (!inform) throw new MasRequestDenied("Passive inform context is not configured");
				await refresh();
				grant("inform");
				const recipient = target(ref),
					startRevision = revision.value,
					guard = () => {
						check();
						if (revision.value !== startRevision)
							throw new Error("MAS membership changed during inform lookup");
					};
				return inform.lookup(principal, source, recipient.ref, input, guard);
			},
			reply: async (id: string, input: SendSpec) => {
				grant("reply");
				const found = await receipt(id);
				if (!source || !same(found.target, source) || !found.source)
					throw new MasRequestDenied("Receipt has no authorized reply target");
				const original = await originalRequest(id, found.target);
				if (original.replyTo !== undefined)
					throw new MasRequestDenied("Application responses cannot receive another response");
				const response = { requestId: input.requestId, text: input.text, mode: input.mode ?? "prompt" },
					prepared = await prepareSend(found.source, response, "reply");
				if (!(await replyRecipientReady(found.source)))
					throw new MasRequestDenied("Reply recipient is inactive or not ready");
				const reservation = await reserveMasResponse(
					{ rootReceiptId: id, principal, source, target: found.source, message: prepared.actual },
					records,
					check,
				);
				if (reservation.status === "claimed") {
					let decision: boolean;
					try {
						decision = await admission(
							dto({ principal, source, target: prepared.to, input: prepared.actual }),
						);
					} catch (error) {
						throw new Error("Recipient admission unconfirmed", { cause: error });
					}
					if (decision === false) {
						await releaseMasResponseAfterRefusal(id, reservation.fingerprint, records, checkResponseCleanup);
						grant("reply");
						throw new Error("Recipient admission denied");
					}
					if (decision !== true) throw new Error("Recipient admission unconfirmed");
					grant("reply");
					if (!(await replyRecipientReady(found.source))) {
						await releaseMasResponseAfterRefusal(id, reservation.fingerprint, records, check);
						throw new MasRequestDenied("Reply recipient became inactive or not ready");
					}
					await approveMasResponse(id, reservation.fingerprint, records, check);
				} else {
					await admit(prepared.to, prepared.actual, "reply");
				}
				return catalog.deliver(deliverySpec(prepared.to, prepared.actual, id), check);
			},
			receipt,
			wait: async (id: string, signal?: AbortSignal) => {
				await receipt(id);
				return catalog.wait(id, check, signal);
			},
			withdraw: async (id: string) => {
				grant("send");
				const found = await receipt(id);
				if (found.principal !== principal) throw new MasRequestDenied("Not delivery sender");
				return catalog.withdraw(id, check);
			},
			spawn: async (input: Omit<MemberSpec, "owner">) => {
				await refresh();
				grant("spawn");
				const created = await catalog.enroll(
					[
						{
							key: input.key,
							profile: input.profile,
							lifetime: input.lifetime,
							data: { owner: principal, phase: "preparing" },
							...(source ? { source } : {}),
							...(invocation ? { invocation } : {}),
						},
					],
					check,
				);
				revision.bump();
				await refresh();
				check();
				const observed = await catalog.readiness(created[0]!.ref);
				return change(
					input.key,
					observed.phase === "ready" ? "active" : observed.phase,
					check,
					observed.reason,
				);
			},
			abort: async (ref: ConversationRef) => {
				await refresh();
				owner(ref, "abort");
				await catalog.stop(ref, () => owner(ref, "abort"));
				return target(ref);
			},
			retire: async (ref: ConversationRef) => {
				await refresh();
				owner(ref, "retire");
				const found = target(ref);
				if (found.phase === "retired") return found;
				await change(found.key, "stopping", () => owner(ref, "retire"));
				await catalog.stop(ref, () => owner(ref, "retire"));
				return change(found.key, "retired", () => owner(ref, "retire"));
			},
			configure: async (ref: ConversationRef, profile: string, requestId?: string) => {
				const saved = dto(ref);
				await refresh();
				owner(saved, "configure");
				const changed = await catalog.configure(
					saved,
					profile,
					() => owner(saved, "configure"),
					requestId === undefined ? undefined : { requestId, principal: configurationPrincipal },
				);
				revision.bump();
				await refresh();
				return member(changed);
			},
			configureAgent: async (
				ref: ConversationRef,
				change: import("@pakka/agent").ConversationConfigurationChange,
				requestId?: string,
			) => {
				const saved = dto(ref),
					selection = dto(change);
				await refresh();
				owner(saved, "configure");
				const changed = await catalog.configureAgent(
					saved,
					selection,
					() => owner(saved, "configure"),
					requestId === undefined ? undefined : { requestId, principal: configurationPrincipal },
				);
				revision.bump();
				await refresh();
				return member(changed);
			},
			configurationReceipt: async (input: MasConfigurationRequest) => {
				const original = dto(input);
				grant("configure");
				await refresh();
				const authorize = () => {
					grant("configure");
					const found = cache.members.find(
						({ ref }) =>
							ref.key === original.target.key &&
							ref.sessionId === original.target.sessionId &&
							ref.conversationId === original.target.conversationId,
					);
					if (!found) throw new MasRequestDenied("Foreign configuration member");
					owner(found.ref, "configure");
				};
				authorize();
				return catalog.configurationReceipt({ ...original, principal: configurationPrincipal }, authorize);
			},
			fork: async (ref: ConversationRef, input: { readonly key: string; readonly entryId: string }) => {
				await refresh();
				owner(ref, "fork");
				const [created] = await catalog.enroll(
					[
						{
							key: input.key,
							profile: ref.profile,
							data: { owner: principal, phase: "preparing" },
							fork: { source: ref, entryId: input.entryId },
							...(source ? { source } : {}),
						},
					],
					() => owner(ref, "fork"),
				);
				revision.bump();
				await refresh();
				const observed = await catalog.readiness(created!.ref);
				if (target(ref).phase !== "active") throw new Error("Fork source inactive");
				return change(
					input.key,
					observed.phase === "ready" ? "active" : observed.phase,
					() => owner(ref, "fork"),
					observed.reason,
				);
			},
			forInvocation: (scope: ToolInvocationScope) => {
				check();
				if (!source) throw new Error("Invocation requires source Conversation");
				catalog.checkInvocation(source, scope);
				return connect(
					{
						principal,
						source,
						grants: [...allowed],
						...(initiator ? { initiator } : {}),
					},
					scope,
					check,
				);
			},
		});
	}
	return Object.freeze({
		history: catalog.history,
		lookupReceipt: catalog.lookupReceipt,
		bootstrap: async (specs: readonly MemberSpec[]) => {
			await refresh();
			if (!specs.length || specs.some((s) => typeof s.owner !== "string" || !s.owner))
				throw new Error("Invalid bootstrap members");
			if (cache.members.length) {
				if (
					cache.members.length !== specs.length ||
					specs.some((s) => {
						const found = cache.members.find((m) => m.key === s.key);
						return (
							!found ||
							found.ref.profile !== (s.profile ?? "default") ||
							found.data.owner !== s.owner ||
							found.lifetime !== (s.lifetime ?? "persistent")
						);
					})
				)
					throw new Error("Bootstrap membership conflict");
			} else
				await catalog.enroll(
					specs.map((s) => ({
						key: s.key,
						profile: s.profile,
						lifetime: s.lifetime,
						data: { owner: s.owner, phase: "preparing" },
					})),
					() => {},
				);
			revision.bump();
			await refresh();
			await ready(cache.members.filter((m) => m.data.phase === "preparing").map((m) => m.key));
			return view();
		},
		activate: async () => {
			const snapshot = await refresh();
			const eligible = snapshot.members.filter((entry) => entry.data.phase !== "retired");
			if (
				snapshot.members.length === 0 ||
				eligible.some((entry) => entry.data.phase !== "ready" && entry.data.phase !== "active")
			)
				throw new Error("MAS readiness barrier incomplete");
			for (const entry of eligible)
				if ((await catalog.readiness(entry.ref)).phase !== "ready")
					throw new Error("MAS actual readiness failed");
			const updates = eligible
				.filter((entry) => entry.data.phase !== "active")
				.map((entry) => ({ key: entry.key, data: { ...entry.data, phase: "active" } }));
			if (updates.length) {
				cache = await catalog.updateMany(updates, snapshot.version, () => {});
				revision.bump();
			}
			return view();
		},
		view,
		connect: (spec: Parameters<Mas["connect"]>[0]) => connect(spec),
		revoke: (principal: string) => {
			revocations.set(principal, (revocations.get(principal) ?? 0) + 1);
		},
		setAdmission: (policy: (request: Admission) => boolean | Promise<boolean>) => {
			if (typeof policy !== "function") throw new Error("Invalid admission policy");
			admission = policy;
		},
	});
}
