import { randomUUID } from "node:crypto";
import type { ToolInvocationScope } from "@pakka/agent";
import { Store } from "./store.ts";
import { openMemo } from "./index.ts";
import { MemoError, type MemoActor, type MemoClient, type MemoRef, type Receipt } from "./contracts.ts";
import {
	shape,
	id,
	string,
	integer,
	references,
	hash,
	frozen,
	persisted,
	invalid,
	data,
} from "./validation.ts";
import type {
	PatchouliOptions,
	PatchouliService,
	PatchouliClient,
	ResearchDelivery,
	ResearchRun,
	ResearchReceipt,
	ResearchRequest,
} from "./patchouli-contracts.ts";
export * from "./patchouli-contracts.ts";
type Row = Record<string, string | number | null>;
const terminal = (state: unknown) => state === "done" || state === "unanswered";
function forbidden(): never {
	throw new MemoError("denied", "Outside the approved research scope");
}
export function openPatchouli(options: PatchouliOptions): PatchouliService {
	id(options.id);
	id(options.actorId);
	if (!Array.isArray(options.scope) || options.scope.length < 1 || options.scope.length > 16)
		invalid("Invalid research scope");
	const scope = options.scope.map((s) => {
		shape(s, ["libraryId", "write"]);
		id(s.libraryId);
		if (typeof s.write !== "boolean") invalid();
		return { ...s };
	});
	if (new Set(scope.map((s) => s.libraryId)).size !== scope.length) invalid("Duplicate research library");
	if (typeof options.authorize !== "function" || typeof options.driver?.check !== "function")
		invalid("Trusted research policy and driver required");
	const maxPending = options.maxPending ?? 32,
		maxPublications = options.maxPublications ?? 64;
	integer(maxPending, 1, 256);
	integer(maxPublications, 1, 128);
	const librarianId = options.id,
		workerId = options.actorId,
		driver = options.driver,
		policy = options.authorize;
	const definition = hash({
		librarianId,
		workerId,
		scope,
		route: driver.identity,
		maxPending,
		maxPublications,
	});
	const store = new Store(options.file);
	let memo: ReturnType<typeof openMemo>;
	try {
		store.transaction(() => {
			store.run(
				"CREATE TABLE IF NOT EXISTS librarians(id TEXT PRIMARY KEY,definition TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0)",
			);
			store.run(
				`CREATE TABLE IF NOT EXISTS research_runs(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,librarian_id TEXT NOT NULL REFERENCES librarians(id),actor_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,subject TEXT NOT NULL,refs TEXT NOT NULL,due_at INTEGER NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL,cancel_requested INTEGER NOT NULL DEFAULT 0,dispatch_id TEXT NOT NULL,text TEXT NOT NULL,delivery_id TEXT,delivery_state TEXT,finished_at INTEGER,UNIQUE(librarian_id,actor_id,request_id))`,
			);
			store.run("CREATE INDEX IF NOT EXISTS research_queue ON research_runs(librarian_id,state,due_at,seq)");
			const prior = store.get("SELECT definition FROM librarians WHERE id=?", librarianId);
			if (prior && prior.definition !== definition)
				throw new MemoError("conflict", "Librarian scope or original runtime binding differs");
			store.run("INSERT OR IGNORE INTO librarians(id,definition) VALUES (?,?)", librarianId, definition);
			store.run(
				"CREATE TABLE IF NOT EXISTS research_slots(librarian_id TEXT PRIMARY KEY REFERENCES librarians(id),run_id TEXT REFERENCES research_runs(id),cancel_pending INTEGER NOT NULL DEFAULT 0)",
			);
			// Adopt existing candidate data conservatively; only explicit reconciliation can release it.
			store.run(
				"INSERT OR IGNORE INTO research_slots(librarian_id,run_id) VALUES (?,(SELECT id FROM research_runs WHERE librarian_id=? AND state NOT IN ('queued','cancelled') ORDER BY seq DESC LIMIT 1))",
				librarianId,
				librarianId,
			);
		});
		memo = openMemo({ file: options.file, providers: options.providers });
	} catch (error) {
		store.close();
		throw error;
	}
	const timers = new Set<ReturnType<typeof setInterval>>();
	function row(runId: string) {
		id(runId);
		const result = store.get("SELECT * FROM research_runs WHERE id=? AND librarian_id=?", runId, librarianId);
		if (!result) forbidden();
		return result;
	}
	function enabled() {
		store.check();
		if (store.get("SELECT enabled FROM librarians WHERE id=?", librarianId)?.enabled !== 1) forbidden();
	}
	function receipt(r: Row): ResearchReceipt {
		return frozen({
			runId: String(r.id),
			requestId: String(r.request_id),
			actorId: String(r.actor_id),
			at: Number(r.created_at),
		});
	}
	function view(r: Row): ResearchRun {
		const state = r.state;
		if (!["queued", "dispatching", "waiting", "unknown", "completed", "cancelled"].includes(String(state)))
			throw new MemoError("unavailable", "Invalid research state");
		const publications = store
			.all(
				"SELECT result FROM receipts WHERE actor_id=? AND substr(request_id,1,?)=? ORDER BY request_id LIMIT ?",
				workerId,
				String(r.id).length + 1,
				String(r.id) + ":",
				maxPublications,
			)
			.map((p) => persisted<Receipt>(String(p.result)));
		return frozen({
			runId: String(r.id),
			librarianId,
			actorId: String(r.actor_id),
			subject: String(r.subject),
			refs: persisted<MemoRef[]>(String(r.refs)),
			dueAt: Number(r.due_at),
			createdAt: Number(r.created_at),
			state: state as ResearchRun["state"],
			cancelRequested: r.cancel_requested === 1,
			executionHeld: slot().run_id === r.id,
			deliveryId: r.delivery_id === null ? null : String(r.delivery_id),
			deliveryState: r.delivery_state as ResearchRun["deliveryState"],
			finishedAt: r.finished_at === null ? null : Number(r.finished_at),
			publications,
		});
	}
	function slot() {
		const value = store.get("SELECT * FROM research_slots WHERE librarian_id=?", librarianId);
		if (!value) throw new MemoError("unavailable", "Research execution slot is missing");
		return value;
	}
	function active() {
		const current = slot();
		return current.run_id === null ? undefined : row(String(current.run_id));
	}
	function executionCheck(runId: string, check: () => void) {
		check();
		if (slot().run_id !== runId) forbidden();
		driver.check();
	}
	function updateDelivery(runId: string, delivery: ResearchDelivery, check: () => void) {
		id(delivery.id);
		if (!["queued", "placed", "done", "unanswered", "unknown"].includes(delivery.state))
			throw new MemoError("unavailable", "Invalid research delivery");
		store.transaction(() => {
			check();
			const old = row(runId);
			if (old.delivery_id !== null && old.delivery_id !== delivery.id)
				throw new MemoError("conflict", "Original delivery identity differs");
			if (terminal(old.delivery_state)) return;
			const state =
				old.state === "completed" ? "completed" : delivery.state === "unknown" ? "unknown" : "waiting";
			store.run(
				"UPDATE research_runs SET state=?,delivery_id=?,delivery_state=?,finished_at=CASE WHEN ?='cancelled' THEN ? ELSE finished_at END WHERE id=?",
				state,
				delivery.id,
				delivery.state,
				state,
				Date.now(),
				runId,
			);
			check();
		});
	}
	function dispatchCheck(runId: string, check: () => void) {
		check();
		enabled();
		const r = row(runId);
		if (r.cancel_requested === 1 || ["completed", "cancelled"].includes(String(r.state))) forbidden();
		driver.check();
	}
	async function observe(r: Row, check: () => void) {
		const delivery =
			r.delivery_id === null
				? await driver.lookup({ requestId: String(r.dispatch_id), text: String(r.text) }, check)
				: await driver.observe(String(r.delivery_id), check);
		check();
		if (delivery) updateDelivery(String(r.id), delivery, check);
		return row(String(r.id));
	}
	async function reconcile(r: Row, check: () => void) {
		check();
		if (slot().run_id !== r.id) return;
		const current = () => executionCheck(String(r.id), check);
		try {
			let latest = await observe(r, current);
			if (latest.cancel_requested === 1 && latest.delivery_id !== null) {
				const idle = await driver.idle(current);
				current();
				if (slot().cancel_pending === 1 || !terminal(latest.delivery_state) || !idle) {
					store.transaction(() => {
						current();
						store.run("UPDATE research_slots SET cancel_pending=1 WHERE librarian_id=?", librarianId);
					});
					// The driver coalesces the original cancellation across handles of one live Runtime.
					// A fresh Runtime can retry it while this same persisted run still owns the slot.
					await driver.cancel("cancel-" + String(r.id), current);
					store.transaction(() => {
						current();
						store.run("UPDATE research_slots SET cancel_pending=0 WHERE librarian_id=?", librarianId);
					});
					latest = await observe(row(String(r.id)), current);
				}
			}
			if (
				(latest.cancel_requested === 1 || latest.state === "completed") &&
				terminal(latest.delivery_state) &&
				slot().cancel_pending === 0 &&
				(await driver.idle(current))
			) {
				store.transaction(() => {
					current();
					const now = row(String(r.id));
					if (slot().cancel_pending !== 0 || !terminal(now.delivery_state)) return;
					if (now.cancel_requested === 1 && now.state !== "completed")
						store.run(
							"UPDATE research_runs SET state='cancelled',finished_at=? WHERE id=?",
							Date.now(),
							now.id,
						);
					else if (now.state !== "completed") return;
					store.run("UPDATE research_slots SET run_id=NULL WHERE librarian_id=?", librarianId);
				});
			}
		} catch {
			// Lost outcomes retain the original slot. A stale concurrent observer grants no new effects.
			check();
		}
	}
	function connect(actor: MemoActor): PatchouliClient {
		id(actor.id);
		if (typeof actor.check !== "function") invalid();
		const actorId = actor.id,
			actorCheck = actor.check;
		function check(action: "request" | "read" | "control") {
			store.check();
			try {
				if (actorCheck() !== undefined || policy(actorId, action) !== undefined) throw Error("Async policy");
			} catch {
				throw new MemoError("denied", "Research authority ended");
			}
		}
		async function advance() {
			check("control");
			enabled();
			driver.check();
			const old = active();
			if (old) {
				await reconcile(old, () => check("control"));
				if (active()) return;
			}
			if (!(await driver.idle(() => check("control")))) return;
			let acquired: Row | undefined;
			store.transaction(() => {
				check("control");
				enabled();
				if (active()) return;
				const next = store.get(
					"SELECT * FROM research_runs WHERE librarian_id=? AND state='queued' AND due_at<=? ORDER BY due_at,seq LIMIT 1",
					librarianId,
					Date.now(),
				);
				if (!next) return;
				store.run("UPDATE research_runs SET state='dispatching' WHERE id=? AND state='queued'", next.id);
				store.run(
					"UPDATE research_slots SET run_id=?,cancel_pending=0 WHERE librarian_id=?",
					next.id,
					librarianId,
				);
				acquired = next;
				check("control");
			});
			if (!acquired) return;
			const claimed = acquired,
				runId = String(claimed.id);
			try {
				const delivery = await driver.send(
					{ requestId: String(claimed.dispatch_id), text: String(claimed.text) },
					() => dispatchCheck(runId, () => check("control")),
				);
				updateDelivery(runId, delivery, () => check("control"));
			} catch {
				store.transaction(() => {
					check("control");
					store.run("UPDATE research_runs SET state='unknown' WHERE id=? AND state='dispatching'", runId);
				});
			}
			check("control");
		}
		return Object.freeze({
			async request(input: ResearchRequest) {
				input = data(input);
				shape(input, ["requestId", "subject", "refs", "dueAt"]);
				id(input.requestId);
				string(input.subject, 12 * 1024);
				references(input.refs);
				if (input.dueAt !== undefined) integer(input.dueAt);
				const copy = structuredClone(input),
					fingerprint = hash(copy);
				for (const ref of copy.refs) if (!scope.some((s) => s.libraryId === ref.libraryId)) forbidden();
				check("request");
				const result = store.transaction(() => {
					check("request");
					const prior = store.get(
						"SELECT * FROM research_runs WHERE librarian_id=? AND actor_id=? AND request_id=?",
						librarianId,
						actorId,
						copy.requestId,
					);
					if (prior) {
						if (prior.fingerprint !== fingerprint)
							throw new MemoError("conflict", "Research request identity reused");
						return receipt(prior);
					}
					const count = Number(
						store.get(
							"SELECT count(*) AS n FROM research_runs WHERE librarian_id=? AND state NOT IN ('completed','cancelled')",
							librarianId,
						)!.n,
					);
					if (count >= maxPending) throw new MemoError("conflict", "Research pending budget exhausted");
					const runId = randomUUID(),
						at = Date.now();
					const text = JSON.stringify({
						librarianId,
						runId,
						subject: copy.subject,
						refs: copy.refs,
						scope,
						writeRequestPrefix: runId + ":",
						instructions:
							"Read approved sources and research as needed. All Wiki writes must use the writeRequestPrefix. Complete this research with research_finish; an answer alone leaves the run waiting. No publication is required. Do not alter original sources.",
					});
					if (text.length > 65536) invalid("Research input exceeds MAS capacity");
					store.run(
						"INSERT INTO research_runs(id,librarian_id,actor_id,request_id,fingerprint,subject,refs,due_at,created_at,state,dispatch_id,text) VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?)",
						runId,
						librarianId,
						actorId,
						copy.requestId,
						fingerprint,
						copy.subject,
						JSON.stringify(copy.refs),
						copy.dueAt ?? at,
						at,
						"research-" + runId,
						text,
					);
					check("request");
					return receipt(row(runId));
				});
				try {
					check("request");
				} catch {
					throw new MemoError("unknown", "Research request committed; reconcile the original request");
				}
				return result;
			},
			async get(runId: string) {
				check("read");
				const result = view(row(runId));
				check("read");
				return result;
			},
			async setEnabled(value: boolean) {
				if (typeof value !== "boolean") invalid();
				store.transaction(() => {
					check("control");
					store.run("UPDATE librarians SET enabled=? WHERE id=?", value ? 1 : 0, librarianId);
					check("control");
				});
				try {
					check("control");
				} catch {
					throw new MemoError("unknown", "Librarian configuration committed; read before retrying");
				}
			},
			advance,
			async cancel(runId: string) {
				store.transaction(() => {
					check("control");
					const r = row(runId);
					if (r.state !== "queued" && slot().run_id !== runId) return;
					store.run(
						"UPDATE research_runs SET cancel_requested=1,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,finished_at=CASE WHEN state='queued' THEN ? ELSE finished_at END WHERE id=?",
						Date.now(),
						runId,
					);
					check("control");
				});
				const r = row(runId);
				if (slot().run_id !== runId) return;
				await reconcile(r, () => check("control"));
			},
			start(intervalMs = 1000) {
				integer(intervalMs, 100, 60000);
				check("control");
				enabled();
				let busy = false;
				const timer = setInterval(() => {
					if (busy) return;
					busy = true;
					void advance()
						.catch(() => {
							clearInterval(timer);
							timers.delete(timer);
						})
						.finally(() => {
							busy = false;
						});
				}, intervalMs);
				timer.unref();
				timers.add(timer);
				return () => {
					clearInterval(timer);
					timers.delete(timer);
				};
			},
		});
	}
	function invocation(scopeToken: ToolInvocationScope, runId?: string) {
		store.check();
		enabled();
		driver.checkInvocation(scopeToken);
		const r = active();
		if (!r || (runId !== undefined && r.id !== runId) || r.cancel_requested === 1 || r.state === "completed")
			forbidden();
		return r;
	}
	function knowledgeForInvocation(scopeToken: ToolInvocationScope): MemoClient {
		const runId = String(invocation(scopeToken).id),
			prefix = runId + ":";
		const check = () => {
			invocation(scopeToken, runId);
		};
		const original = memo.connect({ id: workerId, check });
		const allowed = (libraryId: string, write = false) => {
			check();
			if (!scope.some((s) => s.libraryId === libraryId && (!write || s.write))) forbidden();
		};
		const writing = (libraryId: string, requestId: string) => {
			allowed(libraryId, true);
			if (!requestId.startsWith(prefix)) invalid("Use the current research writeRequestPrefix");
			if (
				!store.get(
					"SELECT 1 AS found FROM receipts WHERE actor_id=? AND request_id=?",
					workerId,
					requestId,
				) &&
				Number(
					store.get(
						"SELECT count(*) AS n FROM receipts WHERE actor_id=? AND substr(request_id,1,?)=?",
						workerId,
						prefix.length,
						prefix,
					)!.n,
				) >= maxPublications
			)
				throw new MemoError("conflict", "Research publication budget exhausted");
		};
		function scoped(base: MemoClient): MemoClient {
			return Object.freeze({
				async libraries(q) {
					const value = await base.libraries(q);
					check();
					return frozen({
						...value,
						items: value.items.filter((v) => scope.some((s) => s.libraryId === v.id)),
					});
				},
				list(q) {
					q = data(q);
					allowed(q.libraryId);
					return base.list(q);
				},
				search(q) {
					q = data(q);
					if (q.libraryId === undefined) invalid("Select a research library explicitly");
					allowed(q.libraryId);
					return base.search(q);
				},
				async read(ref, q) {
					ref = data(ref);
					q = data(q);
					allowed(ref.libraryId);
					const value = await base.read(ref, q);
					check();
					return frozen({
						...value,
						sources: value.sources.filter((r) => scope.some((s) => s.libraryId === r.libraryId)),
					});
				},
				async history(q) {
					q = data(q);
					allowed(q.libraryId);
					const value = await base.history(q);
					check();
					return frozen({
						...value,
						items: value.items.map((v) => ({
							...v,
							sources: v.sources.filter((r) => scope.some((s) => s.libraryId === r.libraryId)),
						})),
					});
				},
				changes(q) {
					q = data(q);
					allowed(q.libraryId);
					return base.changes(q);
				},
				write(q) {
					q = data(q);
					writing(q.libraryId, q.requestId);
					return base.withAuthority(() => writing(q.libraryId, q.requestId)).write(q);
				},
				restore(q) {
					q = data(q);
					writing(q.libraryId, q.requestId);
					return base.withAuthority(() => writing(q.libraryId, q.requestId)).restore(q);
				},
				lookup(requestId) {
					check();
					if (!requestId.startsWith(prefix)) forbidden();
					return base.lookup(requestId);
				},
				async remove() {
					return forbidden();
				},
				async grant() {
					return forbidden();
				},
				async registerSource() {
					return forbidden();
				},
				async exportMarkdown() {
					return forbidden();
				},
				async importMarkdown() {
					return forbidden();
				},
				withAuthority(extra) {
					return scoped(base.withAuthority(extra));
				},
			} satisfies MemoClient);
		}
		return scoped(original);
	}
	return Object.freeze({
		connect,
		knowledgeForInvocation,
		async finish(scopeToken: ToolInvocationScope, input: { runId: string }) {
			input = data(input);
			shape(input, ["runId"]);
			id(input.runId);
			store.transaction(() => {
				invocation(scopeToken, input.runId);
				store.run(
					"UPDATE research_runs SET state='completed',finished_at=? WHERE id=?",
					Date.now(),
					input.runId,
				);
				driver.checkInvocation(scopeToken);
			});
			try {
				driver.checkInvocation(scopeToken);
			} catch {
				throw new MemoError("unknown", "Research completion committed but cannot be published");
			}
			return view(row(input.runId));
		},
		close() {
			for (const timer of timers) clearInterval(timer);
			timers.clear();
			memo.close();
			store.close();
		},
	});
}
