import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { Sources } from "./sources.ts";
import { browse } from "./browse.ts";
import { search } from "./search.ts";
import {
	MemoError,
	type MemoOptions,
	type MemoService,
	type MemoClient,
	type MemoActor,
	type MemoRole,
	type Receipt,
	type WritePage,
	type PageQuery,
	type MemoRef,
} from "./contracts.ts";
import {
	shape,
	data,
	string,
	id,
	integer,
	path,
	references,
	reference,
	frozen,
	hash,
	encodeCursor,
	decodeCursor,
	persisted,
	invalid,
} from "./validation.ts";
export * from "./contracts.ts";
const ranks = { reader: 1, editor: 2, manager: 3 };
const writeKeys = [
	"libraryId",
	"requestId",
	"pageId",
	"baseRevision",
	"path",
	"title",
	"markdown",
	"summary",
	"sources",
];
function validateWrite(input: unknown): asserts input is WritePage {
	shape(input, writeKeys);
	id(input.libraryId);
	id(input.requestId);
	if (input.pageId !== undefined) id(input.pageId);
	integer(input.baseRevision);
	path(input.path);
	string(input.title, 512);
	string(input.markdown, 256 * 1024, true);
	string(input.summary, 2048, true);
	references(input.sources);
	if ((input.pageId === undefined) !== (input.baseRevision === 0))
		invalid("New pages require baseRevision 0 and no pageId");
}
export function openMemo(options: MemoOptions): MemoService {
	shape(options, ["file", "providers"]);
	const store = new Store(options.file);
	const sources = new Sources(store, options.providers);
	function connect(actor: MemoActor): MemoClient {
		id(actor.id);
		if (typeof actor.check !== "function") invalid("A trusted actor check is required");
		const actorId = actor.id,
			actorCheck = actor.check;
		function current() {
			store.check();
			try {
				if (actorCheck() !== undefined) throw new Error("Invalid authority check");
			} catch {
				throw new MemoError("denied", "Memo authority ended");
			}
		}
		function authorize(libraryId: string, role: MemoRole = "reader") {
			current();
			const row = store.get("SELECT role FROM grants WHERE library_id=? AND actor_id=?", libraryId, actorId);
			if (!row || ranks[row.role as MemoRole] < ranks[role])
				throw new MemoError("denied", "Library access denied");
			return row.role as MemoRole;
		}
		function page(libraryId: string, pageId: string, role: MemoRole = "reader") {
			authorize(libraryId, role);
			const row = store.get(
				"SELECT * FROM pages WHERE library_id=? AND id=? AND deleted=0",
				libraryId,
				pageId,
			);
			if (!row) throw new MemoError("denied", "Page unavailable");
			return row;
		}
		function query(input: PageQuery, scope: unknown, initial: () => { after: number; upper: number }) {
			const limit = input.limit ?? 20;
			integer(limit, 1, 50);
			const data =
				input.cursor === undefined
					? initial()
					: decodeCursor(store.cursorSecret, [actorId, scope], input.cursor);
			integer(data.after);
			integer(data.upper);
			return {
				limit,
				after: Number(data.after),
				upper: Number(data.upper),
				cursor: (after: number) =>
					encodeCursor(store.cursorSecret, [actorId, scope], { after, upper: data.upper }),
			};
		}
		function original(requestId: string) {
			const r = store.get("SELECT * FROM receipts WHERE actor_id=? AND request_id=?", actorId, requestId);
			return r;
		}
		function mutate(
			action: string,
			input: { libraryId: string; requestId: string },
			role: MemoRole,
			apply: () => {
				pageId?: string;
				revision?: number;
				sourceId?: string;
				objectId: string;
				before: number | null;
				after: number | null;
			},
		): Receipt {
			id(input.libraryId);
			id(input.requestId);
			current();
			const fingerprint = hash({ action, input });
			const result = store.transaction(() => {
				current();
				const prior = original(input.requestId);
				if (prior) {
					if (prior.fingerprint !== fingerprint)
						throw new MemoError("conflict", "Request identity reused with different content");
					authorize(input.libraryId);
					return persisted<Receipt>(String(prior.result));
				}
				authorize(input.libraryId, role);
				const effect = apply();
				authorize(input.libraryId, role);
				const at = Date.now();
				const receipt: Receipt = {
					actorId,
					requestId: input.requestId,
					libraryId: input.libraryId,
					action,
					at,
					...(effect.pageId ? { pageId: effect.pageId, revision: effect.revision } : {}),
					...(effect.sourceId ? { sourceId: effect.sourceId } : {}),
				};
				store.run(
					"INSERT INTO changes(library_id,actor_id,request_id,action,object_id,before_version,after_version,at) VALUES (?,?,?,?,?,?,?,?)",
					input.libraryId,
					actorId,
					input.requestId,
					action,
					effect.objectId,
					effect.before,
					effect.after,
					at,
				);
				store.run(
					"INSERT INTO receipts VALUES (?,?,?,?,?)",
					actorId,
					input.requestId,
					input.libraryId,
					fingerprint,
					JSON.stringify(receipt),
				);
				return receipt;
			});
			try {
				authorize(input.libraryId);
			} catch {
				throw new MemoError(
					"unknown",
					"Memo write committed but response authority ended; look up the original request",
				);
			}
			return frozen(result);
		}
		function save(input: WritePage) {
			const copy = data(input);
			validateWrite(copy);
			return mutate("write", copy, "editor", () => {
				let pageId = copy.pageId;
				if (pageId) {
					const old = page(copy.libraryId, pageId, "editor");
					if (Number(old.revision) !== copy.baseRevision)
						throw new MemoError("conflict", "Wiki base revision differs");
				} else pageId = randomUUID();
				const revision = copy.baseRevision + 1;
				if (!copy.pageId)
					store.run(
						"INSERT INTO pages(id,library_id,path,title,revision) VALUES (?,?,?,?,?)",
						pageId,
						copy.libraryId,
						copy.path,
						copy.title,
						revision,
					);
				else
					store.run(
						"UPDATE pages SET path=?,title=?,revision=? WHERE id=? AND library_id=?",
						copy.path,
						copy.title,
						revision,
						pageId,
						copy.libraryId,
					);
				store.run(
					"INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?)",
					pageId,
					revision,
					actorId,
					Date.now(),
					copy.summary,
					copy.title,
					copy.path,
					copy.markdown,
					JSON.stringify(copy.sources),
				);
				return { pageId, revision, objectId: pageId, before: copy.baseRevision, after: revision };
			});
		}
		const client: MemoClient = {
			async libraries(input = {}) {
				input = data(input);
				shape(input, ["cursor", "limit"]);
				current();
				const q = query(input, "libraries", () => ({
					after: 0,
					upper: Number(store.get("SELECT COALESCE(MAX(rowid),0) AS n FROM libraries")!.n),
				}));
				const rows = store.all(
					"SELECT l.rowid AS seq,l.id,l.title,g.role FROM libraries l JOIN grants g ON g.library_id=l.id AND g.actor_id=? WHERE l.rowid>? AND l.rowid<=? ORDER BY l.rowid LIMIT ?",
					actorId,
					q.after,
					q.upper,
					q.limit + 1,
				);
				current();
				return frozen({
					items: rows
						.slice(0, q.limit)
						.map((r) => ({ id: String(r.id), title: String(r.title), role: r.role as MemoRole })),
					cursor: rows.length > q.limit ? q.cursor(Number(rows[q.limit - 1]!.seq)) : null,
				});
			},
			async list(input) {
				input = data(input);
				shape(input, ["libraryId", "prefix", "cursor", "limit"]);
				id(input.libraryId);
				return browse(store, sources, actorId, authorize, current, input);
			},
			async search(input) {
				input = data(input);
				shape(input, ["query", "libraryId", "cursor", "limit"]);
				string(input.query, 512);
				return search(store, sources, actorId, authorize, current, structuredClone(input));
			},
			async read(raw, options = {}) {
				raw = data(raw);
				options = data(options);
				reference(raw);
				shape(options, ["offset", "limit"]);
				const target = raw,
					offset = options.offset ?? 0,
					limit = options.limit ?? 4096;
				integer(offset);
				integer(limit, 1, 16384);
				if (target.kind === "source") {
					const value = await sources.read(target, actorId, offset, limit, () => authorize(target.libraryId));
					const refs = sources.filter(value.sources, actorId, authorize);
					authorize(target.libraryId);
					return frozen({ ...value, sources: refs });
				}
				page(target.libraryId, target.pageId);
				const r = store.get(
					"SELECT title,path,sources,substr(markdown,?,?) AS text,length(markdown) AS length FROM revisions WHERE page_id=? AND revision=?",
					offset + 1,
					limit,
					target.pageId,
					target.revision,
				);
				if (!r) throw new MemoError("denied", "Revision unavailable");
				if (offset > Number(r.length)) invalid("Offset exceeds content");
				const next = offset + Array.from(String(r.text)).length;
				const refs = sources.filter(persisted<MemoRef[]>(String(r.sources)), actorId, authorize);
				page(target.libraryId, target.pageId);
				return frozen({
					ref: target,
					title: String(r.title),
					path: String(r.path),
					text: String(r.text),
					sources: refs,
					offset,
					nextOffset: next < Number(r.length) ? next : null,
				});
			},
			async history(input) {
				input = data(input);
				shape(input, ["libraryId", "pageId", "cursor", "limit"]);
				id(input.libraryId);
				id(input.pageId);
				const row = page(input.libraryId, input.pageId);
				const q = query(input, ["history", input.libraryId, input.pageId], () => ({
					after: Number(row.revision) + 1,
					upper: Number(row.revision),
				}));
				const rows = store.all(
					"SELECT revision,actor_id,at,summary,sources FROM revisions WHERE page_id=? AND revision<? AND revision<=? ORDER BY revision DESC LIMIT ?",
					input.pageId,
					q.after,
					q.upper,
					q.limit + 1,
				);
				page(input.libraryId, input.pageId);
				const items = [];
				let bytes = 4096;
				for (const r of rows.slice(0, q.limit)) {
					const item = {
						revision: Number(r.revision),
						actorId: String(r.actor_id),
						at: Number(r.at),
						summary: String(r.summary),
						sources: sources.filter(persisted<MemoRef[]>(String(r.sources)), actorId, authorize),
					};
					const size = Buffer.byteLength(JSON.stringify(item)) + 1;
					if (bytes + size > 192 * 1024) {
						if (!items.length) throw new MemoError("unavailable", "Persisted revision exceeds page budget");
						break;
					}
					items.push(item);
					bytes += size;
				}
				page(input.libraryId, input.pageId);
				return frozen({
					items,
					cursor: rows.length > items.length ? q.cursor(items[items.length - 1]!.revision) : null,
				});
			},
			async changes(input) {
				input = data(input);
				shape(input, ["libraryId", "cursor", "limit"]);
				id(input.libraryId);
				authorize(input.libraryId);
				const q = query(input, ["changes", input.libraryId], () => ({
					after: 0,
					upper: Number(store.get("SELECT COALESCE(MAX(seq),0) AS n FROM changes")!.n),
				}));
				const rows = store.all(
					"SELECT * FROM changes WHERE library_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT 129",
					input.libraryId,
					q.after,
					q.upper,
				);
				const items = [];
				let last = q.after,
					more = false;
				for (let i = 0; i < rows.length; i++) {
					if (i === 128 || items.length === q.limit) {
						more = true;
						break;
					}
					const r = rows[i]!;
					last = Number(r.seq);
					const role = authorize(input.libraryId);
					if (r.action === "grant") {
						if (role !== "manager") continue;
					} else if (r.action === "registerSource") {
						const source = store.get(
							"SELECT * FROM sources WHERE library_id=? AND id=?",
							input.libraryId,
							r.object_id,
						);
						if (!source || !sources.visible(source, actorId)) continue;
					} else {
						const visible = store.get(
							"SELECT deleted FROM pages WHERE library_id=? AND id=?",
							input.libraryId,
							r.object_id,
						);
						if (!visible || (visible.deleted === 1 && role !== "manager")) continue;
					}
					items.push({
						sequence: Number(r.seq),
						actorId: String(r.actor_id),
						requestId: String(r.request_id),
						action: String(r.action),
						objectId: String(r.object_id),
						before: r.before_version === null ? null : Number(r.before_version),
						after: r.after_version === null ? null : Number(r.after_version),
						at: Number(r.at),
					});
				}
				authorize(input.libraryId);
				return frozen({ items, cursor: more ? q.cursor(last) : null });
			},
			async write(input) {
				return save(input);
			},
			async restore(input) {
				input = data(input);
				shape(input, ["libraryId", "pageId", "requestId", "baseRevision", "revision", "summary"]);
				id(input.libraryId);
				id(input.pageId);
				id(input.requestId);
				integer(input.baseRevision, 1);
				integer(input.revision, 1);
				string(input.summary, 2048, true);
				return mutate("restore", structuredClone(input), "editor", () => {
					const row = page(input.libraryId, input.pageId, "editor");
					if (Number(row.revision) !== input.baseRevision)
						throw new MemoError("conflict", "Wiki base revision differs");
					const old = store.get(
						"SELECT * FROM revisions WHERE page_id=? AND revision=?",
						input.pageId,
						input.revision,
					);
					if (!old) throw new MemoError("denied", "Revision unavailable");
					const revision = input.baseRevision + 1;
					store.run(
						"UPDATE pages SET title=?,revision=? WHERE id=? AND library_id=?",
						old.title,
						revision,
						input.pageId,
						input.libraryId,
					);
					store.run(
						"INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?)",
						input.pageId,
						revision,
						actorId,
						Date.now(),
						input.summary,
						old.title,
						row.path,
						old.markdown,
						old.sources,
					);
					return {
						pageId: input.pageId,
						revision,
						objectId: input.pageId,
						before: input.baseRevision,
						after: revision,
					};
				});
			},
			async remove(input) {
				input = data(input);
				shape(input, ["libraryId", "pageId", "requestId", "baseRevision"]);
				id(input.libraryId);
				id(input.pageId);
				integer(input.baseRevision, 1);
				return mutate("remove", input, "manager", () => {
					const row = page(input.libraryId, input.pageId, "manager");
					if (Number(row.revision) !== input.baseRevision)
						throw new MemoError("conflict", "Wiki base revision differs");
					store.run("UPDATE pages SET deleted=1 WHERE id=? AND library_id=?", input.pageId, input.libraryId);
					return {
						pageId: input.pageId,
						revision: input.baseRevision,
						objectId: input.pageId,
						before: input.baseRevision,
						after: null,
					};
				});
			},
			async grant(input) {
				input = data(input);
				shape(input, ["libraryId", "requestId", "actorId", "role"]);
				id(input.libraryId);
				id(input.actorId);
				if (input.role !== null && (typeof input.role !== "string" || !Object.hasOwn(ranks, input.role)))
					invalid("Invalid library role");
				return mutate("grant", input, "manager", () => {
					const owner = store.get("SELECT owner_id FROM libraries WHERE id=?", input.libraryId);
					if (owner?.owner_id === input.actorId && input.role !== "manager")
						throw new MemoError("conflict", "Library owner must remain a manager");
					if (input.role === null)
						store.run("DELETE FROM grants WHERE library_id=? AND actor_id=?", input.libraryId, input.actorId);
					else
						store.run(
							"INSERT INTO grants VALUES (?,?,?) ON CONFLICT(library_id,actor_id) DO UPDATE SET role=excluded.role",
							input.libraryId,
							input.actorId,
							input.role,
						);
					return { objectId: input.actorId, before: null, after: null };
				});
			},
			async registerSource(raw) {
				raw = data(raw);
				shape(raw, [
					"libraryId",
					"sourceId",
					"requestId",
					"baseVersion",
					"provider",
					"address",
					"version",
					"title",
					"summary",
				]);
				id(raw.libraryId);
				id(raw.sourceId);
				id(raw.provider);
				integer(raw.baseVersion);
				string(raw.address, 2048);
				if (raw.version !== null) string(raw.version, 256);
				string(raw.title, 512);
				string(raw.summary, 2048, true);
				const input = structuredClone(raw);
				return mutate("registerSource", input, "manager", () => {
					const prior = store.get(
						"SELECT * FROM sources WHERE library_id=? AND id=?",
						input.libraryId,
						input.sourceId,
					);
					if ((prior ? Number(prior.catalog_version) : 0) !== input.baseVersion)
						throw new MemoError("conflict", "Source catalog version differs");
					const row = {
						id: input.sourceId,
						library_id: input.libraryId,
						provider: input.provider,
						address: input.address,
						version: input.version,
						title: input.title,
						summary: input.summary,
						catalog_version: input.baseVersion + 1,
					};
					sources.check(row, actorId, "share");
					if (input.version !== null) {
						const old = store.get(
							"SELECT * FROM source_versions WHERE library_id=? AND id=? AND version=?",
							input.libraryId,
							input.sourceId,
							input.version,
						);
						if (old && (old.provider !== input.provider || old.address !== input.address))
							throw new MemoError("conflict", "A fixed source version cannot change address");
						store.run(
							"INSERT OR IGNORE INTO source_versions VALUES (?,?,?,?,?,?,?,?)",
							row.id,
							row.library_id,
							row.catalog_version,
							row.provider,
							row.address,
							row.version,
							row.title,
							row.summary,
						);
					}
					store.run(
						"INSERT INTO sources(id,library_id,catalog_version,provider,address,version,title,summary) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(library_id,id) DO UPDATE SET catalog_version=excluded.catalog_version,provider=excluded.provider,address=excluded.address,version=excluded.version,title=excluded.title,summary=excluded.summary",
						row.id,
						row.library_id,
						row.catalog_version,
						row.provider,
						row.address,
						row.version,
						row.title,
						row.summary,
					);
					sources.check(row, actorId, "share");
					return {
						sourceId: input.sourceId,
						objectId: input.sourceId,
						before: input.baseVersion,
						after: row.catalog_version,
					};
				});
			},
			async lookup(requestId) {
				id(requestId);
				current();
				const row = original(requestId);
				if (!row) return null;
				authorize(String(row.library_id));
				return frozen(persisted<Receipt>(String(row.result)));
			},
			async exportMarkdown(input) {
				input = data(input);
				shape(input, ["libraryId", "pageId"]);
				id(input.libraryId);
				id(input.pageId);
				const row = page(input.libraryId, input.pageId);
				const revision = store.get(
					"SELECT markdown,sources FROM revisions WHERE page_id=? AND revision=?",
					input.pageId,
					row.revision,
				)!;
				const originalSources = persisted<MemoRef[]>(String(revision.sources)),
					visibleSources = sources.filter(originalSources, actorId, authorize);
				if (visibleSources.length !== originalSources.length)
					throw new MemoError("denied", "Complete export requires access to all referenced sources");
				const header = {
					libraryId: input.libraryId,
					pageId: input.pageId,
					baseRevision: Number(row.revision),
					path: String(row.path),
					title: String(row.title),
					sources: visibleSources,
				};
				page(input.libraryId, input.pageId);
				return (
					"<!-- pakka-memo " +
					Buffer.from(JSON.stringify(header)).toString("base64url") +
					" -->\n" +
					String(revision.markdown)
				);
			},
			async importMarkdown(input) {
				input = data(input);
				shape(input, ["requestId", "document"]);
				id(input.requestId);
				string(input.document, 512 * 1024);
				const match = /^<!-- pakka-memo ([A-Za-z0-9_-]+) -->\n/.exec(input.document);
				if (!match) invalid("Memo export header required");
				let header: unknown;
				try {
					header = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8"));
				} catch {
					invalid("Invalid export header");
				}
				shape(header, ["libraryId", "pageId", "baseRevision", "path", "title", "sources"]);
				const imported = {
					...header,
					requestId: input.requestId,
					summary: "Markdown import",
					markdown: input.document.slice(match[0].length),
				};
				validateWrite(imported);
				return save(imported);
			},
			withAuthority(check) {
				if (typeof check !== "function") invalid();
				return connect({
					id: actorId,
					check: () => {
						current();
						if (check() !== undefined) throw new Error("Invalid authority check");
					},
				});
			},
		};
		return Object.freeze(client);
	}
	return Object.freeze({
		createLibrary(input: { id: string; title: string; ownerId: string }) {
			input = data(input);
			shape(input, ["id", "title", "ownerId"]);
			id(input.id);
			id(input.ownerId);
			string(input.title, 512);
			store.transaction(() => {
				const prior = store.get("SELECT * FROM libraries WHERE id=?", input.id);
				if (prior) {
					if (prior.title !== input.title || prior.owner_id !== input.ownerId)
						throw new MemoError("conflict", "Library already exists");
					return;
				}
				store.run("INSERT INTO libraries VALUES (?,?,?)", input.id, input.title, input.ownerId);
				store.run("INSERT INTO grants VALUES (?,?,?)", input.id, input.ownerId, "manager");
			});
		},
		connect,
		close: () => store.close(),
	});
}
