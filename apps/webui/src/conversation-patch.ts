import type { PocketSnapshot, PocketSnapshotPatch } from "@pakka/protocol/pocket";

/** Derived transport projection only. Immutable complete entries remain in the original archive. */
export function createPocketSnapshotPatch(
	previous: PocketSnapshot,
	next: PocketSnapshot,
	baseSequence: number,
): PocketSnapshotPatch | undefined {
	if (
		!["key", "sessionId", "conversationId", "incarnation", "profile"].every(
			(key) => previous.ref[key as keyof typeof previous.ref] === next.ref[key as keyof typeof next.ref],
		)
	)
		throw new Error("Conversation observation reference changed");
	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
	const prior = new Map(previous.entries.map((entry) => [entry.id, entry]));
	const entries = next.entries.filter((entry) => !same(prior.get(entry.id), entry));
	const ids = next.entries.map((entry) => entry.id);
	const patch: PocketSnapshotPatch = {
		ref: next.ref,
		baseSequence,
		...(entries.length ? { entries } : {}),
		...(same(
			previous.entries.map((entry) => entry.id),
			ids,
		)
			? {}
			: { entryIds: ids }),
		...(previous.entriesTruncated === next.entriesTruncated
			? {}
			: { entriesTruncated: next.entriesTruncated }),
		...(previous.olderBeforeId === next.olderBeforeId ? {} : { olderBeforeId: next.olderBeforeId ?? null }),
		...(same(previous.live, next.live) ? {} : { live: next.live }),
		...(same(previous.usage, next.usage) ? {} : { usage: next.usage }),
	};
	return Object.keys(patch).length > 2 ? patch : undefined;
}
