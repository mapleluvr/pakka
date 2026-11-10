import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { MemoError } from "./contracts.ts";
import { invalid } from "./validation.ts";
type Row = Record<string, string | number | null>;
function checkIdentity(db: DatabaseSync) {
	const app = Number(db.prepare("PRAGMA application_id").get()?.application_id),
		version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
	if (app !== 0 && app !== 0x504d454d) throw new MemoError("unavailable", "Not a Memo database");
	if (
		version > 1 ||
		(app === 0 && db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get())
	)
		throw new MemoError("unavailable", "Unsupported Memo database schema");
}
/** Owns only Memo's database; never opens a Runtime or a Pi storage file. */
export class Store {
	private db: DatabaseSync;
	private closed = false;
	private failed = false;
	readonly cursorSecret: string;
	private schemaVersion: number | undefined;
	private initialized = false;
	constructor(file: string) {
		if (typeof file !== "string" || !isAbsolute(file)) invalid("An absolute Memo database path is required");
		try {
			// A writable first read can recover a foreign hot journal before identity refusal.
			if (existsSync(file)) {
				const probe = new DatabaseSync(file, { readOnly: true });
				try {
					checkIdentity(probe);
				} finally {
					probe.close();
				}
			}
			this.db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
		} catch {
			throw new MemoError("unavailable", "Memo storage could not be opened");
		}
		try {
			this.db.exec("PRAGMA busy_timeout=0");
			checkIdentity(this.db);
			this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;");
			this.transaction(() => {
				this.db.exec(`CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY,title TEXT NOT NULL,owner_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grants(library_id TEXT NOT NULL REFERENCES libraries(id),actor_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('reader','editor','manager')),PRIMARY KEY(library_id,actor_id));
CREATE TABLE IF NOT EXISTS pages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,library_id TEXT NOT NULL REFERENCES libraries(id),path TEXT NOT NULL,title TEXT NOT NULL,revision INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS page_path ON pages(library_id,path) WHERE deleted=0;
CREATE INDEX IF NOT EXISTS page_library ON pages(library_id,seq);
CREATE INDEX IF NOT EXISTS grants_actor ON grants(actor_id,library_id);
CREATE TABLE IF NOT EXISTS revisions(page_id TEXT NOT NULL REFERENCES pages(id),revision INTEGER NOT NULL,actor_id TEXT NOT NULL,at INTEGER NOT NULL,summary TEXT NOT NULL,title TEXT NOT NULL,path TEXT NOT NULL,markdown TEXT NOT NULL,sources TEXT NOT NULL,PRIMARY KEY(page_id,revision));
CREATE TABLE IF NOT EXISTS receipts(actor_id TEXT NOT NULL,request_id TEXT NOT NULL,library_id TEXT NOT NULL REFERENCES libraries(id),fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(actor_id,request_id));
CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,library_id TEXT NOT NULL REFERENCES libraries(id),actor_id TEXT NOT NULL,request_id TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT NOT NULL,before_version INTEGER,after_version INTEGER,at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS changes_library ON changes(library_id,seq);
CREATE TABLE IF NOT EXISTS sources(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,library_id TEXT NOT NULL REFERENCES libraries(id),catalog_version INTEGER NOT NULL,provider TEXT NOT NULL,address TEXT NOT NULL,version TEXT,title TEXT NOT NULL,summary TEXT NOT NULL,UNIQUE(library_id,id));
CREATE TABLE IF NOT EXISTS source_versions(id TEXT NOT NULL,library_id TEXT NOT NULL REFERENCES libraries(id),catalog_version INTEGER NOT NULL,provider TEXT NOT NULL,address TEXT NOT NULL,version TEXT NOT NULL,title TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(library_id,id,version));
CREATE INDEX IF NOT EXISTS sources_library ON sources(library_id,seq);
PRAGMA application_id=1347241293; PRAGMA user_version=1;`);
				this.run(
					"INSERT OR IGNORE INTO metadata VALUES (?,?)",
					"cursor-key",
					randomBytes(32).toString("hex"),
				);
			});
			this.cursorSecret = String(this.get("SELECT value FROM metadata WHERE key='cursor-key'")!.value);
			if (!/^[a-f0-9]{64}$/.test(this.cursorSecret))
				throw new MemoError("unavailable", "Invalid Memo metadata");
			this.initialized = true;
			this.check();
		} catch (error) {
			this.db.close();
			this.failure(error);
		}
	}
	check() {
		if (this.closed || this.failed)
			throw new MemoError("unavailable", "Memo storage is closed or requires reconciliation");
		if (this.initialized)
			try {
				const version = Number(this.db.prepare("PRAGMA schema_version").get()?.schema_version);
				if (version !== this.schemaVersion) {
					const required = {
						metadata: "key,value",
						libraries: "id,title,owner_id",
						grants: "library_id,actor_id,role",
						pages: "seq,id,library_id,path,title,revision,deleted",
						revisions: "page_id,revision,actor_id,at,summary,title,path,markdown,sources",
						receipts: "actor_id,request_id,library_id,fingerprint,result",
						changes: "seq,library_id,actor_id,request_id,action,object_id,before_version,after_version,at",
						sources: "seq,id,library_id,catalog_version,provider,address,version,title,summary",
						source_versions: "id,library_id,catalog_version,provider,address,version,title,summary",
					};
					for (const [table, columns] of Object.entries(required))
						this.db.prepare("SELECT " + columns + " FROM " + table + " LIMIT 0").all();
					this.schemaVersion = version;
				}
			} catch (error) {
				this.failure(error);
			}
	}
	private failure(error: unknown): never {
		if (error instanceof MemoError) throw error;
		const code =
			typeof error === "object" && error !== null && "errcode" in error ? Number(error.errcode) & 255 : 0;
		if (code === 19) throw new MemoError("conflict", "Memo version or identity conflict");
		if (code === 5 || code === 6)
			throw new MemoError("busy", "Memo storage is busy; retry the original request");
		this.failed = true;
		throw new MemoError("unavailable", "Memo storage requires reconciliation");
	}
	get(sql: string, ...args: SQLInputValue[]): Row | undefined {
		this.check();
		try {
			return this.db.prepare(sql).get(...args) as Row | undefined;
		} catch (error) {
			return this.failure(error);
		}
	}
	all(sql: string, ...args: SQLInputValue[]): Row[] {
		this.check();
		try {
			return this.db.prepare(sql).all(...args) as Row[];
		} catch (error) {
			return this.failure(error);
		}
	}
	run(sql: string, ...args: SQLInputValue[]) {
		this.check();
		try {
			return this.db.prepare(sql).run(...args);
		} catch (error) {
			return this.failure(error);
		}
	}
	transaction<T>(fn: () => T): T {
		this.check();
		let begun = false,
			committing = false;
		try {
			this.db.exec("BEGIN IMMEDIATE");
			begun = true;
			const result = fn();
			committing = true;
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			if (begun) {
				try {
					this.db.exec("ROLLBACK");
				} catch {
					this.failed = true;
				}
			}
			if (committing) {
				this.failed = true;
				throw new MemoError("unknown", "Memo commit outcome requires reconciliation");
			}
			return this.failure(error);
		}
	}
	close() {
		if (!this.closed) {
			this.db.close();
			this.closed = true;
		}
	}
}
