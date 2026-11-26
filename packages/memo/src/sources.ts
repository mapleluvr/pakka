import {
	MemoError,
	type MemoOptions,
	type SourceRef,
	type SourceCheck,
	type Content,
	type MemoRef,
	type SourceProvider,
} from "./contracts.ts";
import { checkPublication } from "./publication.ts";
import type { Store } from "./store.ts";
import { reference, references, string, integer, hash, data } from "./validation.ts";
type SourceRow = Record<string, string | number | null>;
export class Sources {
	private readonly providers: NonNullable<MemoOptions["providers"]>;
	private readonly store: Store;
	constructor(store: Store, providers: MemoOptions["providers"]) {
		this.store = store;
		this.providers = Object.freeze({ ...providers });
	}
	ref(row: SourceRow): SourceRef {
		return {
			kind: "source",
			libraryId: String(row.library_id),
			sourceId: String(row.id),
			version: row.version === null ? null : String(row.version),
		};
	}
	check(row: SourceRow, actorId: string, action: "read" | "share", ref = this.ref(row)) {
		const provider = this.providers[String(row.provider)];
		if (!provider || typeof provider.check !== "function" || typeof provider.read !== "function")
			throw new MemoError("unavailable", "Source provider unavailable");
		const input: SourceCheck = data({
			actorId,
			action,
			libraryId: String(row.library_id),
			address: String(row.address),
			ref,
		});
		try {
			if (provider.check(input) !== undefined) throw Error("Asynchronous authority check");
		} catch {
			throw new MemoError("denied", "Source access denied");
		}
		return { provider, input };
	}
	visible(row: SourceRow, actorId: string) {
		try {
			this.check(row, actorId, "read");
			return true;
		} catch (error) {
			if (error instanceof MemoError && (error.code === "denied" || error.code === "unavailable"))
				return false;
			throw error;
		}
	}
	filter(refs: readonly MemoRef[], actorId: string, authorize: (libraryId: string) => unknown): MemoRef[] {
		return refs
			.filter((target) => {
				try {
					authorize(target.libraryId);
					if (target.kind === "wiki")
						return !!this.store.get(
							"SELECT 1 AS ok FROM pages p JOIN revisions r ON r.page_id=p.id AND r.revision=? WHERE p.id=? AND p.library_id=? AND p.deleted=0",
							target.revision,
							target.pageId,
							target.libraryId,
						);
					const row =
						target.version === null
							? this.store.get(
									"SELECT * FROM sources WHERE library_id=? AND id=?",
									target.libraryId,
									target.sourceId,
								)
							: this.store.get(
									"SELECT * FROM source_versions WHERE library_id=? AND id=? AND version=?",
									target.libraryId,
									target.sourceId,
									target.version,
								);
					if (!row) return false;
					this.check(row, actorId, "read", target);
					return true;
				} catch (error) {
					if (error instanceof MemoError && ["denied", "unavailable"].includes(error.code)) return false;
					throw error;
				}
			})
			.map((r) => structuredClone(r));
	}
	publication(provider: SourceProvider, result: unknown): () => void {
		if (provider.publicationCheck === undefined) return () => {};
		if (typeof provider.publicationCheck !== "function")
			throw new MemoError("unavailable", "Invalid source publication capability");
		const verify = provider.publicationCheck(result);
		if (typeof verify !== "function")
			throw new MemoError("unavailable", "Invalid source publication verifier");
		return () => checkPublication(verify);
	}
	async read(
		target: SourceRef,
		actorId: string,
		offset: number,
		limit: number,
		authorize: () => void,
		publication: (verify: () => void) => void,
	): Promise<Content> {
		authorize();
		const current = this.store.get(
			"SELECT * FROM sources WHERE library_id=? AND id=?",
			target.libraryId,
			target.sourceId,
		);
		if (!current) throw new MemoError("denied", "Source unavailable");
		const row =
			target.version === null
				? current
				: this.store.get(
						"SELECT * FROM source_versions WHERE library_id=? AND id=? AND version=?",
						target.libraryId,
						target.sourceId,
						target.version,
					);
		if (!row || row.version !== target.version) {
			try {
				this.check(current, actorId, "read", target);
			} catch {
				throw new MemoError("denied", "Source unavailable");
			}
			throw new MemoError("conflict", "Source version unavailable");
		}
		const resolve = () => {
			try {
				return this.check(row, actorId, "read", target);
			} catch {
				throw new MemoError("denied", "Source unavailable");
			}
		};
		const { provider, input } = resolve();
		let result, verifyResult: () => void;
		try {
			const original = await provider.read(data({ ...input, offset, limit }));
			verifyResult = this.publication(provider, original);
			result = data(original);
		} catch (error) {
			if (error instanceof MemoError) throw error;
			throw new MemoError("unavailable", "Source read failed");
		}
		const verify = () => {
			authorize();
			const latest = this.store.get(
				"SELECT catalog_version FROM sources WHERE library_id=? AND id=?",
				target.libraryId,
				target.sourceId,
			);
			if (!latest || latest.catalog_version !== current.catalog_version)
				throw new MemoError("conflict", "Source catalog changed during read");
			resolve();
			verifyResult();
			authorize();
		};
		verify();
		publication(verify);
		try {
			reference(result.ref);
			if (hash(result.ref) !== hash(target)) throw Error("Identity mismatch");
			string(result.text, limit * 4, true);
			const count = Array.from(result.text).length;
			if (count > limit) throw Error("Range too large");
			if (result.nextOffset !== null) {
				integer(result.nextOffset, offset + 1);
				if (result.nextOffset !== offset + count) throw Error("Range mismatch");
			}
			references(result.sources ?? []);
		} catch {
			throw new MemoError("unavailable", "Invalid source reply identity or range");
		}
		return {
			ref: target,
			title: String(row.title),
			path: "sources/" + target.sourceId,
			text: result.text,
			offset,
			nextOffset: result.nextOffset,
			sources: structuredClone(result.sources ?? []),
		};
	}
}
