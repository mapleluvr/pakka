import { createHash } from "node:crypto";
import type { ConversationRef, Runtime, RuntimeStore } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "./pocket-people.js";

/** Raised only by a local pre-write CAS guard; never used for storage or opaque callback failures. */
export class PocketCollaborationConflict extends Error {
	constructor() {
		super("Shared note version conflict");
		this.name = "PocketCollaborationConflict";
	}
}

export interface PocketReaction {
	readonly emoji: string;
	readonly people: readonly string[];
}
export interface PocketChatMessage {
	readonly id: string;
	readonly requestId: string;
	readonly authorId: string;
	readonly authorName: string;
	readonly text: string;
	readonly createdAt: number;
	readonly quoteId: string | null;
	readonly mentions: readonly string[];
	readonly pinned: boolean;
	readonly reactions: readonly PocketReaction[];
}
export interface PocketNote {
	readonly version: number;
	readonly text: string;
	readonly authorId: string | null;
	readonly updatedAt: number | null;
}
export interface PocketDriver {
	readonly version: number;
	readonly personId: string | null;
	readonly expiresAt: number | null;
}
export interface PocketPresence {
	readonly personId: string;
	readonly name: string;
	readonly state: "here" | "typing";
	readonly expiresAt: number;
}
export interface PocketCollaborationView {
	readonly conversationId: string;
	readonly version: number;
	readonly messages: readonly PocketChatMessage[];
	readonly note: PocketNote;
	readonly driver: PocketDriver;
	readonly presence: readonly PocketPresence[];
}
export interface PocketChatInput {
	readonly requestId: string;
	readonly text: string;
	readonly quoteId?: string;
	readonly mentions?: readonly string[];
}
export interface PocketDriverInput {
	readonly expectedVersion: number;
	readonly action: "claim" | "release" | "take";
	readonly ttlMs?: number;
}
export interface PocketCollaborationClient {
	snapshot(ref: ConversationRef): Promise<PocketCollaborationView>;
	post(ref: ConversationRef, input: PocketChatInput): Promise<PocketChatMessage>;
	editNote(
		ref: ConversationRef,
		input: { readonly expectedVersion: number; readonly text: string },
	): Promise<PocketNote>;
	react(
		ref: ConversationRef,
		input: { readonly messageId: string; readonly emoji: string; readonly active: boolean },
	): Promise<void>;
	pin(ref: ConversationRef, input: { readonly messageId: string; readonly pinned: boolean }): Promise<void>;
	setDriver(ref: ConversationRef, input: PocketDriverInput): Promise<PocketDriver>;
	presence(
		ref: ConversationRef,
		input: { readonly state: "here" | "typing" | "away" | "leave" },
	): Promise<void>;
}
export interface PocketCollaboration {
	bind(actor: PocketAuthority): PocketCollaborationClient;
	/** Synchronous final-effect guard composed into native admission by the host. */
	checkInput(actor: PocketAuthority, ref: ConversationRef): void;
	/** Trusted native jobs recheck a persisted person, without minting a login/session authority. */
	checkScheduledInput(actorId: string, ref: ConversationRef): void;
}
export interface PocketCollaborationOptions {
	readonly runtime: Runtime;
	readonly runtimeFor?: (ref: ConversationRef) => Runtime;
	readonly people: PocketPeople;
	readonly namespace: string;
	readonly now?: () => number;
}
type Message = Omit<
	{ -readonly [K in keyof PocketChatMessage]: PocketChatMessage[K] },
	"mentions" | "reactions"
> & { mentions: string[]; reactions: { emoji: string; people: string[] }[]; fingerprint: string };
type Resource = { id: string; version: number; messages: Message[]; note: PocketNote; driver: PocketDriver };
type State = { schema: 1; sessionId: string; resources: Resource[] };
const MAX_BYTES = 1024 * 1024,
	MAX_MESSAGES = 256;
const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);
const closed = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
	isRecord(v) && Object.keys(v).every((k) => keys.includes(k));
const id = (v: unknown): v is string =>
	typeof v === "string" && /^[a-zA-Z0-9][-a-zA-Z0-9._:]{0,159}$/.test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && typeof v === "number" && v >= 0;
const text = (v: unknown, max: number): v is string =>
	typeof v === "string" && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const emoji = (v: unknown): v is string =>
	typeof v === "string" && ["👍", "👎", "❤️", "🎉", "👀", "✅"].includes(v);
function unique(v: unknown, max: number): v is string[] {
	return Array.isArray(v) && v.length <= max && v.every(id) && new Set(v).size === v.length;
}
function note(v: unknown): v is PocketNote {
	return (
		closed(v, ["version", "text", "authorId", "updatedAt"]) &&
		count(v.version) &&
		text(v.text, 32768) &&
		(v.authorId === null || id(v.authorId)) &&
		(v.updatedAt === null || count(v.updatedAt)) &&
		((v.version === 0 && v.authorId === null && v.updatedAt === null && v.text === "") ||
			(v.version > 0 && id(v.authorId) && count(v.updatedAt)))
	);
}
function driver(v: unknown): v is PocketDriver {
	return (
		closed(v, ["version", "personId", "expiresAt"]) &&
		count(v.version) &&
		((v.personId === null && v.expiresAt === null) || (id(v.personId) && count(v.expiresAt)))
	);
}
function message(v: unknown): v is Message {
	return (
		closed(v, [
			"id",
			"requestId",
			"authorId",
			"authorName",
			"text",
			"createdAt",
			"quoteId",
			"mentions",
			"pinned",
			"reactions",
			"fingerprint",
		]) &&
		id(v.id) &&
		id(v.requestId) &&
		id(v.authorId) &&
		text(v.authorName, 80) &&
		v.authorName.length > 0 &&
		text(v.text, 8192) &&
		v.text.trim().length > 0 &&
		count(v.createdAt) &&
		(v.quoteId === null || id(v.quoteId)) &&
		unique(v.mentions, 16) &&
		typeof v.pinned === "boolean" &&
		typeof v.fingerprint === "string" &&
		/^[a-f0-9]{64}$/.test(v.fingerprint) &&
		Array.isArray(v.reactions) &&
		v.reactions.length <= 6 &&
		v.reactions.every((r) => closed(r, ["emoji", "people"]) && emoji(r.emoji) && unique(r.people, 128)) &&
		new Set(v.reactions.map((r) => r.emoji)).size === v.reactions.length
	);
}
function resource(v: unknown): v is Resource {
	if (
		!closed(v, ["id", "version", "messages", "note", "driver"]) ||
		!id(v.id) ||
		!count(v.version) ||
		!note(v.note) ||
		!driver(v.driver)
	)
		return false;
	const messages = v.messages;
	return (
		Array.isArray(messages) &&
		messages.length <= MAX_MESSAGES &&
		messages.every(message) &&
		new Set(messages.map((m) => m.id)).size === messages.length &&
		new Set(messages.map((m) => JSON.stringify([m.authorId, m.requestId]))).size === messages.length &&
		messages.every(
			(m, index) => m.quoteId === null || messages.slice(0, index).some((q) => q.id === m.quoteId),
		)
	);
}
function decode(raw: unknown, sessionId: string, version: number): State {
	if (version === 0 && isRecord(raw) && Object.keys(raw).length === 0)
		return { schema: 1, sessionId, resources: [] };
	if (
		!closed(raw, ["schema", "sessionId", "resources"]) ||
		raw.schema !== 1 ||
		raw.sessionId !== sessionId ||
		!Array.isArray(raw.resources) ||
		raw.resources.length > 1024 ||
		!raw.resources.every(resource) ||
		new Set(raw.resources.map((r) => r.id)).size !== raw.resources.length
	)
		throw new Error("WebUI collaboration storage unconfirmed");
	return { schema: 1, sessionId, resources: raw.resources };
}
const fingerprint = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function frozen<T>(v: T): T {
	if (v && typeof v === "object") {
		for (const child of Object.values(v)) frozen(child);
		Object.freeze(v);
	}
	return v;
}
const opened = new WeakMap<
	Runtime,
	Map<string, { people: PocketPeople; now: () => number; value: Promise<PocketCollaboration> }>
>();
export function createPocketCollaboration(options: PocketCollaborationOptions): Promise<PocketCollaboration> {
	const now = options.now ?? Date.now;
	let map = opened.get(options.runtime);
	if (!map) {
		map = new Map();
		opened.set(options.runtime, map);
	}
	const prior = map.get(options.namespace);
	if (prior) {
		if (prior.people !== options.people || prior.now !== now)
			throw new Error("Collaboration owner options conflict");
		return prior.value;
	}
	const value = open(options, now);
	map.set(options.namespace, { people: options.people, now, value });
	return value;
}
async function open(
	{ runtime, people, namespace, runtimeFor = () => runtime }: PocketCollaborationOptions,
	now: () => number,
): Promise<PocketCollaboration> {
	const store = runtime.store({ namespace, maxBytes: MAX_BYTES }),
		sessionId = runtime.view().sessionId;
	let state: State = { schema: 1, sessionId, resources: [] },
		version = 0,
		available = true,
		tail: Promise<unknown> = Promise.resolve();
	const live = new Map<string, Map<string, { value: PocketPresence; check: () => void }>>(),
		pendingDriver = new Map<string, number>();
	const ready = () => {
		if (!available || runtime.view().phase !== "ready") throw new Error("WebUI collaboration unavailable");
	};
	const time = () => {
		const value = now();
		if (!count(value)) throw new Error("Invalid finite collaboration clock");
		return value;
	};
	const read = (
		actor: PocketAuthority,
		ref: ConversationRef,
		permission: "read" | "send" | "steer" | "manage" = "read",
	) => {
		ready();
		people.check(actor, permission, people.resourceId(ref));
		if (
			!runtimeFor(ref)
				.view()
				.conversations.some((r) =>
					["key", "sessionId", "conversationId", "incarnation", "profile"].every(
						(k) => r[k as keyof ConversationRef] === ref[k as keyof ConversationRef],
					),
				)
		)
			throw new Error("WebUI collaboration stale resource denied");
		return people.current(actor);
	};
	const refresh = async () => {
		ready();
		try {
			const snapshot = await store.snapshot();
			const data = decode(snapshot.data, sessionId, snapshot.version);
			ready();
			if (snapshot.version >= version) {
				state = data;
				version = snapshot.version;
			}
		} catch (error) {
			available = false;
			throw error;
		}
	};
	const row = (draft: State, ref: ConversationRef) => {
		let found = draft.resources.find((r) => r.id === people.resourceId(ref));
		if (!found) {
			found = {
				id: people.resourceId(ref),
				version: 0,
				messages: [],
				note: { version: 0, text: "", authorId: null, updatedAt: null },
				driver: { version: 0, personId: null, expiresAt: null },
			};
			draft.resources.push(found);
		}
		return found;
	};
	const existing = (ref: ConversationRef) => state.resources.find((r) => r.id === people.resourceId(ref));
	async function mutate<T>(
		actor: PocketAuthority,
		ref: ConversationRef,
		permission: "read" | "send" | "steer" | "manage",
		effect: (r: Resource) => T,
	): Promise<T> {
		const saved = structuredClone(ref);
		read(actor, saved, permission);
		const operation = tail.then(async () => {
			await refresh();
			read(actor, saved, permission);
			const draft = structuredClone(state),
				resource = row(draft, saved),
				before = JSON.stringify(draft),
				result = effect(resource);
			if (JSON.stringify(draft) !== before) {
				resource.version++;
				decode(draft, sessionId, version + 1);
				if (Buffer.byteLength(JSON.stringify(draft)) > MAX_BYTES)
					throw new Error("Collaboration capacity exceeded");
				// SAFETY: decode validates every finite JSON field above; State contains no function, native handle or undefined member.
				const data = draft as unknown as Parameters<RuntimeStore["compareAndSet"]>[1];
				try {
					const committed = await store.compareAndSet(version, data, () => {
						read(actor, saved, permission);
					});
					state = decode(committed.data, sessionId, committed.version);
					version = committed.version;
				} catch (error) {
					if (runtime.view().phase !== "ready") available = false;
					throw error;
				}
			}
			read(actor, saved, permission);
			return frozen(structuredClone(result));
		});
		tail = operation.then(
			() => {},
			() => {},
		);
		return operation;
	}
	const viewMessage = (m: Message): PocketChatMessage => {
		const { fingerprint: _, ...publicMessage } = m;
		return publicMessage;
	};
	const checkDriver = (actorId: string, ref: ConversationRef) => {
		if (pendingDriver.has(people.resourceId(ref))) throw new Error("Driver transition pending");
		const d = existing(ref)?.driver;
		if (d?.personId) {
			people.authorizePerson(d.personId, "steer", people.resourceId(ref));
			if (d.personId !== actorId || d.expiresAt === null || d.expiresAt <= time())
				throw new Error("Current driver lease denied or expired");
		}
	};
	await refresh();
	return Object.freeze({
		checkInput: (actor: PocketAuthority, ref: ConversationRef) => checkDriver(read(actor, ref).id, ref),
		checkScheduledInput: (actorId: string, ref: ConversationRef) => {
			ready();
			people.authorizePerson(actorId, "steer", people.resourceId(ref));
			if (
				!runtimeFor(ref)
					.view()
					.conversations.some((row) =>
						["key", "sessionId", "conversationId", "incarnation", "profile"].every(
							(key) => row[key as keyof ConversationRef] === ref[key as keyof ConversationRef],
						),
					)
			)
				throw Error("WebUI collaboration stale resource denied");
			checkDriver(actorId, ref);
		},
		bind(actor: PocketAuthority): PocketCollaborationClient {
			people.current(actor);
			return Object.freeze({
				snapshot: async (ref: ConversationRef) => {
					const saved = structuredClone(ref);
					read(actor, saved);
					await refresh();
					const found = existing(saved) ?? row({ schema: 1, sessionId, resources: [] }, saved),
						presence: PocketPresence[] = [];
					for (const [id, entry] of live.get(people.resourceId(saved)) ?? []) {
						try {
							entry.check();
							if (entry.value.expiresAt <= time()) throw new Error("Expired presence");
							presence.push(entry.value);
						} catch {
							live.get(people.resourceId(saved))?.delete(id);
						}
					}
					read(actor, saved);
					return frozen({
						conversationId: saved.conversationId,
						...(saved.sessionId === sessionId ? {} : { sessionId: saved.sessionId }),
						version: found.version,
						messages: found.messages.map(viewMessage),
						note: found.note,
						driver: found.driver,
						presence,
					});
				},
				post: async (ref: ConversationRef, input: PocketChatInput) => {
					const person = read(actor, ref);
					if (
						!closed(input, ["requestId", "text", "quoteId", "mentions"]) ||
						!id(input.requestId) ||
						!text(input.text, 8192) ||
						!input.text.trim() ||
						(input.quoteId !== undefined && !id(input.quoteId)) ||
						(input.mentions !== undefined && !unique(input.mentions, 16))
					)
						throw new Error("Invalid finite human chat");
					const saved = {
							requestId: input.requestId,
							text: input.text.trim(),
							quoteId: input.quoteId ?? null,
							mentions: [...(input.mentions ?? [])].sort(),
						},
						digest = fingerprint(saved),
						key = "chat-" + fingerprint([people.resourceId(ref), person.id, saved.requestId]).slice(0, 40);
					const result = await mutate(actor, ref, "read", (r) => {
						const prior = r.messages.find((m) => m.authorId === person.id && m.requestId === saved.requestId);
						if (prior) {
							if (prior.fingerprint !== digest) throw new Error("Human chat request conflict");
							return prior;
						}
						if (r.messages.length >= MAX_MESSAGES) throw new Error("Human chat capacity exceeded");
						if (saved.quoteId && !r.messages.some((m) => m.id === saved.quoteId))
							throw new Error("Unknown quote in this resource");
						for (const mention of saved.mentions)
							people.authorizePerson(mention, "read", people.resourceId(ref));
						const message: Message = {
							...saved,
							id: key,
							authorId: person.id,
							authorName: person.name,
							createdAt: time(),
							pinned: false,
							reactions: [],
							fingerprint: digest,
						};
						r.messages.push(message);
						return message;
					});
					return frozen(viewMessage(result));
				},
				editNote: (
					ref: ConversationRef,
					input: { readonly expectedVersion: number; readonly text: string },
				) => {
					if (
						!closed(input, ["expectedVersion", "text"]) ||
						!count(input.expectedVersion) ||
						!text(input.text, 32768)
					)
						return Promise.reject(new Error("Invalid versioned note"));
					const saved = { ...input };
					return mutate(actor, ref, "send", (r) => {
						if (r.note.version !== saved.expectedVersion) throw new PocketCollaborationConflict();
						r.note = {
							version: r.note.version + 1,
							text: saved.text,
							authorId: people.current(actor).id,
							updatedAt: time(),
						};
						return r.note;
					});
				},
				react: (
					ref: ConversationRef,
					input: { readonly messageId: string; readonly emoji: string; readonly active: boolean },
				) => {
					if (
						!closed(input, ["messageId", "emoji", "active"]) ||
						!id(input.messageId) ||
						!emoji(input.emoji) ||
						typeof input.active !== "boolean"
					)
						return Promise.reject(new Error("Invalid human reaction"));
					const saved = { ...input };
					return mutate(actor, ref, "read", (r) => {
						const message = r.messages.find((m) => m.id === saved.messageId);
						if (!message) throw new Error("Unknown message in this resource");
						const who = people.current(actor).id;
						let reaction = message.reactions.find((r) => r.emoji === saved.emoji);
						if (!reaction && saved.active) {
							reaction = { emoji: saved.emoji, people: [] };
							message.reactions.push(reaction);
						}
						if (reaction) {
							reaction.people = saved.active
								? [...new Set([...reaction.people, who])].sort()
								: reaction.people.filter((p) => p !== who);
							message.reactions = message.reactions.filter((r) => r.people.length > 0);
						}
					});
				},
				pin: (ref: ConversationRef, input: { readonly messageId: string; readonly pinned: boolean }) => {
					if (
						!closed(input, ["messageId", "pinned"]) ||
						!id(input.messageId) ||
						typeof input.pinned !== "boolean"
					)
						return Promise.reject(new Error("Invalid shared pin"));
					const saved = { ...input };
					return mutate(actor, ref, "send", (r) => {
						const message = r.messages.find((m) => m.id === saved.messageId);
						if (!message) throw new Error("Unknown message in this resource");
						message.pinned = saved.pinned;
					});
				},
				setDriver: async (ref: ConversationRef, input: PocketDriverInput) => {
					if (
						!closed(input, ["expectedVersion", "action", "ttlMs"]) ||
						!count(input.expectedVersion) ||
						!["claim", "release", "take"].includes(String(input.action)) ||
						(input.action !== "release" &&
							(!count(input.ttlMs) || input.ttlMs < 1000 || input.ttlMs > 300000)) ||
						(input.action === "release" && input.ttlMs !== undefined)
					)
						return Promise.reject(new Error("Invalid finite driver lease"));
					const saved = { ...input };
					read(actor, ref, "steer");
					if (saved.action === "take") read(actor, ref, "manage");
					const key = people.resourceId(ref);
					pendingDriver.set(key, (pendingDriver.get(key) ?? 0) + 1);
					return mutate(actor, ref, "steer", (r) => {
						const who = people.current(actor).id;
						if (r.driver.version !== saved.expectedVersion) throw new Error("Driver version conflict");
						if (saved.action === "release") {
							if (r.driver.personId !== who) read(actor, ref, "manage");
							r.driver = { version: r.driver.version + 1, personId: null, expiresAt: null };
						} else {
							if (saved.action === "take") read(actor, ref, "manage");
							else if (
								r.driver.personId &&
								r.driver.personId !== who &&
								r.driver.expiresAt !== null &&
								r.driver.expiresAt > time()
							)
								throw new Error("Another driver holds the lease");
							r.driver = { version: r.driver.version + 1, personId: who, expiresAt: time() + saved.ttlMs! };
						}
						return r.driver;
					}).finally(() => {
						const remaining = (pendingDriver.get(key) ?? 1) - 1;
						if (remaining) pendingDriver.set(key, remaining);
						else pendingDriver.delete(key);
					});
				},
				presence: async (
					ref: ConversationRef,
					input: { readonly state: "here" | "typing" | "away" | "leave" },
				) => {
					const person = read(actor, ref);
					if (
						!closed(input, ["state"]) ||
						typeof input.state !== "string" ||
						!["here", "typing", "away", "leave"].includes(input.state)
					)
						throw new Error("Invalid presence");
					let entries = live.get(people.resourceId(ref));
					if (!entries) {
						entries = new Map();
						live.set(people.resourceId(ref), entries);
					}
					if (input.state === "away" || input.state === "leave") entries.delete(person.id);
					else {
						if (entries.size >= 128 && !entries.has(person.id)) throw new Error("Presence capacity exceeded");
						const saved = structuredClone(ref);
						entries.set(person.id, {
							value: {
								personId: person.id,
								name: person.name,
								state: input.state,
								expiresAt: time() + 30000,
							},
							check: () => {
								read(actor, saved);
							},
						});
					}
					read(actor, ref);
				},
			});
		},
	});
}
