import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { JsonObject, Runtime } from "@pakka/agent";

export type PocketRole = "viewer" | "sender" | "driver" | "admin";
export type PocketPermission =
	| "read"
	| "send"
	| "steer"
	| "manage"
	| "create"
	| "invite"
	| "extensions.install";
export type PocketResources = "*" | readonly string[];
export interface PocketPerson {
	readonly id: string;
	readonly name: string;
	readonly role: PocketRole;
	readonly resources: PocketResources;
	readonly active: boolean;
}
export interface PocketAuthority {
	readonly person: PocketPerson;
	check(permission: PocketPermission, conversationId?: string): void;
	verifyCsrf(token: string): void;
}
export interface PocketSession {
	readonly person: PocketPerson;
	readonly token: string;
	readonly csrf: string;
	readonly expiresAt: number;
}
export interface PocketInvite {
	readonly id: string;
	readonly role: PocketRole;
	readonly resources: PocketResources;
	readonly expiresAt: number;
	readonly status: "pending" | "redeemed" | "revoked";
}
export interface PocketInviteInput {
	readonly requestId: string;
	readonly personId?: string;
	readonly role: PocketRole;
	readonly resources: PocketResources;
	readonly ttlMs: number;
}
export interface PocketPeople {
	/** Local trusted bootstrap only; never an unauthenticated network route. */
	initializeOwner(name: string): Promise<PocketSession>;
	authenticate(token: string): Promise<PocketAuthority>;
	/** Identity-bound synchronous checks for trusted services at publication/commit time. */
	current(actor: PocketAuthority): PocketPerson;
	check(actor: PocketAuthority, permission: PocketPermission, conversationId?: string): void;
	/** Trusted service recheck of a persisted originating person. This issues no browser session/capability. */
	authorizePerson(id: string, permission: PocketPermission, conversationId?: string): PocketPerson;
	invite(
		actor: PocketAuthority,
		input: PocketInviteInput,
	): Promise<{ readonly invite: PocketInvite; readonly token: string | null }>;
	setPerson(
		actor: PocketAuthority,
		id: string,
		input: { readonly role: PocketRole; readonly resources: PocketResources },
	): Promise<void>;
	redeem(token: string, name: string): Promise<PocketSession>;
	list(
		actor: PocketAuthority,
	): Promise<{ readonly people: readonly PocketPerson[]; readonly invites: readonly PocketInvite[] }>;
	revokeInvite(actor: PocketAuthority, id: string): Promise<void>;
	revokePerson(actor: PocketAuthority, id: string): Promise<void>;
	logout(actor: PocketAuthority): Promise<void>;
	rotate(actor: PocketAuthority): Promise<PocketSession>;
}
export interface PocketPeopleOptions {
	readonly runtime: Runtime;
	readonly namespace: string;
	readonly sessionTtlMs?: number;
	/** Trusted clock, primarily for deterministic issuer-expiry tests. */
	readonly now?: () => number;
}

type Person = { id: string; name: string; role: PocketRole; resources: "*" | string[]; active: boolean };
type Session = {
	id: string;
	personId: string;
	tokenHash: string;
	csrfHash: string;
	expiresAt: number;
	active: boolean;
};
type Invite = {
	id: string;
	issuerId: string;
	requestId: string;
	fingerprint: string;
	tokenHash: string;
	role: PocketRole;
	resources: "*" | string[];
	expiresAt: number;
	status: PocketInvite["status"];
	redeemedTo: string | null;
	targetPersonId: string | null;
};
type State = { schema: 1; sessionId: string; people: Person[]; sessions: Session[]; invites: Invite[] };
const MAX_PEOPLE = 128,
	MAX_SESSIONS = 512,
	MAX_INVITES = 512,
	MAX_BYTES = 262144;
const roles: readonly PocketRole[] = ["viewer", "sender", "driver", "admin"];
const permissions: Readonly<Record<PocketRole, readonly PocketPermission[]>> = {
	viewer: ["read"],
	sender: ["read", "send"],
	driver: ["read", "send", "steer"],
	admin: ["read", "send", "steer", "manage", "create", "invite", "extensions.install"],
};
const opened = new WeakMap<
	Runtime,
	Map<string, { ttl: number; now: () => number; value: Promise<PocketPeople> }>
>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const isId = (v: unknown): v is string => typeof v === "string" && /^[-a-zA-Z0-9._:]{1,160}$/.test(v);
const isHash = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const isName = (v: unknown): v is string =>
	typeof v === "string" && v.trim().length > 0 && v.length <= 80 && !/[\x00-\x1f\x7f]/.test(v);
const isRole = (v: unknown): v is PocketRole => roles.includes(v as PocketRole);
const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isScope = (v: unknown): v is "*" | string[] =>
	v === "*" ||
	(Array.isArray(v) && v.length > 0 && v.length <= 128 && v.every(isId) && new Set(v).size === v.length);
function record(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, allowed: string[]) {
	return Object.keys(v).length === allowed.length && Object.keys(v).every((k) => allowed.includes(k));
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function deny(): never {
	throw new Error("Pocket authority denied");
}
function personView(p: Person): PocketPerson {
	return freeze({ ...p, resources: p.resources === "*" ? "*" : [...p.resources] });
}
function inviteView(i: Invite): PocketInvite {
	return freeze({
		id: i.id,
		role: i.role,
		resources: i.resources === "*" ? "*" : [...i.resources],
		expiresAt: i.expiresAt,
		status: i.status,
	});
}
function decode(data: JsonObject, version: number, sessionId: string): State {
	if (version === 0 && Object.keys(data).length === 0)
		return { schema: 1, sessionId, people: [], sessions: [], invites: [] };
	const bad = () => {
		throw new Error("Invalid persisted Pocket people state");
	};
	if (
		!record(data) ||
		!keys(data, ["schema", "sessionId", "people", "sessions", "invites"]) ||
		data.schema !== 1 ||
		data.sessionId !== sessionId ||
		!Array.isArray(data.people) ||
		!Array.isArray(data.sessions) ||
		!Array.isArray(data.invites) ||
		data.people.length < 1 ||
		data.people.length > MAX_PEOPLE ||
		data.sessions.length > MAX_SESSIONS ||
		data.invites.length > MAX_INVITES
	)
		return bad();
	const people: Person[] = [],
		sessions: Session[] = [],
		invites: Invite[] = [];
	for (const p of data.people) {
		if (
			!record(p) ||
			!keys(p, ["id", "name", "role", "resources", "active"]) ||
			!isId(p.id) ||
			!isName(p.name) ||
			!isRole(p.role) ||
			!isScope(p.resources) ||
			typeof p.active !== "boolean"
		)
			return bad();
		people.push({
			id: p.id,
			name: p.name,
			role: p.role,
			resources: p.resources === "*" ? "*" : [...p.resources],
			active: p.active,
		});
	}
	for (const s of data.sessions) {
		if (
			!record(s) ||
			!keys(s, ["id", "personId", "tokenHash", "csrfHash", "expiresAt", "active"]) ||
			!isId(s.id) ||
			!isId(s.personId) ||
			!isHash(s.tokenHash) ||
			!isHash(s.csrfHash) ||
			!isTime(s.expiresAt) ||
			typeof s.active !== "boolean" ||
			!people.some((p) => p.id === s.personId)
		)
			return bad();
		sessions.push({
			id: s.id,
			personId: s.personId,
			tokenHash: s.tokenHash,
			csrfHash: s.csrfHash,
			expiresAt: s.expiresAt,
			active: s.active,
		});
	}
	for (const i of data.invites) {
		if (
			!record(i) ||
			!keys(i, [
				"id",
				"issuerId",
				"requestId",
				"fingerprint",
				"tokenHash",
				"role",
				"resources",
				"expiresAt",
				"status",
				"redeemedTo",
				"targetPersonId",
			]) ||
			!isId(i.id) ||
			!isId(i.issuerId) ||
			!isId(i.requestId) ||
			!isHash(i.fingerprint) ||
			!isHash(i.tokenHash) ||
			!isRole(i.role) ||
			!isScope(i.resources) ||
			!isTime(i.expiresAt) ||
			!["pending", "redeemed", "revoked"].includes(i.status as string) ||
			!people.some((p) => p.id === i.issuerId) ||
			!(i.redeemedTo === null || (isId(i.redeemedTo) && people.some((p) => p.id === i.redeemedTo))) ||
			!(
				i.targetPersonId === null ||
				(isId(i.targetPersonId) && people.some((p) => p.id === i.targetPersonId))
			) ||
			(i.status === "redeemed") !== (i.redeemedTo !== null)
		)
			return bad();
		invites.push({
			id: i.id,
			issuerId: i.issuerId,
			requestId: i.requestId,
			fingerprint: i.fingerprint,
			tokenHash: i.tokenHash,
			role: i.role,
			resources: i.resources === "*" ? "*" : [...i.resources],
			expiresAt: i.expiresAt,
			status: i.status as Invite["status"],
			redeemedTo: i.redeemedTo,
			targetPersonId: i.targetPersonId as string | null,
		});
	}
	if (
		new Set(people.map((p) => p.id)).size !== people.length ||
		new Set(sessions.map((s) => s.id)).size !== sessions.length ||
		new Set(sessions.map((s) => s.tokenHash)).size !== sessions.length ||
		new Set(invites.map((i) => i.id)).size !== invites.length ||
		new Set(invites.map((i) => i.tokenHash)).size !== invites.length ||
		new Set(invites.map((i) => i.issuerId + ":" + i.requestId)).size !== invites.length ||
		!people.some((p) => p.active && p.role === "admin" && p.resources === "*")
	)
		return bad();
	return { schema: 1, sessionId, people, sessions, invites };
}

/** One owner per Runtime/namespace. Persistence stays behind the controlled Durable CAS port. */
export function createPocketPeople(options: PocketPeopleOptions): Promise<PocketPeople> {
	const ttl = options.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000,
		now = options.now ?? Date.now;
	if (!Number.isSafeInteger(ttl) || ttl < 1000 || ttl > 30 * 24 * 60 * 60 * 1000)
		throw new Error("Invalid finite Pocket session lifetime");
	let map = opened.get(options.runtime);
	if (!map) {
		map = new Map();
		opened.set(options.runtime, map);
	}
	const prior = map.get(options.namespace);
	if (prior) {
		if (prior.ttl !== ttl || prior.now !== now) throw new Error("Pocket people owner options conflict");
		return prior.value;
	}
	const value = openPeople(options, ttl, now);
	map.set(options.namespace, { ttl, now, value });
	return value;
}
async function openPeople(
	options: PocketPeopleOptions,
	ttl: number,
	now: () => number,
): Promise<PocketPeople> {
	const runtime = options.runtime,
		store = runtime.store({ namespace: options.namespace, maxBytes: MAX_BYTES }),
		sessionId = runtime.view().sessionId;
	let state: State,
		version = -1,
		available = true,
		tail: Promise<unknown> = Promise.resolve();
	const bindings = new WeakMap<PocketAuthority, string>(),
		blockedPeople = new Set<string>(),
		blockedSessions = new Set<string>(),
		blockedInvites = new Set<string>();
	function ready() {
		if (!available || runtime.view().phase !== "ready") deny();
	}
	function time() {
		const value = now();
		if (!isTime(value)) throw new Error("Invalid Pocket issuer clock");
		return value;
	}
	async function refresh() {
		ready();
		try {
			const snapshot = await store.snapshot();
			const next = decode(snapshot.data, snapshot.version, sessionId);
			ready();
			if (snapshot.version >= version) {
				state = next;
				version = snapshot.version;
			}
		} catch (error) {
			available = false;
			throw error;
		}
	}
	function sessionFor(id: string) {
		ready();
		const s = state.sessions.find((row) => row.id === id),
			p = s && state.people.find((row) => row.id === s.personId);
		if (
			!s?.active ||
			!p?.active ||
			s.expiresAt <= time() ||
			blockedPeople.has(p.id) ||
			blockedSessions.has(s.id)
		)
			return deny();
		return { s, p };
	}
	function personAllowed(p: Person, permission: PocketPermission, resource?: string) {
		if (!p.active || blockedPeople.has(p.id) || !permissions[p.role].includes(permission)) return deny();
		if (["read", "send", "steer", "manage"].includes(permission)) {
			if (
				!resource ||
				!runtime.view().conversations.some((ref) => ref.conversationId === resource) ||
				(p.resources !== "*" && !p.resources.includes(resource))
			)
				return deny();
		} else if (p.resources !== "*") return deny();
	}
	function bound(actor: PocketAuthority, permission: PocketPermission, resource?: string) {
		const id = bindings.get(actor);
		if (!id) return deny();
		const { s, p } = sessionFor(id);
		personAllowed(p, permission, resource);
		return { s, p };
	}
	function makeSession(person: Person): { saved: Session; issued: PocketSession } {
		const token = secret(),
			csrf = secret(),
			expiresAt = time() + ttl;
		return {
			saved: {
				id: randomUUID(),
				personId: person.id,
				tokenHash: digest(token),
				csrfHash: digest(csrf),
				expiresAt,
				active: true,
			},
			issued: freeze({ person: personView(person), token, csrf, expiresAt }),
		};
	}
	function scope(resources: PocketResources): "*" | string[] {
		if (!isScope(resources)) throw new Error("Invalid Pocket resource scope");
		const approved = new Set(runtime.view().conversations.map((ref) => ref.conversationId));
		if (resources !== "*" && resources.some((id) => !approved.has(id))) return deny();
		return resources === "*" ? "*" : [...resources].sort();
	}
	function redeemable(data: State, hash: string): Invite {
		const invite = data.invites.find((row) => row.tokenHash === hash);
		if (
			!invite ||
			invite.status !== "pending" ||
			blockedInvites.has(invite.id) ||
			invite.expiresAt <= time() ||
			!data.people.some(
				(p) => p.id === invite.issuerId && p.active && p.role === "admin" && p.resources === "*",
			) ||
			blockedPeople.has(invite.issuerId)
		)
			return deny();
		if (
			invite.targetPersonId !== null &&
			!data.people.some(
				(p) =>
					p.id === invite.targetPersonId &&
					p.active &&
					!blockedPeople.has(p.id) &&
					p.role === invite.role &&
					JSON.stringify(p.resources) === JSON.stringify(invite.resources),
			)
		)
			return deny();
		return invite;
	}
	function mutate<T>(effect: (draft: State) => T, check: () => void): Promise<T> {
		const operation = tail.then(async () => {
			await refresh();
			check();
			const draft = structuredClone(state),
				before = JSON.stringify(state),
				result = effect(draft);
			if (
				draft.people.length > MAX_PEOPLE ||
				draft.sessions.length > MAX_SESSIONS ||
				draft.invites.length > MAX_INVITES
			)
				throw new Error("Pocket identity capacity exceeded");
			if (JSON.stringify(draft) !== before) {
				decode(draft, version + 1, sessionId);
				try {
					const next = await store.compareAndSet(version, draft, check);
					state = decode(next.data, next.version, sessionId);
					version = next.version;
				} catch (error) {
					if (runtime.view().phase !== "ready") available = false;
					throw error;
				}
			}
			return result;
		});
		tail = operation.then(
			() => {},
			() => {},
		);
		return operation;
	}
	await refresh();
	return Object.freeze({
		current: (actor: PocketAuthority) => {
			const id = bindings.get(actor);
			if (!id) return deny();
			return personView(sessionFor(id).p);
		},
		check: (actor: PocketAuthority, permission: PocketPermission, resource?: string) => {
			bound(actor, permission, resource);
		},
		authorizePerson: (id: string, permission: PocketPermission, resource?: string) => {
			ready();
			const p = state.people.find((person) => person.id === id);
			if (!p) return deny();
			personAllowed(p, permission, resource);
			return personView(p);
		},
		initializeOwner: async (name: string) => {
			if (!isName(name)) throw new Error("Invalid Pocket person name");
			return mutate((draft) => {
				if (draft.people.length) throw new Error("Pocket owner already initialized");
				const person: Person = {
					id: randomUUID(),
					name: name.trim(),
					role: "admin",
					resources: "*",
					active: true,
				};
				const issued = makeSession(person);
				draft.people.push(person);
				draft.sessions.push(issued.saved);
				return issued.issued;
			}, ready);
		},
		authenticate: async (token: string) => {
			if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return deny();
			await refresh();
			const found = state.sessions.find((row) => row.tokenHash === digest(token));
			if (!found) return deny();
			const { p } = sessionFor(found.id);
			const actor: PocketAuthority = Object.freeze({
				person: personView(p),
				check: (permission: PocketPermission, resource?: string) => {
					bound(actor, permission, resource);
				},
				verifyCsrf: (token: string) => {
					const { s } = sessionFor(found.id);
					if (
						typeof token !== "string" ||
						token.length > 256 ||
						!timingSafeEqual(Buffer.from(s.csrfHash, "hex"), Buffer.from(digest(token), "hex"))
					)
						return deny();
				},
			});
			bindings.set(actor, found.id);
			return actor;
		},
		invite: async (actor: PocketAuthority, input: PocketInviteInput) => {
			bound(actor, "invite");
			if (
				!input ||
				Object.keys(input).some(
					(key) => !["requestId", "personId", "role", "resources", "ttlMs"].includes(key),
				) ||
				!isId(input.requestId) ||
				!isRole(input.role) ||
				(input.personId !== undefined && !isId(input.personId)) ||
				!Number.isSafeInteger(input.ttlMs) ||
				input.ttlMs < 1 ||
				input.ttlMs > 7 * 24 * 60 * 60 * 1000
			)
				throw new Error("Invalid finite Pocket invitation");
			const { requestId, role, ttlMs } = input,
				targetPersonId = input.personId ?? null;
			const resources = scope(input.resources),
				fingerprint = digest(JSON.stringify({ role, resources, ttlMs, targetPersonId }));
			return mutate(
				(draft) => {
					const { p } = bound(actor, "invite");
					const prior = draft.invites.find((row) => row.issuerId === p.id && row.requestId === requestId);
					if (prior) {
						if (prior.fingerprint !== fingerprint) throw new Error("Pocket invitation request conflict");
						return freeze({ invite: inviteView(prior), token: null });
					}
					if (
						targetPersonId !== null &&
						!draft.people.some(
							(p) =>
								p.id === targetPersonId &&
								p.active &&
								!blockedPeople.has(p.id) &&
								p.role === role &&
								JSON.stringify(p.resources) === JSON.stringify(resources),
						)
					)
						return deny();
					const token = secret(),
						invite: Invite = {
							id: randomUUID(),
							issuerId: p.id,
							requestId,
							fingerprint,
							tokenHash: digest(token),
							role,
							resources,
							expiresAt: time() + ttlMs,
							status: "pending",
							redeemedTo: null,
							targetPersonId,
						};
					draft.invites.push(invite);
					return freeze({ invite: inviteView(invite), token });
				},
				() => {
					bound(actor, "invite");
				},
			);
		},
		redeem: async (token: string, name: string) => {
			if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(token) || !isName(name)) return deny();
			const hash = digest(token),
				personName = name.trim();
			return mutate(
				(draft) => {
					const invite = redeemable(draft, hash);
					const existing =
						invite.targetPersonId === null
							? undefined
							: draft.people.find((p) => p.id === invite.targetPersonId);
					const person: Person = existing ?? {
						id: randomUUID(),
						name: personName,
						role: invite.role,
						resources: invite.resources === "*" ? "*" : [...invite.resources],
						active: true,
					};
					const issued = makeSession(person);
					if (!existing) draft.people.push(person);
					draft.sessions.push(issued.saved);
					invite.status = "redeemed";
					invite.redeemedTo = person.id;
					return issued.issued;
				},
				() => {
					ready();
					redeemable(state, hash);
				},
			);
		},
		setPerson: async (
			actor: PocketAuthority,
			id: string,
			input: { readonly role: PocketRole; readonly resources: PocketResources },
		) => {
			const issuer = bound(actor, "invite");
			if (
				issuer.p.id === id ||
				!input ||
				Object.keys(input).some((key) => !["role", "resources"].includes(key)) ||
				!isRole(input.role) ||
				!state.people.some((p) => p.id === id && p.active)
			)
				return deny();
			const role = input.role,
				resources = scope(input.resources);
			for (const s of state.sessions) if (s.personId === id) blockedSessions.add(s.id);
			await mutate(
				(draft) => {
					const target = draft.people.find((p) => p.id === id && p.active);
					if (!target) return deny();
					target.role = role;
					target.resources = resources;
					for (const s of draft.sessions) if (s.personId === id) s.active = false;
					for (const i of draft.invites)
						if ((i.issuerId === id || i.targetPersonId === id) && i.status === "pending")
							i.status = "revoked";
				},
				() => {
					bound(actor, "invite");
				},
			);
		},
		list: async (actor: PocketAuthority) => {
			await refresh();
			bound(actor, "invite");
			return freeze({ people: state.people.map(personView), invites: state.invites.map(inviteView) });
		},
		revokeInvite: async (actor: PocketAuthority, id: string) => {
			bound(actor, "invite");
			if (!isId(id)) return deny();
			if (!state.invites.some((i) => i.id === id)) return deny();
			blockedInvites.add(id);
			await mutate(
				(draft) => {
					const invite = draft.invites.find((row) => row.id === id);
					if (!invite) return deny();
					if (invite.status === "pending") invite.status = "revoked";
				},
				() => {
					bound(actor, "invite");
				},
			);
		},
		revokePerson: async (actor: PocketAuthority, id: string) => {
			const issuer = bound(actor, "invite");
			const target = state.people.find((p) => p.id === id);
			if (!target || issuer.p.id === id) return deny();
			if (
				target.active &&
				target.role === "admin" &&
				target.resources === "*" &&
				state.people.filter((p) => p.active && p.role === "admin" && p.resources === "*").length < 2
			)
				return deny();
			blockedPeople.add(id);
			await mutate(
				(draft) => {
					const target = draft.people.find((p) => p.id === id);
					if (!target) return deny();
					target.active = false;
					for (const s of draft.sessions) if (s.personId === id) s.active = false;
					for (const i of draft.invites)
						if (i.issuerId === id && i.status === "pending") i.status = "revoked";
				},
				() => {
					bound(actor, "invite");
				},
			);
		},
		rotate: async (actor: PocketAuthority) => {
			const id = bindings.get(actor);
			if (!id) return deny();
			sessionFor(id);
			return mutate(
				(draft) => {
					const { p } = sessionFor(id),
						previous = draft.sessions.find((s) => s.id === id);
					if (!previous?.active) return deny();
					const issued = makeSession(p);
					previous.active = false;
					draft.sessions.push(issued.saved);
					return issued.issued;
				},
				() => {
					sessionFor(id);
				},
			);
		},
		logout: async (actor: PocketAuthority) => {
			const id = bindings.get(actor);
			if (!id) return deny();
			sessionFor(id);
			blockedSessions.add(id);
			await mutate((draft) => {
				const target = draft.sessions.find((s) => s.id === id);
				if (!target) return deny();
				target.active = false;
			}, ready);
		},
	});
}
