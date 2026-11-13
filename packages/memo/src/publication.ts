import { MemoError } from "./contracts.ts";

/** Publication is synchronous: no asynchronous authorization can protect this return. */
export function checkPublication(verify: () => unknown): void {
	let result: unknown;
	try {
		result = verify();
	} catch (error) {
		if (error instanceof MemoError) throw error;
		throw new MemoError("denied", "Source publication authority refused");
	}
	if (result !== undefined) {
		void Promise.resolve(result).catch(() => {});
		throw new MemoError("unavailable", "Publication authorization must be synchronous");
	}
}

/** Per-client, exact-result identities; no persistent proof or strong result cache. */
export function readPublications() {
	const checks = new WeakMap<object, () => void>();
	return {
		bind<T extends object>(value: T, verify: () => void): T {
			checkPublication(verify);
			checks.set(value, verify);
			return value;
		},
		capture(value: unknown): () => void {
			const verify = value !== null && typeof value === "object" ? checks.get(value) : undefined;
			if (!verify) throw new MemoError("invalid", "Read result does not belong to this Memo client");
			return () => checkPublication(verify);
		},
	};
}
