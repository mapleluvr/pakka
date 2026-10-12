import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ArtifactJournal, copy, hash } from "./artifact-journal.ts";
import type { JournalMigration, JsonObject } from "./types.ts";

export type JournalMapping = {
	strategyId: string;
	kind: "records" | "inference";
	namespace: string;
	version: number;
	prefixLength: number;
	prefixSha256: string;
};
export function textHash(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
function files(directory: string): string[] {
	return existsSync(directory) ? readdirSync(directory).sort() : [];
}
function object(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Terminal-task checkpoint sidecars are reclaimed. Count each generation marker as a conservative slot. */
export function legacyPrimaryReservations(source: string, generationKind: string): number {
	const commits: JsonObject[] = [];
	const terminalKinds = new Map<string, string>();
	for (const line of source.trimEnd().split("\n")) {
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch (error) {
			throw new Error("Legacy task history invalid", { cause: error });
		}
		if (!object(record) || record.format !== 1 || record.type !== "commit" || !Array.isArray(record.writes))
			throw new Error("Unsupported legacy storage marker");
		commits.push(record);
		for (const write of record.writes) {
			if (
				!object(write) ||
				write.type !== "task" ||
				!object(write.value) ||
				typeof write.value.kind !== "string"
			)
				continue;
			terminalKinds.set(String(write.value.id), write.value.kind);
		}
	}
	let count = 0;
	const checkpointed = new Set<string>();
	for (const record of commits)
		for (const write of record.writes as readonly unknown[]) {
			if (!object(write)) throw new Error("Invalid legacy storage write");
			if (write.type === "task.sidecar") {
				const id = String(write.id),
					kind = terminalKinds.get(id);
				if (!kind) throw new Error("Legacy task provenance unknown");
				if (kind === generationKind) {
					count++;
					checkpointed.add(id);
				}
			}
		}
	for (const [id, kind] of terminalKinds) if (kind === generationKind && !checkpointed.has(id)) count++;
	return count;
}

/** Preserves exact legacy bytes/transaction identities. Caller has the storage writer claim. */
export function inspectLegacyJournals(
	root: string,
	sessionId: string,
	approvedStrategies: ReadonlySet<string>,
): {
	journals: JournalMapping[];
	auxiliaryAttempts: number;
	strategyAttempts: Record<string, number>;
} {
	const directory = join(root, "artifacts", hash(sessionId));
	const owned = join(root, "journal-ownership", hash(sessionId));
	const names = files(directory),
		markers = files(owned);
	if (
		names.some((name) => !name.endsWith(".jsonl")) ||
		markers.some((name) => !name.endsWith(".owned")) ||
		JSON.stringify(names.map((name) => name.slice(0, -6))) !==
			JSON.stringify(markers.map((name) => name.slice(0, -6)))
	)
		throw new Error("Legacy journal ownership/intent is unknown; migration refused");
	const journals: JournalMapping[] = [],
		records = new Map<string, readonly unknown[]>(),
		readers = new Map<string, ArtifactJournal>();
	const strategyAttempts: Record<string, number> = {};
	let auxiliaryAttempts = 0;
	for (const name of names) {
		const text = readFileSync(join(directory, name), "utf8"),
			first = text.split("\n", 1)[0]!;
		let header: unknown;
		try {
			header = JSON.parse(first);
		} catch (error) {
			throw new Error("Legacy journal header invalid", { cause: error });
		}
		if (
			!object(header) ||
			header.schema !== "pakka.journal.v1" ||
			header.sessionId !== sessionId ||
			typeof header.namespace !== "string" ||
			name !== hash(header.namespace) + ".jsonl"
		)
			throw new Error("Legacy journal provenance mismatch; migration refused");
		const split = header.namespace.lastIndexOf(":"),
			strategyId = header.namespace.slice(0, split),
			kind = header.namespace.slice(split + 1);
		if (!strategyId || (kind !== "records" && kind !== "inference"))
			throw new Error("Unsupported legacy journal namespace");
		const reader = new ArtifactJournal(root, sessionId, header.namespace, () => {}),
			snapshot = reader.read();
		readers.set(header.namespace, reader);
		records.set(header.namespace, snapshot.records);
		journals.push({
			strategyId,
			kind,
			namespace: header.namespace,
			version: snapshot.version,
			prefixLength: text.length,
			prefixSha256: textHash(text),
		});
	}
	for (const mapping of journals.filter((item) => item.kind === "inference")) {
		if (!approvedStrategies.has(mapping.strategyId))
			throw new Error("Legacy inference strategy is not approved; migration refused");
		const rawAudit = records.get(mapping.namespace)!;
		if (
			rawAudit.some(
				(item) => !object(item) || !["reservation", "completion", "adoption"].includes(String(item.kind)),
			)
		)
			throw new Error("Unknown legacy inference record");
		const audit = rawAudit.filter(object);
		const reservations = audit.filter((item) => item.kind === "reservation"),
			ids = new Set<string>();
		for (const reservation of reservations) {
			if (
				reservation.sessionId !== sessionId ||
				reservation.strategyId !== mapping.strategyId ||
				typeof reservation.attemptId !== "string" ||
				!reservation.attemptId ||
				ids.has(reservation.attemptId) ||
				typeof reservation.jobId !== "string" ||
				typeof reservation.principal !== "string"
			)
				throw new Error("Legacy inference authority is unknown");
			ids.add(reservation.attemptId);
			const completions = audit.filter(
				(item) =>
					item.kind === "completion" &&
					object(item.audit) &&
					item.audit.attemptId === reservation.attemptId &&
					item.audit.jobId === reservation.jobId,
			);
			const completion = completions[0]?.audit;
			if (
				completions.length !== 1 ||
				!object(completion) ||
				!["completed", "failed", "quarantined"].includes(String(completion.status))
			)
				throw new Error("Legacy inference completion unknown; migration refused");
			if (reservation.requireArtifactReceipt === true && completion.status === "completed") {
				const adoptions = audit.filter(
					(item) =>
						item.kind === "adoption" &&
						item.attemptId === reservation.attemptId &&
						item.jobId === reservation.jobId &&
						item.sessionId === sessionId &&
						item.strategyId === mapping.strategyId &&
						item.principal === reservation.principal,
				);
				const adoption = adoptions[0],
					physical = readers.get(mapping.strategyId + ":records");
				if (
					adoptions.length !== 1 ||
					!adoption ||
					!physical ||
					typeof adoption.transactionId !== "string" ||
					typeof adoption.version !== "number"
				)
					throw new Error("Legacy adoption receipt unknown; migration refused");
				physical.assertTransaction(adoption.transactionId, adoption.version);
			}
		}
		strategyAttempts[hash(mapping.strategyId)] = reservations.length;
		auxiliaryAttempts += reservations.length;
	}
	return copy({ journals, auxiliaryAttempts, strategyAttempts });
}

export function verifyMigration(root: string, sessionId: string, receipt: JournalMigration): void {
	if (receipt.schemaVersion !== 1 || receipt.sessionId !== sessionId)
		throw new Error("Migration provenance mismatch");
	for (const mapping of receipt.journals) {
		const text = readFileSync(
			join(root, "artifacts", hash(sessionId), hash(mapping.namespace) + ".jsonl"),
			"utf8",
		);
		if (textHash(text.slice(0, mapping.prefixLength)) !== mapping.prefixSha256)
			throw new Error("Migrated journal prefix changed; storage unknown");
		new ArtifactJournal(root, sessionId, mapping.namespace, () => {}).read();
	}
}
export function migratedNamespace(
	receipt: JournalMigration,
	conversationId: string,
	strategyId: string,
	kind: string,
): string | undefined {
	if (receipt.conversationId !== conversationId) return undefined;
	return receipt.journals.find((item) => item.strategyId === strategyId && item.kind === kind)?.namespace;
}
