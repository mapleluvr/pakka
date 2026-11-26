import type { Store } from "./store.ts";
import type { Sources } from "./sources.ts";
import { browse } from "./browse.ts";
import { MemoError, type SearchQuery, type Page, type Entry } from "./contracts.ts";
import { decodeCursor, encodeCursor, integer, string, id, reference, frozen, data } from "./validation.ts";
export async function search(
	store: Store,
	sources: Sources,
	actorId: string,
	authorize: (libraryId: string) => unknown,
	current: () => void,
	query: SearchQuery,
	publication: (verify: () => void) => void,
): Promise<Page<Entry>> {
	publication(current);
	current();
	if (query.libraryId !== undefined) {
		id(query.libraryId);
		authorize(query.libraryId);
	}
	const limit = query.limit ?? 20;
	integer(limit, 1, 50);
	const scope = [actorId, "search", query.libraryId, query.query];
	const state =
		query.cursor === undefined
			? {
					phase: "catalog",
					upper: Number(store.get("SELECT COALESCE(MAX(seq),0) AS n FROM sources")!.n),
					after: 0,
				}
			: decodeCursor(store.cursorSecret, scope, query.cursor);
	integer(state.upper);
	integer(state.after);
	const token = (value: Record<string, unknown>) => encodeCursor(store.cursorSecret, scope, value);
	if (state.phase === "catalog") {
		const page = browse(
			store,
			sources,
			actorId,
			authorize,
			current,
			{
				libraryId: query.libraryId,
				limit,
				...(state.cursor === undefined ? {} : { cursor: String(state.cursor) }),
			},
			query.query,
		);
		const next = page.cursor
			? { ...state, cursor: page.cursor }
			: { phase: "sources", after: 0, upper: state.upper };
		return frozen({ items: page.items, cursor: page.cursor || Number(state.upper) > 0 ? token(next) : null });
	}
	if (state.phase !== "sources") throw new MemoError("invalid", "Invalid search cursor");
	const rows = store.all(
		`SELECT s.* FROM grants g JOIN sources s ON s.library_id=g.library_id WHERE g.actor_id=? AND s.seq${state.sourceCursor === undefined ? ">" : ">="}? AND s.seq<=? AND (? IS NULL OR s.library_id=?) ORDER BY s.seq LIMIT 65`,
		actorId,
		Number(state.after),
		Number(state.upper),
		query.libraryId ?? null,
		query.libraryId ?? null,
	);
	for (let index = 0; index < Math.min(rows.length, 64); index++) {
		const row = rows[index]!;
		authorize(String(row.library_id));
		if (
			index === 0 &&
			state.sourceCursor !== undefined &&
			(row.seq !== state.after || row.catalog_version !== state.version)
		)
			throw new MemoError("conflict", "Source search version changed");
		if (!sources.visible(row, actorId)) continue;
		const { provider, input } = sources.check(row, actorId, "read");
		if (!provider.search) continue;
		const next = { phase: "sources", after: Number(row.seq), upper: state.upper };
		let continuation: string | undefined;
		if (index === 0 && state.sourceCursor !== undefined) {
			string(state.sourceCursor, 2800);
			continuation = Buffer.from(state.sourceCursor, "base64url").toString("utf8");
			string(continuation, 2048);
		}
		// Worst-case escaped strings and reference metadata fit in 192 KiB for four entries.
		const sourceLimit = Math.min(limit, 4);
		let page, verifyResult: () => void;
		try {
			const original = await provider.search({
				...input,
				query: query.query,
				limit: sourceLimit,
				...(continuation === undefined ? {} : { cursor: continuation }),
			});
			verifyResult = sources.publication(provider, original);
			page = data(original);
		} catch (error) {
			if (error instanceof MemoError) throw error;
			throw new MemoError("unavailable", "Source search failed");
		}
		const verify = () => {
			authorize(String(row.library_id));
			sources.check(row, actorId, "read");
			verifyResult();
			if (
				store.get("SELECT catalog_version FROM sources WHERE library_id=? AND id=?", row.library_id, row.id)
					?.catalog_version !== row.catalog_version
			)
				throw new MemoError("conflict", "Source changed during search");
			current();
		};
		verify();
		publication(verify);
		try {
			if (!Array.isArray(page.items) || page.items.length > sourceLimit) throw Error("Oversized source page");
			if (page.cursor !== null) {
				string(page.cursor, 2048);
				if (page.cursor === continuation) throw Error("Nonadvancing search");
			}
			for (const item of page.items) {
				reference(item.ref);
				if (
					item.ref.kind !== "source" ||
					item.ref.libraryId !== row.library_id ||
					item.ref.sourceId !== row.id ||
					item.ref.version !== row.version
				)
					throw Error("Wrong source");
				string(item.title, 512);
				string(item.path, 1024);
				string(item.excerpt, 2048, true);
			}
		} catch {
			throw new MemoError("unavailable", "Invalid source search result");
		}
		const items = page.items
			.filter((item) => sources.filter([item.ref], actorId, authorize).length === 1)
			.map((item) => ({ ref: item.ref, title: item.title, path: item.path, excerpt: item.excerpt }));
		authorize(String(row.library_id));
		current();
		return frozen({
			items,
			cursor:
				page.cursor !== null
					? token({
							...next,
							version: row.catalog_version,
							sourceCursor: Buffer.from(page.cursor, "utf8").toString("base64url"),
						})
					: index + 1 < rows.length
						? token(next)
						: null,
		});
	}
	current();
	return frozen({
		items: [],
		cursor:
			rows.length > 64 ? token({ phase: "sources", after: Number(rows[63]!.seq), upper: state.upper }) : null,
	});
}
