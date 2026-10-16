import { createHash } from "node:crypto";
import type { Runtime, RuntimeStoreSnapshot } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "./pocket-people.ts";

export interface PocketCredentialStatus {
	readonly version: number;
	readonly configured: boolean;
}
export interface PocketCredentialWrite {
	readonly requestId: string;
	readonly expectedVersion: number;
}
export interface PocketCredentialClient {
	status(): Promise<PocketCredentialStatus>;
	replace(input: PocketCredentialWrite & { readonly secret: string }): Promise<PocketCredentialStatus>;
	clear(input: PocketCredentialWrite): Promise<PocketCredentialStatus>;
}
export interface PocketCredentials {
	/** Host-only resolver, never a browser read operation. Existing bootstrap lookup remains the source until an explicit replacement or clear. */
	resolve(): Promise<string>;
	bind(actor: PocketAuthority, check?: () => void): PocketCredentialClient;
}
export interface PocketCredentialsOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly namespace: string;
	readonly bootstrap: () => string | Promise<string>;
}
export class PocketCredentialConflict extends Error {
	constructor() {
		super("Private configuration version conflict");
	}
}
type Receipt = {
	actorId: string;
	requestId: string;
	fingerprint: string;
	version: number;
	configured: boolean;
};
type State = {
	schema: 1;
	mode: "bootstrap" | "stored" | "cleared";
	secret: string | null;
	receipts: Receipt[];
};
const object = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
	Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const id = (value: unknown): value is string =>
	typeof value === "string" && /^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value);
const secret = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= 4096 &&
	value.trim() === value &&
	!/[\x00-\x1f\x7f]/.test(value);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const invalid = (): never => {
	throw new Error("Private configuration persistence unavailable");
};
function decode(snapshot: RuntimeStoreSnapshot): State {
	const value: unknown = snapshot.data;
	if (snapshot.version === 0 && object(value) && Object.keys(value).length === 0)
		return { schema: 1, mode: "bootstrap", secret: null, receipts: [] };
	if (
		!object(value) ||
		!keys(value, ["schema", "mode", "secret", "receipts"]) ||
		value.schema !== 1 ||
		!["stored", "cleared"].includes(String(value.mode)) ||
		!Array.isArray(value.receipts) ||
		value.receipts.length !== snapshot.version ||
		value.receipts.length > 256
	)
		return invalid();
	const mode = value.mode;
	if (mode !== "stored" && mode !== "cleared") return invalid();
	if (mode === "stored" ? !secret(value.secret) : value.secret !== null) return invalid();
	const receipts: Receipt[] = [],
		seen = new Set<string>();
	for (const [index, row] of value.receipts.entries()) {
		if (
			!object(row) ||
			!keys(row, ["actorId", "requestId", "fingerprint", "version", "configured"]) ||
			!id(row.actorId) ||
			!id(row.requestId) ||
			typeof row.fingerprint !== "string" ||
			!/^[0-9a-f]{64}$/.test(row.fingerprint) ||
			row.version !== index + 1 ||
			typeof row.configured !== "boolean"
		)
			return invalid();
		const identity = JSON.stringify([row.actorId, row.requestId]);
		if (seen.has(identity)) return invalid();
		seen.add(identity);
		receipts.push({
			actorId: row.actorId,
			requestId: row.requestId,
			fingerprint: row.fingerprint,
			version: index + 1,
			configured: row.configured,
		});
	}
	if (!receipts.length || receipts.at(-1)!.configured !== (mode === "stored")) return invalid();
	return { schema: 1, mode, secret: typeof value.secret === "string" ? value.secret : null, receipts };
}
const status = (version: number, configured: boolean): PocketCredentialStatus =>
	Object.freeze({ version, configured });

/** Dedicated private replace/clear storage. No read method, operation receipt or error returns the saved value. */
export async function createPocketCredentials(options: PocketCredentialsOptions): Promise<PocketCredentials> {
	if (typeof options.bootstrap !== "function")
		throw new Error("Explicit private configuration source required");
	const { runtime, people } = options,
		store = runtime.store({ namespace: options.namespace, maxBytes: 262144 }),
		bootstrap = options.bootstrap;
	const ready = () => {
		if (runtime.view().phase !== "ready") throw new Error("Private configuration unavailable");
	};
	async function read() {
		ready();
		const snapshot = await store.snapshot();
		const data = decode(snapshot);
		ready();
		return { version: snapshot.version, data };
	}
	await read();
	let tail: Promise<unknown> = Promise.resolve();
	const serial = <T>(operation: () => Promise<T>) => {
		const running = tail.then(operation);
		tail = running.then(
			() => {},
			() => {},
		);
		return running;
	};
	return Object.freeze({
		resolve: async () => {
			const current = await read();
			if (current.data.mode === "cleared") throw new Error("Provider credential is not configured");
			if (current.data.mode === "stored") return current.data.secret!;
			const value = await bootstrap();
			const latest = await read();
			if (latest.version !== current.version || !secret(value))
				throw new Error("Provider credential source changed or is unavailable");
			return value;
		},
		bind(actor: PocketAuthority, check: () => void = () => {}): PocketCredentialClient {
			const authorize = () => {
				ready();
				people.check(actor, "extensions.install");
				check();
			};
			authorize();
			const mutate = (
				kind: "replace" | "clear",
				input: PocketCredentialWrite & { readonly secret?: string },
			): Promise<PocketCredentialStatus> => {
				authorize();
				if (
					!object(input) ||
					!keys(
						input,
						kind === "replace"
							? ["requestId", "expectedVersion", "secret"]
							: ["requestId", "expectedVersion"],
					) ||
					!id(input.requestId) ||
					!Number.isSafeInteger(input.expectedVersion) ||
					input.expectedVersion < 0 ||
					(kind === "replace" && !secret(input.secret))
				)
					return Promise.reject(new Error("Invalid explicit private configuration operation"));
				const saved = Object.freeze({ ...input }),
					actorId = people.current(actor).id,
					fingerprint = hash({
						kind,
						expectedVersion: saved.expectedVersion,
						secretHash: kind === "replace" ? hash(saved.secret) : null,
					});
				return serial(async () => {
					authorize();
					const before = await read();
					authorize();
					const prior = before.data.receipts.find(
						(row) => row.actorId === actorId && row.requestId === saved.requestId,
					);
					if (prior) {
						if (prior.fingerprint !== fingerprint) throw new PocketCredentialConflict();
						authorize();
						return status(prior.version, prior.configured);
					}
					if (before.version !== saved.expectedVersion) throw new PocketCredentialConflict();
					if (before.data.receipts.length >= 256)
						throw new Error("Private configuration operation capacity exhausted");
					const version = before.version + 1,
						configured = kind === "replace";
					const next = {
						schema: 1,
						mode: configured ? "stored" : "cleared",
						secret: configured ? saved.secret! : null,
						receipts: [
							...before.data.receipts,
							{ actorId, requestId: saved.requestId, fingerprint, version, configured },
						],
					};
					const result = await store.compareAndSet(before.version, next, authorize);
					decode(result);
					authorize();
					return status(version, configured);
				});
			};
			return Object.freeze({
				status: async () => {
					authorize();
					const current = await read();
					authorize();
					return status(current.version, current.data.mode !== "cleared");
				},
				replace: (input: PocketCredentialWrite & { readonly secret: string }) => mutate("replace", input),
				clear: (input: PocketCredentialWrite) => mutate("clear", input),
			});
		},
	});
}
