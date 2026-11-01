import { randomUUID } from "node:crypto";
import { copy, json, type ArtifactIntent } from "./artifact-journal.ts";
import type { ArtifactReceipt, ArtifactSnapshot, JsonValue } from "./types.ts";
import type { SourceWorkMutation, StoredSourceWork } from "./source-work.ts";

export interface JournalMutation {
	readonly key: string;
	readonly expectedVersion: number;
	readonly records: readonly JsonValue[];
	readonly transactionId: string;
	readonly work?: readonly SourceWorkMutation[];
}
/** Only immutable snapshots and identity-bound commands cross the adapter. */
export interface JournalStorage {
	readonly identity: string;
	address(key: string): string;
	read(key: string): ArtifactSnapshot;
	transaction(key: string, version: number): string | undefined;
	receipt(key: string, transactionId: string): Extract<ArtifactReceipt, { status: "committed" }> | undefined;
	work(key: string): readonly StoredSourceWork[];
	commit(mutations: readonly JournalMutation[], check: () => void): Promise<ArtifactReceipt>;
}

/** The confirmed read cache is owned by the adapter; this object owns no Pi state. */
export class NativeJournal {
	#storage: JournalStorage;
	#key: string;
	#check: (mutations: readonly JournalMutation[]) => void;
	#writes: Promise<void> = Promise.resolve();
	constructor(storage: JournalStorage, key: string, check: (mutations: readonly JournalMutation[]) => void) {
		this.#storage = storage;
		this.#key = key;
		this.#check = check;
	}
	read(): ArtifactSnapshot {
		return this.#storage.read(this.#key);
	}
	readPending(): ArtifactSnapshot {
		return this.read();
	}
	pendingIntent(): ArtifactIntent | undefined {
		return undefined;
	}
	assertTransaction(id: string, version: number): void {
		if (this.#storage.transaction(this.#key, version) !== id)
			throw new Error("Artifact adoption has no matching native transaction receipt");
	}
	address(): string {
		return this.#storage.address(this.#key);
	}
	receipt(transactionId: string): Extract<ArtifactReceipt, { status: "committed" }> | undefined {
		return this.#storage.receipt(this.#key, transactionId);
	}
	work(): readonly StoredSourceWork[] {
		return this.#storage.work(this.#key);
	}
	async append(
		expectedVersion: number,
		records: readonly JsonValue[],
		options: {
			readonly attemptIds?: readonly string[];
			readonly transactionId?: string;
			readonly check?: () => void;
			readonly work?: readonly SourceWorkMutation[];
			readonly companions?: readonly {
				readonly journal: NativeJournal;
				readonly expectedVersion: number;
				readonly records: readonly JsonValue[];
				readonly work?: readonly SourceWorkMutation[];
			}[];
		} = {},
	): Promise<ArtifactReceipt> {
		if (
			!Number.isSafeInteger(expectedVersion) ||
			expectedVersion < 0 ||
			!Array.isArray(records) ||
			!records.length
		)
			throw new Error("Invalid artifact batch");
		json(records);
		const transactionId = options.transactionId ?? randomUUID();
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(transactionId))
			throw new Error("Invalid journal transaction identity");
		const mutations: JournalMutation[] = [
			{
				key: this.#key,
				expectedVersion,
				records: copy(records),
				transactionId,
				work: copy(options.work ?? []),
			},
		];
		for (const companion of options.companions ?? []) {
			if (companion.journal.#storage.identity !== this.#storage.identity)
				throw new Error("Cross-storage journal transaction refused");
			mutations.push({
				key: companion.journal.#key,
				expectedVersion: companion.expectedVersion,
				records: copy(companion.records),
				transactionId,
				work: copy(companion.work ?? []),
			});
		}
		return this.#storage.commit(mutations, () => {
			this.#check(mutations);
			options.check?.();
		});
	}
	/** Serialize only local audit commits, never model HTTP. Known CAS conflicts
	 * have no effect and may rebase; unknown outcomes are returned without retry. */
	appendLatest(
		records: readonly JsonValue[],
		check: (snapshot: ArtifactSnapshot) => void = () => {},
		work: readonly SourceWorkMutation[] = [],
	): Promise<ArtifactReceipt> {
		const transactionId = randomUUID();
		const operation = this.#writes.then(async () => {
			for (let attempt = 0; attempt < 32; attempt++) {
				const snapshot = this.read();
				check(snapshot);
				const result = await this.append(snapshot.version, records, {
					transactionId,
					check: () => check(this.read()),
					work,
				});
				if (result.status !== "conflict") return result;
			}
			return { status: "conflict", version: this.read().version } as const;
		});
		this.#writes = operation.then(
			() => {},
			() => {},
		);
		return operation;
	}
	settle(id: string, version: number, _attemptIds: readonly string[]): void {
		this.assertTransaction(id, version);
	}
}
