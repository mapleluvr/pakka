import { createHash } from "node:crypto";
import type { ConversationRef, Runtime, RuntimeStore } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "./pocket-people.js";
import { decodeTarget } from "@pakka/protocol/extension-rpc";
import {
	decodeCollaborationRequest,
	decodeCollaborationReceipt,
	decodeCollaborationOutcome,
	collaborationIntent,
	type CollaborationRequest,
	type CollaborationReceipt,
	type CollaborationOutcome,
} from "@pakka/protocol/webui";

/** Definite pre-write refusal only; storage and post-commit failures remain opaque. */
export class PocketCollaborationRefusal extends Error {
	readonly code: "CONFLICT" | "CAPACITY" | "FORBIDDEN" | "INVALID_REQUEST";
	constructor(code: PocketCollaborationRefusal["code"], message: string) {
		super(message);
		this.code = code;
		this.name = "PocketCollaborationRefusal";
	}
}
export class PocketCollaborationConflict extends PocketCollaborationRefusal {
	constructor(message = "Shared note version conflict") {
		super("CONFLICT", message);
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
	write(original: CollaborationRequest): Promise<CollaborationReceipt>;
	/** Current read authority and exact original request; never re-executes an effect. */
	lookup(original: CollaborationRequest): Promise<CollaborationReceipt | null>;
	legacyNote(ref: ConversationRef): Promise<PocketNote>;
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
type LegacyResource = {
	id: string;
	version: number;
	messages: Message[];
	note: PocketNote;
	driver: PocketDriver;
};
type Proof = {
	actorId: string;
	requestId: string;
	target: CollaborationRequest["target"];
	fingerprint: string;
	version: number;
	at: number;
	result: CollaborationOutcome;
};
type Resource = LegacyResource & { requests: Proof[]; driverGeneration?: number };
type State = { schema: 3; sessionId: string; resources: Resource[] };
type Effect =
	| { kind: "post"; message: PocketChatMessage }
	| { kind: "note"; note: PocketNote }
	| { kind: "react" }
	| { kind: "pin" }
	| { kind: "driver"; driver: PocketDriver };
const MAX_BYTES = 1024 * 1024,
	MAX_MESSAGES = 256,
	MAX_REQUESTS = 2048;
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
function resource(v: unknown): v is LegacyResource {
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
function proof(value: unknown): value is Proof {
	if (
		!closed(value, ["actorId", "requestId", "target", "fingerprint", "version", "at", "result"]) ||
		!id(value.actorId) ||
		!id(value.requestId) ||
		!count(value.version) ||
		value.version < 1 ||
		!count(value.at) ||
		typeof value.fingerprint !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.fingerprint)
	)
		return false;
	try {
		decodeTarget(value.target);
		decodeCollaborationOutcome(value.result);
		return true;
	} catch {
		return false;
	}
}
function storedResource(value: unknown): value is Resource {
	if (
		!closed(value, ["id", "version", "messages", "note", "driver", "requests", "driverGeneration"]) ||
		(value.driverGeneration !== undefined && !count(value.driverGeneration)) ||
		!resource({
			id: value.id,
			version: value.version,
			messages: value.messages,
			note: value.note,
			driver: value.driver,
		}) ||
		!Array.isArray(value.requests) ||
		value.requests.length > MAX_REQUESTS ||
		!value.requests.every(proof)
	)
		return false;
	const requests = value.requests,
		version = value.version;
	return (
		count(version) &&
		requests.every((entry) => entry.version <= version) &&
		new Set(requests.map((entry) => JSON.stringify([entry.actorId, entry.requestId]))).size ===
			requests.length
	);
}
function decode(raw: unknown, sessionId: string, version: number): State {
	if (version === 0 && isRecord(raw) && Object.keys(raw).length === 0)
		return { schema: 3, sessionId, resources: [] };
	if (
		!closed(raw, ["schema", "sessionId", "resources"]) ||
		raw.sessionId !== sessionId ||
		!Array.isArray(raw.resources) ||
		raw.resources.length > 1024
	)
		throw new Error("WebUI collaboration storage unconfirmed");
	if (
		raw.schema === 1 &&
		raw.resources.every(resource) &&
		new Set(raw.resources.map((row) => row.id)).size === raw.resources.length
	)
		return {
			schema: 3,
			sessionId,
			resources: raw.resources.map((row) => ({ ...row, requests: [], driverGeneration: 0 })),
		};
	if (
		(raw.schema === 2 || raw.schema === 3) &&
		raw.resources.every(storedResource) &&
		(raw.schema !== 3 || raw.resources.every((row) => count(row.driverGeneration))) &&
		new Set(raw.resources.map((row) => row.id)).size === raw.resources.length
	)
		return {
			schema: 3,
			sessionId,
			resources: raw.resources.map((row) => ({ ...row, driverGeneration: row.driverGeneration ?? 0 })),
		};
	throw new Error("WebUI collaboration storage unconfirmed");
}
/** Explicit finite JSON projection; public interface types are not asserted to be indexed metadata. */
function metadata(state: State): Parameters<RuntimeStore["compareAndSet"]>[1] {
	return {
		schema: state.schema,
		sessionId: state.sessionId,
		resources: state.resources.map((row) => ({
			id: row.id,
			version: row.version,
			note: { ...row.note },
			driver: { ...row.driver },
			driverGeneration: row.driverGeneration ?? 0,
			messages: row.messages.map((message) => ({
				...message,
				mentions: [...message.mentions],
				reactions: message.reactions.map((reaction) => ({
					emoji: reaction.emoji,
					people: [...reaction.people],
				})),
			})),
			requests: row.requests.map((entry) => ({
				...entry,
				target: { ...entry.target },
				result:
					entry.result.kind === "driver"
						? { kind: "driver", driver: { ...entry.result.driver } }
						: { ...entry.result },
			})),
		})),
	};
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
	let state: State = { schema: 3, sessionId, resources: [] },
		version = 0,
		available = true,
		tail: Promise<unknown> = Promise.resolve();
	const live = new Map<string, Map<string, { value: PocketPresence; check: () => void }>>(),
		pendingDriver = new Map<string, number>();
	const ready = () => {
		if (!available || runtime.view().phase !== "ready") throw new Error("WebUI collaboration unavailable");
	};
	const chat = () => {
		if (people.mode().personal)
			throw new PocketCollaborationRefusal("FORBIDDEN", "Personal mode has no human collaboration");
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
				requests: [],
				driverGeneration: people.mode().generation,
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
		chat();
		const generation = people.mode().generation;
		const checkChat = () => {
			chat();
			if (generation !== people.mode().generation)
				throw new PocketCollaborationRefusal("FORBIDDEN", "Mode changed");
		};
		const operation = tail.then(async () => {
			await refresh();
			checkChat();
			read(actor, saved, permission);
			const draft = structuredClone(state),
				resource = row(draft, saved),
				before = JSON.stringify(draft),
				result = effect(resource);
			if (JSON.stringify(draft) !== before) {
				resource.version++;
				decode(draft, sessionId, version + 1);
				if (Buffer.byteLength(JSON.stringify(draft)) > MAX_BYTES)
					throw new PocketCollaborationRefusal("CAPACITY", "Collaboration capacity exceeded");
				const data = metadata(draft);
				try {
					const committed = await store.compareAndSet(version, data, () => {
						checkChat();
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

	const requestFingerprint = (request: CollaborationRequest) =>
		createHash("sha256").update(collaborationIntent(request)).digest("hex");
	const receipt = (request: CollaborationRequest, saved: Proof) =>
		decodeCollaborationReceipt({
			actorId: saved.actorId,
			original: request,
			version: saved.version,
			at: saved.at,
			result: saved.result,
		});
	const outcome = (effect: Effect): CollaborationOutcome => {
		switch (effect.kind) {
			case "post":
				return { kind: "post", messageId: effect.message.id };
			case "note":
				return { kind: "note", version: effect.note.version };
			case "driver":
				return { kind: "driver", driver: effect.driver };
			case "react":
				return { kind: "react" };
			case "pin":
				return { kind: "pin" };
		}
	};
	function apply(actor: PocketAuthority, request: CollaborationRequest, row: Resource): Effect {
		const { target, action } = request,
			person = people.current(actor);
		switch (action.kind) {
			case "post": {
				const saved = {
					requestId: request.requestId,
					text: action.text.trim(),
					quoteId: action.quoteId ?? null,
					mentions: [...(action.mentions ?? [])].sort(),
				};
				const digest = fingerprint(saved);
				const previous = row.messages.find(
					(message) => message.authorId === person.id && message.requestId === saved.requestId,
				);
				if (previous) {
					if (previous.fingerprint !== digest)
						throw new PocketCollaborationConflict("Human chat request conflict");
					return { kind: "post", message: viewMessage(previous) };
				}
				if (row.messages.length >= MAX_MESSAGES)
					throw new PocketCollaborationRefusal("CAPACITY", "Human chat capacity exceeded");
				if (saved.quoteId && !row.messages.some((message) => message.id === saved.quoteId))
					throw new PocketCollaborationRefusal("INVALID_REQUEST", "Unknown quote in this resource");
				for (const mention of saved.mentions) {
					try {
						people.authorizePerson(mention, "read", people.resourceId(target));
					} catch {
						throw new PocketCollaborationRefusal("FORBIDDEN", "Human mention resource denied");
					}
				}
				const message: Message = {
					...saved,
					id: "chat-" + fingerprint([people.resourceId(target), person.id, saved.requestId]).slice(0, 40),
					authorId: person.id,
					authorName: person.name,
					createdAt: time(),
					pinned: false,
					reactions: [],
					fingerprint: digest,
				};
				row.messages.push(message);
				return { kind: "post", message: viewMessage(message) };
			}
			case "note":
				throw new PocketCollaborationRefusal("INVALID_REQUEST", "Singleton notes are read-only");
			case "react": {
				const message = row.messages.find((message) => message.id === action.messageId);
				if (!message)
					throw new PocketCollaborationRefusal("INVALID_REQUEST", "Unknown message in this resource");
				let reaction = message.reactions.find((reaction) => reaction.emoji === action.emoji);
				if (!reaction && action.active) {
					reaction = { emoji: action.emoji, people: [] };
					message.reactions.push(reaction);
				}
				if (reaction) {
					reaction.people = action.active
						? [...new Set([...reaction.people, person.id])].sort()
						: reaction.people.filter((id) => id !== person.id);
					message.reactions = message.reactions.filter((reaction) => reaction.people.length > 0);
				}
				return { kind: "react" };
			}
			case "pin": {
				const message = row.messages.find((message) => message.id === action.messageId);
				if (!message)
					throw new PocketCollaborationRefusal("INVALID_REQUEST", "Unknown message in this resource");
				message.pinned = action.pinned;
				return { kind: "pin" };
			}
			case "driver": {
				if (people.mode().personal)
					throw new PocketCollaborationRefusal("FORBIDDEN", "Personal mode has no human driver lease");
				const current = currentDriver(row);
				row.driver = current;
				row.driverGeneration = people.mode().generation;
				if (row.driver.version !== action.expectedVersion)
					throw new PocketCollaborationConflict("Driver version conflict");
				if (action.action === "release") {
					if (row.driver.personId !== person.id) read(actor, target, "manage");
					row.driver = { version: row.driver.version + 1, personId: null, expiresAt: null };
				} else {
					if (action.action === "take") read(actor, target, "manage");
					else if (
						row.driver.personId &&
						row.driver.personId !== person.id &&
						row.driver.expiresAt !== null &&
						row.driver.expiresAt > time()
					)
						throw new PocketCollaborationConflict("Another driver holds the lease");
					if (action.ttlMs === undefined)
						throw new PocketCollaborationRefusal("INVALID_REQUEST", "Missing finite driver lease");
					row.driver = {
						version: row.driver.version + 1,
						personId: person.id,
						expiresAt: time() + action.ttlMs,
					};
				}
				return { kind: "driver", driver: row.driver };
			}
		}
	}
	async function runAction<T>(
		actor: PocketAuthority,
		request: CollaborationRequest,
		effect: (row: Resource) => T,
	): Promise<T> {
		const permission =
			request.action.kind === "driver"
				? "steer"
				: ["note", "pin"].includes(request.action.kind)
					? "send"
					: "read";
		read(actor, request.target, permission);
		if (request.action.kind === "driver" && request.action.action === "take")
			read(actor, request.target, "manage");
		const key = people.resourceId(request.target),
			controlsDriver = request.action.kind === "driver";
		if (controlsDriver) pendingDriver.set(key, (pendingDriver.get(key) ?? 0) + 1);
		try {
			return await mutate(actor, request.target, permission, effect);
		} finally {
			if (controlsDriver) {
				const remaining = (pendingDriver.get(key) ?? 1) - 1;
				if (remaining) pendingDriver.set(key, remaining);
				else pendingDriver.delete(key);
			}
		}
	}
	const legacy = (
		actor: PocketAuthority,
		target: ConversationRef,
		action: CollaborationRequest["action"],
		requestId = "native-collaboration",
	) => {
		const request = decodeCollaborationRequest({ requestId, target, action });
		return runAction(actor, request, (row) => apply(actor, request, row));
	};
	async function lookup(
		actor: PocketAuthority,
		original: CollaborationRequest,
	): Promise<CollaborationReceipt | null> {
		const request = decodeCollaborationRequest(original);
		const currentRef = () => {
			const ref = runtimeFor(request.target)
				.view()
				.conversations.find(
					(ref) =>
						ref.key === request.target.key &&
						ref.sessionId === request.target.sessionId &&
						ref.conversationId === request.target.conversationId,
				);
			if (!ref) throw new Error("Original collaboration resource unavailable");
			read(actor, ref);
			return ref;
		};
		currentRef();
		await refresh();
		const person = people.current(actor),
			ref = currentRef();
		const found = existing(ref)?.requests.find(
			(entry) => entry.actorId === person.id && entry.requestId === request.requestId,
		);
		if (!found) return null;
		if (found.fingerprint !== requestFingerprint(request))
			throw new PocketCollaborationConflict("Original collaboration request conflict");
		return receipt(request, found);
	}
	function currentDriver(row: Resource): PocketDriver {
		const mode = people.mode();
		return mode.personal || (row.driverGeneration ?? 0) !== mode.generation
			? { version: row.driver.version, personId: null, expiresAt: null }
			: row.driver;
	}
	const checkDriver = (actorId: string, ref: ConversationRef) => {
		if (people.mode().personal) return;
		if (pendingDriver.has(people.resourceId(ref))) throw new Error("Driver transition pending");
		const resource = existing(ref);
		const d = resource && currentDriver(resource);
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
				throw new Error("WebUI collaboration stale resource denied");
			checkDriver(actorId, ref);
		},
		bind(actor: PocketAuthority): PocketCollaborationClient {
			people.current(actor);
			return Object.freeze({
				legacyNote: async (ref: ConversationRef) => {
					const saved = structuredClone(ref);
					read(actor, saved);
					await refresh();
					read(actor, saved);
					return frozen(
						structuredClone(
							existing(saved)?.note ?? { text: "", version: 0, authorId: null, updatedAt: null },
						),
					);
				},
				snapshot: async (ref: ConversationRef) => {
					chat();
					const saved = structuredClone(ref);
					read(actor, saved);
					await refresh();
					const found = existing(saved) ?? row({ schema: 3, sessionId, resources: [] }, saved),
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
					chat();
					return frozen({
						conversationId: saved.conversationId,
						...(saved.sessionId === sessionId ? {} : { sessionId: saved.sessionId }),
						version: found.version,
						messages: found.messages.map(viewMessage),
						note: found.note,
						driver: currentDriver(found),
						presence,
					});
				},
				write: async (original: CollaborationRequest) => {
					const request = decodeCollaborationRequest(original);
					return runAction(actor, request, (row) => {
						const person = people.current(actor),
							digest = requestFingerprint(request);
						const prior = row.requests.find(
							(entry) => entry.actorId === person.id && entry.requestId === request.requestId,
						);
						if (prior) {
							if (prior.fingerprint !== digest)
								throw new PocketCollaborationConflict("Original collaboration request conflict");
							return receipt(request, prior);
						}
						if (row.requests.length >= MAX_REQUESTS)
							throw new PocketCollaborationRefusal("CAPACITY", "Collaboration request capacity exceeded");
						const effect = apply(actor, request, row);
						const saved: Proof = {
							actorId: person.id,
							requestId: request.requestId,
							target: request.target,
							fingerprint: digest,
							version: row.version + 1,
							at: time(),
							result: outcome(effect),
						};
						const confirmed = receipt(request, saved);
						row.requests.push(saved);
						return confirmed;
					});
				},
				lookup: (original: CollaborationRequest) => lookup(actor, original),
				post: async (ref: ConversationRef, input: PocketChatInput) => {
					if (!closed(input, ["requestId", "text", "quoteId", "mentions"]))
						throw new Error("Invalid finite human chat");
					const { requestId, ...action } = input;
					const result = await legacy(actor, ref, { kind: "post", ...action }, requestId);
					if (result.kind !== "post") throw new Error("Invalid human chat result");
					return result.message;
				},
				editNote: async (
					ref: ConversationRef,
					input: { readonly expectedVersion: number; readonly text: string },
				) => {
					if (!closed(input, ["expectedVersion", "text"])) throw new Error("Invalid versioned note");
					const result = await legacy(actor, ref, { kind: "note", ...input });
					if (result.kind !== "note") throw new Error("Invalid note result");
					return result.note;
				},
				react: async (
					ref: ConversationRef,
					input: { readonly messageId: string; readonly emoji: string; readonly active: boolean },
				) => {
					if (!closed(input, ["messageId", "emoji", "active"])) throw new Error("Invalid human reaction");
					await legacy(actor, ref, { kind: "react", ...input });
				},
				pin: async (
					ref: ConversationRef,
					input: { readonly messageId: string; readonly pinned: boolean },
				) => {
					if (!closed(input, ["messageId", "pinned"])) throw new Error("Invalid shared pin");
					await legacy(actor, ref, { kind: "pin", ...input });
				},
				setDriver: async (ref: ConversationRef, input: PocketDriverInput) => {
					if (!closed(input, ["expectedVersion", "action", "ttlMs"]))
						throw new Error("Invalid finite driver lease");
					const result = await legacy(actor, ref, { kind: "driver", ...input });
					if (result.kind !== "driver") throw new Error("Invalid driver result");
					return result.driver;
				},
				presence: async (
					ref: ConversationRef,
					input: { readonly state: "here" | "typing" | "away" | "leave" },
				) => {
					chat();
					const generation = people.mode().generation;
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
								chat();
								if (generation !== people.mode().generation) throw Error("Mode changed");
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
