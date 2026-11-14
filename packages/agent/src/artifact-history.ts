import { copy, hash } from "./artifact-journal.ts";
import type {
	ArtifactHistory,
	ArtifactHistoryQuery,
	ArtifactHistoryReference,
	ArtifactHistoryItem,
	ConversationRef,
	JsonValue,
} from "./types.ts";

/** Detached, bounded reader. Native document access remains in the adapter callbacks. */
export function createArtifactHistoryReader(options: {
	ref: ConversationRef;
	strategyId: string;
	check(): void;
	head(): Promise<number>;
	batch(version: number): Promise<{ readonly records: readonly JsonValue[]; readonly digest: string }>;
}): ArtifactHistory {
	const ref = copy(options.ref),
		strategyId = options.strategyId,
		check = options.check;
	const binding = hash([ref.sessionId, ref.conversationId, strategyId]);
	const finite = (n: unknown, min = 0): n is number =>
		Number.isSafeInteger(n) && Number(n) >= min && Number(n) < Number.MAX_SAFE_INTEGER;
	const refusal = (message: string): never => {
		throw new Error("Artifact history " + message);
	};
	const cursor = (version: number, ordinal: number, through: number) =>
		Buffer.from(JSON.stringify({ binding, version, ordinal, through })).toString("base64url");
	const parse = (raw: string) => {
		try {
			if (typeof raw !== "string" || raw.length > 1024) throw Error();
			const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
			if (
				!value ||
				value.binding !== binding ||
				!finite(value.version, 1) ||
				!finite(value.ordinal) ||
				!finite(value.through) ||
				value.version > value.through + 1
			)
				throw Error();
			return {
				version: Number(value.version),
				ordinal: Number(value.ordinal),
				through: Number(value.through),
			};
		} catch {
			return refusal("cursor scope or shape invalid");
		}
	};
	const head = async () => {
		check();
		const value = await options.head();
		check();
		if (!finite(value)) return refusal("head unavailable");
		return value;
	};
	const page = async (raw: ArtifactHistoryQuery = {}) => {
		const input = copy(raw);
		check();
		const limit = input.limit ?? 32,
			maxBytes = input.maxBytes ?? 128 * 1024;
		if (
			!finite(limit, 1) ||
			limit > 128 ||
			!finite(maxBytes, 2048) ||
			maxBytes > 1024 * 1024 ||
			(input.afterVersion !== undefined && !finite(input.afterVersion)) ||
			(input.through !== undefined && !finite(input.through))
		)
			return refusal("invalid page budget or version");
		const latest = await head();
		let { version, ordinal, through } = input.cursor
			? parse(input.cursor)
			: { version: (input.afterVersion ?? 0) + 1, ordinal: 0, through: input.through ?? latest };
		if (
			through > latest ||
			(input.cursor &&
				(input.afterVersion !== undefined || (input.through !== undefined && input.through !== through)))
		)
			return refusal("cursor or fixed version outside scope");
		const startCursor = version <= through ? cursor(version, ordinal, through) : null;
		const items: ArtifactHistoryItem[] = [];
		let size = 1024;
		while (version <= through && items.length < limit) {
			check();
			const batch = await options.batch(version);
			check();
			if (ordinal >= batch.records.length) return refusal("cursor ordinal outside batch");
			while (ordinal < batch.records.length && items.length < limit) {
				const value = batch.records[ordinal]!,
					encoded = Buffer.byteLength(JSON.stringify(value));
				const kind =
					value &&
					typeof value === "object" &&
					!Array.isArray(value) &&
					"kind" in value &&
					typeof value.kind === "string"
						? value.kind
						: "record";
				const item: ArtifactHistoryItem = {
					ref: {
						sessionId: ref.sessionId,
						conversationId: ref.conversationId,
						strategyId,
						version,
						ordinal,
						digest: hash(value),
					},
					kind,
					bytes: encoded,
				};
				const needed = Buffer.byteLength(JSON.stringify(item)) + 1;
				if (size + needed > maxBytes) break;
				items.push(item);
				size += needed;
				ordinal++;
			}
			if (ordinal < batch.records.length) break;
			version++;
			ordinal = 0;
		}
		check();
		return copy({
			through,
			items,
			startCursor,
			cursor: version <= through ? cursor(version, ordinal, through) : null,
		});
	};
	const read = async (raw: ArtifactHistoryReference, maxBytes = 1024 * 1024): Promise<JsonValue> => {
		const reference = copy(raw);
		check();
		if (
			!reference ||
			reference.sessionId !== ref.sessionId ||
			reference.conversationId !== ref.conversationId ||
			reference.strategyId !== strategyId ||
			!finite(reference.version, 1) ||
			!finite(reference.ordinal) ||
			typeof reference.digest !== "string" ||
			!/^[a-f0-9]{64}$/u.test(reference.digest) ||
			!finite(maxBytes, 1) ||
			maxBytes > 1024 * 1024
		)
			return refusal("reference or byte budget invalid");
		if (reference.version > (await head())) return refusal("version unavailable");
		const batch = await options.batch(reference.version),
			value = batch.records[reference.ordinal];
		if (value === undefined || hash(value) !== reference.digest) return refusal("reference digest mismatch");
		if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) return refusal("record exceeds response budget");
		check();
		return copy(value);
	};
	return Object.freeze({ head, page, read });
}
