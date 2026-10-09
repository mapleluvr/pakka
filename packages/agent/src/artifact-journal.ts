import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ArtifactReceipt, ArtifactSnapshot, JsonValue } from "./types.ts";

export function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const v of Object.values(value)) freeze(v);
		Object.freeze(value);
	}
	return value;
}
export function copy<T>(value: T): T {
	return freeze(structuredClone(value));
}
export function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function json(value: unknown): asserts value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	if (Array.isArray(value)) {
		value.forEach(json);
		return;
	}
	if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
		Object.values(value).forEach(json);
		return;
	}
	throw new Error("Records must be finite JSON");
}

export type ArtifactIntent = {
	transactionId: string;
	expectedVersion: number;
	version: number;
	attemptIds: readonly string[];
};

/** One fsynced batch per line; strict hash chain and readback, not a permissive event parser. */
export class ArtifactJournal {
	#path: string;
	#markerPath: string;
	#intentPath: string;
	#header: string;
	#known: string | undefined;
	#failed: string | undefined;
	#transactions = new Map<number, string>();
	#fail: (reason: string) => void;
	constructor(root: string, sessionId: string, namespace: string, fail: (reason: string) => void) {
		this.#path = join(root, "artifacts", hash(sessionId), hash(namespace) + ".jsonl");
		this.#markerPath = join(root, "journal-ownership", hash(sessionId), hash(namespace) + ".owned");
		this.#intentPath = this.#path + ".intent";
		this.#header = JSON.stringify({ schema: "pakka.journal.v1", sessionId, namespace });
		this.#fail = fail;
	}
	#fault(error: unknown): never {
		this.#failed = "Artifact journal storage unknown: " + String(error);
		this.#fail(this.#failed);
		throw new Error(this.#failed);
	}
	#readIntent(): ArtifactIntent | undefined {
		if (!existsSync(this.#intentPath)) return undefined;
		const raw = JSON.parse(readFileSync(this.#intentPath, "utf8"));
		if (
			!raw ||
			typeof raw !== "object" ||
			raw.schema !== "pakka.journal.intent.v1" ||
			typeof raw.transactionId !== "string" ||
			!Number.isSafeInteger(raw.expectedVersion) ||
			!Number.isSafeInteger(raw.version) ||
			!Array.isArray(raw.attemptIds) ||
			raw.attemptIds.some((id: unknown) => typeof id !== "string" || !id) ||
			raw.version !== raw.expectedVersion + 1
		)
			throw new Error("Invalid artifact transaction intent");
		return {
			transactionId: raw.transactionId,
			expectedVersion: raw.expectedVersion,
			version: raw.version,
			attemptIds: [...raw.attemptIds],
		};
	}
	pendingIntent(): ArtifactIntent | undefined {
		if (this.#failed) throw new Error(this.#failed);
		try {
			return copy(this.#readIntent());
		} catch (error) {
			return this.#fault(error);
		}
	}
	#writeIntent(intent: ArtifactIntent): void {
		const fd = openSync(this.#intentPath, "wx");
		try {
			writeFileSync(fd, JSON.stringify({ schema: "pakka.journal.intent.v1", ...intent }) + "\n", "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	}
	#clearIntent(transactionId: string, version: number, attemptIds: readonly string[]): void {
		const intent = this.#readIntent();
		if (
			intent &&
			(intent.transactionId !== transactionId ||
				intent.version !== version ||
				JSON.stringify(intent.attemptIds) !== JSON.stringify(attemptIds))
		)
			throw new Error("Mismatched artifact transaction intent");
		unlinkSync(this.#intentPath);
	}
	#write(text: string, flags: string): void {
		const fd = openSync(this.#path, flags);
		try {
			writeFileSync(fd, text, "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	}
	readPending(): ArtifactSnapshot {
		return this.#read(true);
	}
	#read(allowIntent = false): ArtifactSnapshot {
		if (this.#failed) throw new Error(this.#failed);
		try {
			const intent = this.#readIntent();
			if (!allowIntent && intent) throw new Error("Unsettled artifact transaction intent");
			const markerPath = this.#markerPath;
			if (existsSync(this.#path) !== existsSync(markerPath)) throw new Error("Missing/partial owned journal");
			if (!existsSync(this.#path) && this.#known === undefined) {
				mkdirSync(dirname(this.#path), { recursive: true });
				mkdirSync(dirname(markerPath), { recursive: true });
				const fd = openSync(markerPath, "wx");
				try {
					writeFileSync(fd, this.#header + "\n");
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				this.#write(this.#header + "\n", "wx");
			}
			if (readFileSync(markerPath, "utf8") !== this.#header + "\n")
				throw new Error("Wrong owned journal marker");
			const text = readFileSync(this.#path, "utf8");
			if (!text.endsWith("\n") || (this.#known !== undefined && !text.startsWith(this.#known)))
				throw new Error("Missing, truncated or changed journal");
			const lines = text.slice(0, -1).split("\n");
			if (lines.shift() !== this.#header) throw new Error("Wrong journal namespace/header");
			const records: JsonValue[] = [];
			let previous = hash(this.#header),
				version = 0;
			let lastTransactionId: string | undefined;
			const transactions = new Map<number, string>();
			for (const line of lines) {
				const transaction = JSON.parse(line);
				const { checksum, ...payload } = transaction;
				if (
					Object.keys(payload).sort().join() !== "id,previous,records,version" ||
					payload.version !== version + 1 ||
					typeof payload.id !== "string" ||
					payload.previous !== previous ||
					!Array.isArray(payload.records) ||
					!payload.records.length ||
					checksum !== hash(payload)
				)
					throw new Error("Partial/invalid journal transaction");
				json(payload.records);
				records.push(...payload.records);
				version++;
				previous = checksum;
				lastTransactionId = payload.id;
				transactions.set(version, payload.id);
			}
			if (intent && (lastTransactionId !== intent.transactionId || version !== intent.version))
				throw new Error("Artifact transaction intent has no matching physical receipt");
			this.#known = text;
			this.#transactions = transactions;
			return copy({ version, records });
		} catch (error) {
			return this.#fault(error);
		}
	}
	read(): ArtifactSnapshot {
		return this.#read(false);
	}
	assertTransaction(transactionId: string, version: number): void {
		this.read();
		if (!Number.isSafeInteger(version) || version <= 0 || this.#transactions.get(version) !== transactionId)
			this.#fault(new Error("Artifact adoption has no matching physical transaction receipt"));
	}
	append(
		expectedVersion: number,
		records: readonly JsonValue[],
		options: { readonly attemptIds?: readonly string[] } = {},
	): ArtifactReceipt {
		if (
			!Number.isSafeInteger(expectedVersion) ||
			expectedVersion < 0 ||
			!Array.isArray(records) ||
			!records.length
		)
			throw new Error("Invalid artifact batch");
		json(records);
		const attemptIds = [...new Set(options.attemptIds ?? [])];
		if (attemptIds.some((id) => typeof id !== "string" || !id))
			throw new Error("Invalid artifact attempt association");
		const snapshot = this.read();
		if (snapshot.version !== expectedVersion) return copy({ status: "conflict", version: snapshot.version });
		const transactionId = randomUUID();
		const lines = this.#known!.trimEnd().split("\n");
		const previous = snapshot.version ? JSON.parse(lines.at(-1)!).checksum : hash(this.#header);
		const payload = {
			id: transactionId,
			version: expectedVersion + 1,
			previous,
			records: structuredClone(records),
		};
		const next = this.#known! + JSON.stringify({ ...payload, checksum: hash(payload) }) + "\n";
		try {
			this.#writeIntent({ transactionId, expectedVersion, version: expectedVersion + 1, attemptIds });
			this.#write(next.slice(this.#known!.length), "a");
			if (readFileSync(this.#path, "utf8") !== next) throw new Error("No exact physical batch receipt");
			this.#known = next;
			this.#read(true);
			if (attemptIds.length === 0) this.#clearIntent(transactionId, expectedVersion + 1, attemptIds);
			return copy({
				status: "committed",
				version: expectedVersion + 1,
				transactionId,
				journalPath: this.#path,
			});
		} catch (error) {
			try {
				this.#fault(error);
			} catch {
				/* unknown is an explicit receipt */
			}
			return copy({ status: "unknown", reason: this.#failed! });
		}
	}
	settle(transactionId: string, version: number, attemptIds: readonly string[]): void {
		if (this.#failed) throw new Error(this.#failed);
		try {
			this.#clearIntent(transactionId, version, [...new Set(attemptIds)]);
		} catch (error) {
			this.#fault(error);
		}
	}
}
