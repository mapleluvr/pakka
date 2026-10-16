import { createHash, randomUUID } from "node:crypto";
import type { ConversationRef, JsonObject, Runtime, RuntimeStoreSnapshot } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "./pocket-people.ts";
import {
	generateVapid,
	postWake,
	validSubscriptionKeys,
	validVapid,
	type PushSubscriptionData,
	type VapidKeys,
} from "./pocket-push.ts";

export type PocketNotificationKind = "done" | "approval" | "chat" | "mention";
export interface PocketNotificationPreferences {
	readonly done: boolean;
	readonly approval: boolean;
	readonly chat: boolean;
	readonly mention: boolean;
}
export interface PocketNotificationStatus {
	readonly publicKey: string;
	readonly preferences: PocketNotificationPreferences;
	readonly devices: readonly { readonly id: string; readonly subscriptionKey: string }[];
}
export interface PocketNotificationEvent {
	readonly id: string;
	readonly kind: PocketNotificationKind;
	readonly preview: string;
	readonly target: ConversationRef;
	readonly createdAt: number;
}
export interface PocketNotificationReceipt {
	readonly id: string;
	/** Push-service acceptance, never proof of OS display. */
	readonly state: "accepted" | "unknown" | "filtered" | "no-devices";
	readonly accepted: number;
}
export interface PocketNotificationClient {
	status(target: ConversationRef): Promise<PocketNotificationStatus>;
	subscribe(
		target: ConversationRef,
		input: { readonly requestId: string; readonly subscription: PushSubscriptionData },
	): Promise<PocketNotificationStatus>;
	unsubscribe(
		target: ConversationRef,
		input: { readonly requestId: string; readonly deviceId: string },
	): Promise<PocketNotificationStatus>;
	preferences(
		target: ConversationRef,
		input: { readonly requestId: string; readonly preferences: Partial<PocketNotificationPreferences> },
	): Promise<PocketNotificationStatus>;
	event(eventId: string, deviceId: string): Promise<PocketNotificationEvent>;
}
export interface PocketNotifications {
	bind(actor: PocketAuthority, check?: () => void): PocketNotificationClient;
	/** Trusted event producer only. Browser requests never supply notification content or recipients. */
	publish(input: {
		readonly requestId: string;
		readonly kind: PocketNotificationKind;
		readonly target: ConversationRef;
		readonly preview: string;
		readonly recipientIds?: readonly string[];
	}): Promise<PocketNotificationReceipt>;
	dispose(): Promise<void>;
}
export interface PocketNotificationsOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly namespace: string;
	/** Exact HTTPS origins approved by the host, not caller-supplied fetch destinations. */
	readonly endpointOrigins: readonly string[];
	readonly subject?: string;
	/** Optional host-approved certificate authority for a private push service. TLS verification remains enabled. */
	readonly trustedCa?: string;
}
type Device = {
	id: string;
	actorId: string;
	subscription: PushSubscriptionData;
	active: boolean;
	resources: string[];
};
type Delivery = {
	deviceId: string;
	fingerprint: string;
	state: "pending" | "running" | "accepted" | "unknown" | "filtered";
};
type Event = {
	id: string;
	requestId: string;
	fingerprint: string;
	target: ConversationRef;
	kind: PocketNotificationKind;
	preview: string;
	createdAt: number;
	deliveries: Delivery[];
};
type Write = {
	actorId: string;
	requestId: string;
	fingerprint: string;
	target: ConversationRef;
	result: PocketNotificationStatus;
};
type State = {
	schema: 1;
	vapid: VapidKeys;
	devices: Device[];
	preferences: { actorId: string; value: PocketNotificationPreferences }[];
	events: Event[];
	writes: Write[];
};
const defaults: PocketNotificationPreferences = Object.freeze({
	done: true,
	approval: true,
	chat: true,
	mention: true,
});
const kinds = ["done", "approval", "chat", "mention"] as const;
const refFields = ["key", "sessionId", "conversationId", "incarnation", "profile"] as const;
const object = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const shape = (value: Record<string, unknown>, fields: readonly string[]) =>
	Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const id = (value: unknown): value is string =>
	typeof value === "string" && /^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const ref = (value: unknown): value is ConversationRef =>
	object(value) &&
	shape(value, refFields) &&
	refFields.every(
		(field) =>
			typeof value[field] === "string" &&
			value[field].length > 0 &&
			value[field].length <= 512 &&
			!/[\x00-\x1f\x7f]/.test(value[field]),
	);
const same = (a: ConversationRef, b: ConversationRef) => refFields.every((field) => a[field] === b[field]);
const preferences = (value: unknown): value is PocketNotificationPreferences =>
	object(value) && shape(value, kinds) && kinds.every((kind) => typeof value[kind] === "boolean");
const kind = (value: unknown): value is PocketNotificationKind =>
	typeof value === "string" && kinds.some((item) => item === value);
const denied = (): never => {
	throw Error("Notification permission denied");
};
const unavailable = (): never => {
	throw Error("Notification persistence unavailable");
};
function endpoint(value: unknown): URL {
	if (typeof value !== "string" || value.length > 4096) throw Error("Invalid push endpoint");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw Error("Invalid push endpoint");
	}
	if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href !== value)
		throw Error("Invalid push endpoint");
	return url;
}
function subscription(value: unknown): PushSubscriptionData {
	if (
		!object(value) ||
		!shape(value, ["endpoint", "keys"]) ||
		typeof value.endpoint !== "string" ||
		!object(value.keys) ||
		!shape(value.keys, ["p256dh", "auth"]) ||
		typeof value.keys.p256dh !== "string" ||
		typeof value.keys.auth !== "string"
	)
		throw Error("Invalid push subscription");
	endpoint(value.endpoint);
	const keys = { p256dh: value.keys.p256dh, auth: value.keys.auth };
	if (!validSubscriptionKeys(keys)) throw Error("Invalid push subscription keys");
	return { endpoint: value.endpoint, keys };
}
function statusValue(value: unknown): PocketNotificationStatus {
	if (
		!object(value) ||
		!shape(value, ["publicKey", "preferences", "devices"]) ||
		typeof value.publicKey !== "string" ||
		!preferences(value.preferences) ||
		!Array.isArray(value.devices)
	)
		return unavailable();
	const devices: { id: string; subscriptionKey: string }[] = [];
	for (const row of value.devices) {
		if (!object(row) || !shape(row, ["id", "subscriptionKey"]) || !id(row.id) || !digest(row.subscriptionKey))
			return unavailable();
		devices.push({ id: row.id, subscriptionKey: row.subscriptionKey });
	}
	return { publicKey: value.publicKey, preferences: { ...value.preferences }, devices };
}
function decode(snapshot: RuntimeStoreSnapshot): State | null {
	const value: unknown = snapshot.data;
	if (snapshot.version === 0 && object(value) && !Object.keys(value).length) return null;
	if (
		!object(value) ||
		!shape(value, ["schema", "vapid", "devices", "preferences", "events", "writes"]) ||
		value.schema !== 1 ||
		!object(value.vapid) ||
		!shape(value.vapid, ["publicKey", "privateKey"]) ||
		typeof value.vapid.publicKey !== "string" ||
		typeof value.vapid.privateKey !== "string" ||
		!Array.isArray(value.devices) ||
		!Array.isArray(value.preferences) ||
		!Array.isArray(value.events) ||
		!Array.isArray(value.writes) ||
		value.devices.length > 128 ||
		value.preferences.length > 128 ||
		value.events.length > 256 ||
		value.writes.length > 512
	)
		return unavailable();
	const vapid = { publicKey: value.vapid.publicKey, privateKey: value.vapid.privateKey };
	if (!validVapid(vapid)) return unavailable();
	const state: State = { schema: 1, vapid, devices: [], preferences: [], events: [], writes: [] };
	const deviceIds = new Set<string>(),
		eventIds = new Set<string>(),
		writeIds = new Set<string>(),
		personIds = new Set<string>();
	for (const row of value.devices) {
		if (
			!object(row) ||
			!shape(row, ["id", "actorId", "subscription", "active", "resources"]) ||
			!id(row.id) ||
			deviceIds.has(row.id) ||
			!id(row.actorId) ||
			typeof row.active !== "boolean" ||
			!Array.isArray(row.resources) ||
			!row.resources.length ||
			row.resources.length > 64
		)
			return unavailable();
		const resources: string[] = [];
		for (const resource of row.resources) {
			if (
				typeof resource !== "string" ||
				!resource.length ||
				resource.length > 512 ||
				resources.includes(resource)
			)
				return unavailable();
			resources.push(resource);
		}
		let saved: PushSubscriptionData;
		try {
			saved = subscription(row.subscription);
		} catch {
			return unavailable();
		}
		deviceIds.add(row.id);
		state.devices.push({
			id: row.id,
			actorId: row.actorId,
			subscription: saved,
			active: row.active,
			resources,
		});
	}
	for (const row of value.preferences) {
		if (
			!object(row) ||
			!shape(row, ["actorId", "value"]) ||
			!id(row.actorId) ||
			personIds.has(row.actorId) ||
			!preferences(row.value)
		)
			return unavailable();
		personIds.add(row.actorId);
		state.preferences.push({ actorId: row.actorId, value: { ...row.value } });
	}
	for (const row of value.events) {
		if (
			!object(row) ||
			!shape(row, [
				"id",
				"requestId",
				"fingerprint",
				"target",
				"kind",
				"preview",
				"createdAt",
				"deliveries",
			]) ||
			!digest(row.id) ||
			eventIds.has(row.id) ||
			!id(row.requestId) ||
			!digest(row.fingerprint) ||
			!ref(row.target) ||
			!kind(row.kind) ||
			typeof row.preview !== "string" ||
			row.preview.length > 512 ||
			typeof row.createdAt !== "number" ||
			!Number.isSafeInteger(row.createdAt) ||
			row.createdAt < 0 ||
			!Array.isArray(row.deliveries) ||
			row.deliveries.length > 128
		)
			return unavailable();
		const deliveries: Delivery[] = [],
			used = new Set<string>();
		for (const delivery of row.deliveries) {
			if (
				!object(delivery) ||
				!shape(delivery, ["deviceId", "fingerprint", "state"]) ||
				!id(delivery.deviceId) ||
				!deviceIds.has(delivery.deviceId) ||
				used.has(delivery.deviceId) ||
				!digest(delivery.fingerprint)
			)
				return unavailable();
			const phase = delivery.state;
			if (
				phase !== "pending" &&
				phase !== "running" &&
				phase !== "accepted" &&
				phase !== "unknown" &&
				phase !== "filtered"
			)
				return unavailable();
			used.add(delivery.deviceId);
			deliveries.push({ deviceId: delivery.deviceId, fingerprint: delivery.fingerprint, state: phase });
		}
		eventIds.add(row.id);
		state.events.push({
			id: row.id,
			requestId: row.requestId,
			fingerprint: row.fingerprint,
			target: { ...row.target },
			kind: row.kind,
			preview: row.preview,
			createdAt: row.createdAt,
			deliveries,
		});
	}
	for (const row of value.writes) {
		if (
			!object(row) ||
			!shape(row, ["actorId", "requestId", "fingerprint", "target", "result"]) ||
			!id(row.actorId) ||
			!id(row.requestId) ||
			!digest(row.fingerprint) ||
			!ref(row.target)
		)
			return unavailable();
		const identity = JSON.stringify([row.actorId, row.requestId]);
		if (writeIds.has(identity)) return unavailable();
		const result = statusValue(row.result);
		if (
			result.publicKey !== vapid.publicKey ||
			result.devices.some(
				(device) => !state.devices.some((saved) => saved.id === device.id && saved.actorId === row.actorId),
			)
		)
			return unavailable();
		writeIds.add(identity);
		state.writes.push({
			actorId: row.actorId,
			requestId: row.requestId,
			fingerprint: row.fingerprint,
			target: { ...row.target },
			result,
		});
	}
	return state;
}
type Wire = string | number | boolean | null | Wire[] | { [key: string]: Wire };
function wire(value: unknown): Wire {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) return value.map(wire);
	if (!object(value)) return unavailable();
	const result: { [key: string]: Wire } = {};
	for (const [key, item] of Object.entries(value)) result[key] = wire(item);
	return result;
}
function data(value: State): JsonObject {
	const result = wire(value);
	if (!result || typeof result !== "object" || Array.isArray(result)) return unavailable();
	return result;
}
const presentStatus = (value: PocketNotificationStatus): PocketNotificationStatus =>
	Object.freeze({
		publicKey: value.publicKey,
		preferences: Object.freeze({ ...value.preferences }),
		devices: Object.freeze(value.devices.map((row) => Object.freeze({ ...row }))),
	});
const present = (event: Event): PocketNotificationReceipt => {
	const accepted = event.deliveries.filter((row) => row.state === "accepted").length;
	const state = !event.deliveries.length
		? "no-devices"
		: event.deliveries.some(
					(row) => row.state === "pending" || row.state === "running" || row.state === "unknown",
			  )
			? "unknown"
			: accepted
				? "accepted"
				: "filtered";
	return Object.freeze({ id: event.id, state, accepted });
};

/** One Runtime writer; unknown native/transport work stays recorded and never silently re-enters. */
export async function createPocketNotifications(
	options: PocketNotificationsOptions,
): Promise<PocketNotifications> {
	const { runtime, people } = options;
	const origins = new Set(
		options.endpointOrigins.map((value) => {
			const url = endpoint(value + "/");
			if (url.origin !== value) throw Error("Invalid approved push origin");
			return value;
		}),
	);
	if (
		!origins.size ||
		origins.size > 16 ||
		(options.trustedCa !== undefined &&
			(typeof options.trustedCa !== "string" || options.trustedCa.length > 65536))
	)
		throw Error("Invalid notification configuration");
	const subject = options.subject ?? "mailto:pakka@example.invalid",
		trustedCa = options.trustedCa;
	if (
		typeof subject !== "string" ||
		subject.length > 256 ||
		!/^(mailto:[^\s@]+@[^\s]+|https:\/\/[^\s]+)$/.test(subject)
	)
		throw Error("Invalid VAPID subject");
	const store = runtime.store({ namespace: options.namespace, maxBytes: 1048576 });
	let closed = false,
		tail: Promise<unknown> = Promise.resolve();
	const stop = new AbortController(),
		active = new Set<Promise<PocketNotificationReceipt>>();
	const blocked = new Set<string>();
	const ready = () => {
		if (closed || runtime.view().phase !== "ready") throw Error("Notification service unavailable");
	};
	const currentRef = (target: ConversationRef) => {
		ready();
		if (!ref(target) || !runtime.view().conversations.some((row) => same(row, target))) return denied();
	};
	async function load() {
		ready();
		const saved = await store.snapshot();
		const value = decode(saved);
		ready();
		return { version: saved.version, value };
	}
	const initial = await load();
	if (!initial.value) {
		const state: State = {
			schema: 1,
			vapid: generateVapid(),
			devices: [],
			preferences: [],
			events: [],
			writes: [],
		};
		decode(await store.compareAndSet(initial.version, data(state), ready));
	}
	const serial = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = tail.then(operation);
		tail = result.then(
			() => {},
			() => {},
		);
		return result;
	};
	async function alter<T>(
		change: (state: State) => { readonly save: boolean; readonly value: T },
		check: () => void,
	): Promise<T> {
		return serial(async () => {
			check();
			const before = await load();
			if (!before.value) return unavailable();
			check();
			const result = change(before.value);
			if (result.save) decode(await store.compareAndSet(before.version, data(before.value), check));
			check();
			return result.value;
		});
	}
	const prefs = (state: State, actorId: string) =>
		state.preferences.find((row) => row.actorId === actorId)?.value ?? defaults;
	const publicStatus = (state: State, actorId: string, target: ConversationRef) =>
		presentStatus({
			publicKey: state.vapid.publicKey,
			preferences: prefs(state, actorId),
			devices: state.devices
				.filter(
					(row) =>
						row.actorId === actorId &&
						row.active &&
						!blocked.has(row.id) &&
						row.resources.includes(target.conversationId),
				)
				.map((row) => ({ id: row.id, subscriptionKey: hash(row.subscription) })),
		});
	function eligible(
		state: State,
		device: Device,
		target: ConversationRef,
		eventKind: PocketNotificationKind,
	): boolean {
		if (
			!device.active ||
			blocked.has(device.id) ||
			!device.resources.includes(target.conversationId) ||
			!prefs(state, device.actorId)[eventKind]
		)
			return false;
		try {
			people.authorizePerson(device.actorId, "read", target.conversationId);
			return true;
		} catch {
			return false;
		}
	}
	async function publish(
		input: Parameters<PocketNotifications["publish"]>[0],
	): Promise<PocketNotificationReceipt> {
		ready();
		if (
			!object(input) ||
			!shape(input, [
				"requestId",
				"kind",
				"target",
				"preview",
				...(Object.hasOwn(input, "recipientIds") ? ["recipientIds"] : []),
			]) ||
			!id(input.requestId) ||
			!kind(input.kind) ||
			!ref(input.target) ||
			typeof input.preview !== "string" ||
			input.preview.length > 512 ||
			(input.recipientIds !== undefined &&
				(!Array.isArray(input.recipientIds) ||
					input.recipientIds.length > 128 ||
					!input.recipientIds.every(id) ||
					new Set(input.recipientIds).size !== input.recipientIds.length))
		)
			throw Error("Invalid native notification event");
		const target = Object.freeze({ ...input.target });
		input = Object.freeze({
			...input,
			target,
			...(input.recipientIds ? { recipientIds: Object.freeze([...input.recipientIds].sort()) } : {}),
		});
		currentRef(target);
		const identity = hash([target.sessionId, target.conversationId, input.requestId]);
		const fingerprint = hash([target, input.kind, input.preview, input.recipientIds ?? null]);
		const claim = await alter<{ event: Event; created: boolean }>(
			(state) => {
				const prior = state.events.find((row) => row.id === identity);
				if (prior) {
					if (prior.fingerprint !== fingerprint) throw Error("Notification event conflict");
					return { save: false, value: { event: prior, created: false } };
				}
				if (state.events.length >= 256) throw Error("Notification event capacity exhausted");
				const event: Event = {
					id: identity,
					requestId: input.requestId,
					fingerprint,
					target,
					kind: input.kind,
					preview: input.preview,
					createdAt: Date.now(),
					deliveries: state.devices
						.filter(
							(device) =>
								(!input.recipientIds || input.recipientIds.includes(device.actorId)) &&
								eligible(state, device, target, input.kind),
						)
						.map((device) => ({
							deviceId: device.id,
							fingerprint: hash(device.subscription),
							state: "pending",
						})),
				};
				state.events.push(event);
				return { save: true, value: { event, created: true } };
			},
			() => currentRef(target),
		);
		if (!claim.created) return present(claim.event);
		for (const delivery of claim.event.deliveries) {
			const check = () => currentRef(target);
			const prepared = await alter((state) => {
				const event = state.events.find((row) => row.id === identity)!;
				const row = event.deliveries.find((item) => item.deviceId === delivery.deviceId)!;
				row.state = "running";
				return { save: true, value: state };
			}, check);
			const device = prepared.devices.find((row) => row.id === delivery.deviceId)!;
			let outcome: Delivery["state"] = "filtered";
			if (
				eligible(prepared, device, target, input.kind) &&
				hash(device.subscription) === delivery.fingerprint &&
				origins.has(endpoint(device.subscription.endpoint).origin)
			) {
				check();
				try {
					const status = await postWake(
						device.subscription,
						prepared.vapid,
						{ eventId: identity, deviceId: device.id },
						{ subject, trustedCa, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(8000)]) },
					);
					outcome = status === 201 || status === 202 ? "accepted" : "unknown";
				} catch {
					outcome = "unknown";
				}
			}
			await alter((state) => {
				state.events
					.find((row) => row.id === identity)!
					.deliveries.find((row) => row.deviceId === device.id)!.state = outcome;
				return { save: true, value: null };
			}, ready);
		}
		const latest = await load();
		const event = latest.value?.events.find((row) => row.id === identity);
		if (!event) return unavailable();
		return present(event);
	}
	return Object.freeze({
		publish(input: Parameters<PocketNotifications["publish"]>[0]) {
			const task = publish(input);
			active.add(task);
			void task.then(
				() => active.delete(task),
				() => active.delete(task),
			);
			return task;
		},
		dispose: async () => {
			if (closed) return;
			closed = true;
			stop.abort();
			await Promise.allSettled([...active]);
		},
		bind(actor: PocketAuthority, check: () => void = () => {}): PocketNotificationClient {
			const actorId = people.current(actor).id;
			const authorize = (target: ConversationRef) => {
				currentRef(target);
				people.check(actor, "read", target.conversationId);
				check();
			};
			const mutate = (
				target: ConversationRef,
				requestId: string,
				fingerprint: string,
				apply: (state: State) => void,
			) => {
				authorize(target);
				if (!id(requestId)) throw Error("Invalid notification request identity");
				return alter(
					(state) => {
						const prior = state.writes.find((row) => row.actorId === actorId && row.requestId === requestId);
						if (prior) {
							if (prior.fingerprint !== fingerprint || !same(prior.target, target))
								throw Error("Notification request conflict");
							return { save: false, value: presentStatus(prior.result) };
						}
						if (state.writes.length >= 512) throw Error("Notification operation capacity exhausted");
						apply(state);
						const result = publicStatus(state, actorId, target);
						state.writes.push({ actorId, requestId, fingerprint, target: { ...target }, result });
						return { save: true, value: result };
					},
					() => authorize(target),
				);
			};
			return Object.freeze({
				status: async (target: ConversationRef) => {
					target = Object.freeze({ ...target });
					authorize(target);
					const state = (await load()).value;
					authorize(target);
					if (!state) return unavailable();
					return publicStatus(state, actorId, target);
				},
				subscribe: async (
					target: ConversationRef,
					input: { readonly requestId: string; readonly subscription: PushSubscriptionData },
				) => {
					target = Object.freeze({ ...target });
					authorize(target);
					if (!object(input) || !shape(input, ["requestId", "subscription"]))
						throw Error("Invalid notification registration");
					const saved = subscription(input.subscription);
					if (!origins.has(endpoint(saved.endpoint).origin)) return denied();
					return mutate(target, input.requestId, hash(["subscribe", saved]), (state) => {
						const existing = state.devices.find(
							(row) =>
								row.actorId === actorId &&
								row.active &&
								!blocked.has(row.id) &&
								hash(row.subscription) === hash(saved),
						);
						if (existing) {
							if (!existing.resources.includes(target.conversationId)) {
								if (existing.resources.length >= 64) throw Error("Notification resource capacity exhausted");
								existing.resources.push(target.conversationId);
							}
							return;
						}
						if (
							state.devices.length >= 128 ||
							state.devices.filter((row) => row.actorId === actorId && row.active).length >= 10
						)
							throw Error("Notification device capacity exhausted");
						for (const row of state.devices)
							if (row.subscription.endpoint === saved.endpoint) {
								row.active = false;
								blocked.add(row.id);
							}
						state.devices.push({
							id: randomUUID(),
							actorId,
							subscription: saved,
							active: true,
							resources: [target.conversationId],
						});
					});
				},
				unsubscribe: async (
					target: ConversationRef,
					input: { readonly requestId: string; readonly deviceId: string },
				) => {
					target = Object.freeze({ ...target });
					authorize(target);
					if (
						!object(input) ||
						!shape(input, ["requestId", "deviceId"]) ||
						!id(input.requestId) ||
						!id(input.deviceId)
					)
						throw Error("Invalid notification unsubscribe");
					const { requestId, deviceId } = input;
					const saved = (await load()).value?.devices.find(
						(row) =>
							row.id === deviceId && row.actorId === actorId && row.resources.includes(target.conversationId),
					);
					authorize(target);
					if (!saved) return denied();
					blocked.add(saved.id);
					return mutate(target, requestId, hash(["unsubscribe", deviceId]), (state) => {
						const row = state.devices.find((row) => row.id === saved.id)!;
						row.active = false;
					});
				},
				preferences: async (
					target: ConversationRef,
					input: { readonly requestId: string; readonly preferences: Partial<PocketNotificationPreferences> },
				) => {
					target = Object.freeze({ ...target });
					authorize(target);
					if (!object(input) || !shape(input, ["requestId", "preferences"]))
						throw Error("Invalid notification preferences");
					const raw: unknown = input.preferences;
					if (
						!object(raw) ||
						!Object.keys(raw).length ||
						Object.keys(raw).some(
							(field) => !kinds.some((kind) => kind === field) || typeof raw[field] !== "boolean",
						)
					)
						throw Error("Invalid notification preferences");
					const patch = { ...input.preferences };
					return mutate(target, input.requestId, hash(["preferences", patch]), (state) => {
						const existing = state.preferences.find((row) => row.actorId === actorId);
						const value = { ...prefs(state, actorId), ...patch };
						if (existing) existing.value = value;
						else {
							if (state.preferences.length >= 128) throw Error("Notification preference capacity exhausted");
							state.preferences.push({ actorId, value });
						}
					});
				},
				event: async (eventId: string, deviceId: string) => {
					ready();
					check();
					if (!digest(eventId) || !id(deviceId)) return denied();
					const state = (await load()).value;
					const event = state?.events.find((row) => row.id === eventId),
						device = state?.devices.find((row) => row.id === deviceId && row.actorId === actorId);
					if (!event || !device || !event.deliveries.some((row) => row.deviceId === device.id) || !state)
						return denied();
					const target = runtime
						.view()
						.conversations.find(
							(row) =>
								row.conversationId === event.target.conversationId &&
								row.sessionId === event.target.sessionId,
						);
					if (!target || !eligible(state, device, target, event.kind)) return denied();
					authorize(target);
					return Object.freeze({
						id: event.id,
						kind: event.kind,
						preview: event.preview,
						target: Object.freeze({ ...target }),
						createdAt: event.createdAt,
					});
				},
			});
		},
	});
}
