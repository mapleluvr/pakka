import type { Store } from "./store.ts";
import type { Sources } from "./sources.ts";
import type { Entry, Page, PageQuery } from "./contracts.ts";
import { decodeCursor, encodeCursor, integer, id, string, frozen } from "./validation.ts";
export function browse(
	store: Store,
	sources: Sources,
	actorId: string,
	authorize: (libraryId: string) => unknown,
	current: () => void,
	input: PageQuery & { libraryId?: string; prefix?: string },
	search?: string,
): Page<Entry> {
	if (input.libraryId !== undefined) {
		id(input.libraryId);
		authorize(input.libraryId);
	}
	current();
	const prefix = input.prefix ?? "";
	string(prefix, 1024, true);
	const limit = input.limit ?? 20;
	integer(limit, 1, 50);
	const scope = [actorId, "browse", input.libraryId, prefix, search];
	const data =
		input.cursor === undefined
			? {
					after: 0,
					upper: Number(
						store.get(
							"SELECT MAX(COALESCE((SELECT MAX(seq)*2 FROM pages),0),COALESCE((SELECT MAX(seq)*2+1 FROM sources),0)) AS n",
						)!.n,
					),
				}
			: decodeCursor(store.cursorSecret, scope, input.cursor);
	integer(data.after);
	integer(data.upper);
	const after = Number(data.after),
		upper = Number(data.upper);
	const needle = search === undefined ? null : "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
	// Materialize a bounded authorized metadata window before touching any Wiki body.
	const rows = store.all(
		`WITH candidates AS MATERIALIZED (
SELECT * FROM (
SELECT p.seq*2 AS position,'wiki' AS kind,p.id,p.library_id,p.path,p.title,p.revision,NULL AS provider,NULL AS address,NULL AS version,NULL AS catalog_version,NULL AS summary FROM grants g JOIN pages p ON p.library_id=g.library_id WHERE g.actor_id=? AND p.deleted=0 AND p.seq*2>? AND p.seq*2<=? AND (? IS NULL OR p.library_id=?)
UNION ALL
SELECT s.seq*2+1 AS position,'source' AS kind,s.id,s.library_id,'sources/'||s.id AS path,s.title,NULL AS revision,s.provider,s.address,s.version,s.catalog_version,s.summary FROM grants g JOIN sources s ON s.library_id=g.library_id WHERE g.actor_id=? AND s.seq*2+1>? AND s.seq*2+1<=? AND (? IS NULL OR s.library_id=?)
) WHERE substr(path,1,length(?))=? ORDER BY position LIMIT 129)
SELECT c.*,CASE WHEN c.kind='wiki' THEN substr(r.markdown,1,180) ELSE c.summary END AS excerpt,
(? IS NULL OR c.title LIKE ? ESCAPE '\\' OR c.path LIKE ? ESCAPE '\\' OR (CASE WHEN c.kind='wiki' THEN r.markdown ELSE c.summary END) LIKE ? ESCAPE '\\') AS matches
FROM candidates c LEFT JOIN revisions r ON c.kind='wiki' AND r.page_id=c.id AND r.revision=c.revision ORDER BY c.position`,
		actorId,
		after,
		upper,
		input.libraryId ?? null,
		input.libraryId ?? null,
		actorId,
		after,
		upper,
		input.libraryId ?? null,
		input.libraryId ?? null,
		prefix,
		prefix,
		needle,
		needle,
		needle,
		needle,
	);
	const items: Entry[] = [];
	let last = after,
		hasMore = false,
		bytes = 8192;
	for (let i = 0; i < rows.length; i++) {
		if (items.length >= limit || i === 128) {
			hasMore = true;
			break;
		}
		const row = rows[i]!;
		authorize(String(row.library_id));
		if (!row.matches || (row.kind === "source" && !sources.visible(row, actorId))) {
			last = Number(row.position);
			continue;
		}
		const item: Entry = {
			ref:
				row.kind === "wiki"
					? {
							kind: "wiki",
							libraryId: String(row.library_id),
							pageId: String(row.id),
							revision: Number(row.revision),
						}
					: sources.ref(row),
			path: String(row.path),
			title: String(row.title),
			excerpt: search === undefined ? "" : String(row.excerpt),
		};
		const size = Buffer.byteLength(JSON.stringify(item)) + 1;
		if (bytes + size > 192 * 1024) {
			hasMore = true;
			break;
		}
		items.push(item);
		bytes += size;
		last = Number(row.position);
	}
	for (const item of items) authorize(item.ref.libraryId);
	current();
	return frozen({
		items,
		cursor: hasMore ? encodeCursor(store.cursorSecret, scope, { after: last, upper }) : null,
	});
}
