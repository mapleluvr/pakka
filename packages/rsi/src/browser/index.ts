import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Icon } from "@pakka/webui/components";
import type { WebInterfaceProps } from "@pakka/webui/ui";
import type { ExtensionJson } from "@pakka/webui/extension";
import {
	ticketCall,
	readTicketResult,
	TicketCallError,
	type ActionValues,
	type TicketPage,
	type TicketView,
	type TicketState,
} from "./client.ts";

type Editor = { id: string | null; version: number; title: string; body: string; sources: string };
type WriteAction = "submit" | "edit" | "assign" | "set-state" | "dispatch" | "recover";

const labels: Record<TicketState, string> = {
	open: "Open",
	active: "In progress",
	waiting: "Waiting",
	closed: "Closed",
};
const date = (value: number) =>
	new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
function references(value: string): string[] {
	return value
		.split("\n")
		.map((row) => row.trim())
		.filter(Boolean);
}
function storedRequest(key: string): string | null {
	try {
		const value = sessionStorage.getItem(key);
		return value && /^[a-zA-Z0-9-]{1,160}$/.test(value) ? value : null;
	} catch {
		return null;
	}
}
function Reference({ value }: { value: string }) {
	if (/^https?:\/\//i.test(value))
		return h("a", { href: value, target: "_blank", rel: "noreferrer noopener" }, value);
	return h("span", null, value);
}
export function Tickets({ context }: WebInterfaceProps) {
	const pendingKey = `pakka.rsi.request:${context.person.id}:${context.extension}`;
	const [page, setPage] = useState<TicketPage>({ items: [], cursor: null });
	const [capabilities, setCapabilities] = useState<ActionValues["capabilities"] | null>(null);
	const [view, setView] = useState<TicketView | null>(null),
		[editor, setEditor] = useState<Editor | null>(null);
	const [filter, setFilter] = useState(""),
		[loading, setLoading] = useState(true),
		[busy, setBusy] = useState(false);
	const [problem, setProblem] = useState(""),
		[notice, setNotice] = useState("");
	const [pending, setPending] = useState<string | null>(() => storedRequest(pendingKey));
	const [report, setReport] = useState(""),
		[reportLinks, setReportLinks] = useState("");
	const [nextState, setNextState] = useState<TicketState>("active"),
		[handlerId, setHandlerId] = useState("");
	const live = useRef(true),
		locked = useRef(false),
		selected = useRef<string | null>(null),
		readEpoch = useRef(0),
		detailEpoch = useRef(0);
	const alive = () => live.current && !context.signal.aborted;
	const remember = (value: string | null) => {
		try {
			if (value) sessionStorage.setItem(pendingKey, value);
			else sessionStorage.removeItem(pendingKey);
		} catch {
			/* The mounted UI still retains the original request. */
		}
		setPending(value);
	};
	const load = async (id: string) => {
		const epoch = ++detailEpoch.current;
		const result = await ticketCall(context, "get", { id });
		if (alive() && selected.current === id && detailEpoch.current === epoch) {
			setView(result);
			setHandlerId(result.ticket.handler?.id ?? "");
		}
	};
	const refresh = async (append = false) => {
		const epoch = ++readEpoch.current;
		try {
			const query = {
				...(filter ? { state: filter } : {}),
				...(append && page.cursor ? { cursor: page.cursor } : {}),
				limit: 20,
			};
			const [result, caps] = await Promise.all([
				ticketCall(context, "list", query),
				ticketCall(context, "capabilities"),
			]);
			if (!alive() || epoch !== readEpoch.current) return;
			setPage(result);
			setCapabilities(caps);
			setLoading(false);
			if (selected.current) await load(selected.current);
		} catch (error) {
			if (!alive() || epoch !== readEpoch.current) return;
			setPage({ items: [], cursor: null });
			setView(null);
			setCapabilities(null);
			setLoading(false);
			setProblem(error instanceof Error ? error.message : "Tickets are unavailable");
		}
	};
	useEffect(() => {
		live.current = true;
		void refresh();
		return () => {
			live.current = false;
			readEpoch.current++;
		};
	}, [context, filter]);
	const observation = useRef({ refresh, blocked: !!editor || busy || !!pending });
	observation.current = { refresh, blocked: !!editor || busy || !!pending };
	useEffect(() => {
		let applied: string | undefined,
			refreshing = false;
		return context.subscribe(
			"observe",
			{},
			(value) => {
				try {
					const next = readTicketResult("observe", value).revision;
					if (applied === undefined) {
						applied = next;
						return;
					}
					if (next === applied || refreshing || observation.current.blocked) return;
					applied = next;
					refreshing = true;
					void observation.current.refresh().finally(() => {
						refreshing = false;
					});
				} catch (error) {
					if (alive()) setProblem(error instanceof Error ? error.message : "Observation unavailable");
				}
			},
			{ intervalMs: 1000 },
		);
	}, [context]);
	useEffect(() => {
		if (!editor) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [!!editor]);
	const choose = async (id: string) => {
		if (editor && !window.confirm("Discard the unsaved draft?")) return;
		selected.current = id;
		setEditor(null);
		setView(null);
		setProblem("");
		setNotice("");
		try {
			await load(id);
		} catch (error) {
			if (alive()) setProblem(error instanceof Error ? error.message : "Ticket unavailable");
		}
	};
	const change = async (action: WriteAction, input: ExtensionJson) => {
		if (locked.current || pending || !alive()) return;
		locked.current = true;
		setBusy(true);
		setProblem("");
		setNotice("");
		const requestId = crypto.randomUUID();
		remember(requestId);
		try {
			const result = await ticketCall(context, action, input, requestId);
			if (!alive()) return;
			remember(null);
			setEditor(null);
			setReport("");
			setReportLinks("");
			selected.current = result.id;
			setNotice(action === "dispatch" ? "Work dispatched. Use Refresh to check delivery." : "Saved");
			await refresh();
		} catch (error) {
			if (!alive()) return;
			if (error instanceof TicketCallError && error.status !== "unknown") remember(null);
			setProblem(error instanceof Error ? error.message : "Result unconfirmed. Check the original request.");
		} finally {
			locked.current = false;
			if (alive()) setBusy(false);
		}
	};
	const reconcile = async () => {
		if (!pending || locked.current) return;
		locked.current = true;
		setBusy(true);
		try {
			const operation = await context.operationByRequest(pending);
			if (!alive()) return;
			if (!["submit", "edit", "assign", "set-state", "dispatch", "recover"].includes(operation.action))
				throw new Error("The original request is not a ticket mutation.");
			let found: ActionValues["lookup"] = null;
			if (operation.state === "done") {
				try {
					found = readTicketResult(operation.action as WriteAction, operation.value);
				} catch (error) {
					if (error instanceof TicketCallError && error.status !== "unknown") {
						remember(null);
						throw error;
					}
				}
			}
			// BackendContext.requestId is the host operation ID, not the browser's request key.
			if (!found) found = await ticketCall(context, "lookup", { requestId: operation.id });
			if (!alive()) return;
			if (!found) throw new Error("The original request is still unconfirmed.");
			remember(null);
			setEditor(null);
			selected.current = found.id;
			setProblem("");
			setNotice("Original request confirmed");
			await refresh();
		} catch (error) {
			if (alive()) setProblem(error instanceof Error ? error.message : "Original request unavailable");
		} finally {
			locked.current = false;
			if (alive()) setBusy(false);
		}
	};
	const older = async (kind: keyof TicketView["cursors"]) => {
		if (!view || locked.current || !view.cursors[kind]) return;
		const id = view.ticket.id,
			cursor = view.cursors[kind],
			epoch = ++detailEpoch.current;
		locked.current = true;
		setBusy(true);
		setProblem("");
		try {
			const result = await ticketCall(context, "history", { id, kind, cursor, limit: 32 });
			if (!alive() || selected.current !== id || epoch !== detailEpoch.current) return;
			setView((current) => {
				if (!current || current.ticket.id !== id) return current;
				const ticket =
					result.kind === "events"
						? { ...current.ticket, events: result.items }
						: result.kind === "revisions"
							? { ...current.ticket, revisions: result.items }
							: { ...current.ticket, runs: result.items };
				return { ...current, ticket, cursors: { ...current.cursors, [kind]: result.cursor } };
			});
		} catch (error) {
			if (alive()) setProblem(error instanceof Error ? error.message : "History unavailable");
		} finally {
			locked.current = false;
			if (alive()) setBusy(false);
		}
	};
	const historyButton = (kind: keyof TicketView["cursors"]) =>
		view?.cursors[kind]
			? h(
					Button,
					{ disabled: busy, "data-ticket-history": kind, onClick: () => void older(kind) },
					"Earlier " + kind,
				)
			: null;
	const refreshRuns = async () => {
		if (!view || busy) return;
		setBusy(true);
		setProblem("");
		try {
			for (const run of view.ticket.runs)
				await ticketCall(context, "refresh", { id: view.ticket.id, runId: run.id });
			await refresh();
		} catch (error) {
			if (alive()) setProblem(error instanceof Error ? error.message : "Delivery observation unavailable");
		} finally {
			if (alive()) setBusy(false);
		}
	};
	const editField = (field: keyof Pick<Editor, "title" | "body" | "sources">, value: string) =>
		setEditor((previous) => (previous ? { ...previous, [field]: value } : previous));
	const field = (
		label: string,
		name: string,
		value: string,
		onInput: (value: string) => void,
		multiline = false,
		maxLength = 12000,
	) =>
		h(
			"label",
			{ class: "rsi-field" },
			h("span", null, label),
			h(multiline ? "textarea" : "input", {
				name,
				value,
				maxLength,
				rows: multiline ? 5 : undefined,
				disabled: busy || !!pending,
				onInput: (event: Event) => onInput((event.currentTarget as HTMLInputElement).value),
			}),
		);
	const ticket = view?.ticket;
	const listContent = () => {
		if (loading) return h("p", { role: "status" }, "Loading tickets…");
		if (page.items.length === 0) return h("p", { class: "rsi-empty" }, "No tickets yet.");
		return page.items.map((row) =>
			h(
				"button",
				{
					key: row.id,
					type: "button",
					class: "rsi-row",
					"data-ticket-row": row.id,
					"aria-pressed": row.id === ticket?.id,
					onClick: () => void choose(row.id),
				},
				h("strong", null, row.title),
				h("span", null, labels[row.state], row.handler ? ` · ${row.handler.label}` : ""),
				h("time", { dateTime: new Date(row.updatedAt).toISOString() }, date(row.updatedAt)),
			),
		);
	};
	return h(
		"section",
		{ class: "rsi-tickets", "data-rsi-tickets": true },
		h("link", { rel: "stylesheet", href: new URL("./tickets.css", import.meta.url).href }),
		h(
			"header",
			{ class: "rsi-heading" },
			h("div", null, h("h1", null, "Tickets"), h("p", null, "Ideas and work, with a shared history.")),
			h(
				"div",
				{ class: "rsi-actions" },
				h(
					Button,
					{
						disabled: busy,
						onClick: () => {
							void refreshRuns();
							if (!view) void refresh();
						},
						"data-ticket-refresh": true,
					},
					h(Icon, { name: "reset" }),
					"Refresh",
				),
				capabilities?.submit &&
					h(
						Button,
						{
							"data-ticket-new": true,
							disabled: busy || !!pending,
							onClick: () => {
								if (editor && !window.confirm("Discard the unsaved draft?")) return;
								setEditor({ id: null, version: 0, title: "", body: "", sources: "" });
								setProblem("");
							},
						},
						h(Icon, { name: "plus" }),
						"New ticket",
					),
			),
		),
		problem && h("div", { role: "alert", class: "rsi-problem" }, problem),
		notice && h("p", { role: "status", class: "rsi-notice" }, notice),
		pending &&
			h(
				"div",
				{ class: "rsi-pending", role: "status" },
				"A request is awaiting confirmation.",
				h(Button, { disabled: busy, onClick: () => void reconcile() }, "Check original request"),
			),
		editor
			? h(
					"form",
					{
						class: "rsi-editor",
						onSubmit: (event: Event) => {
							event.preventDefault();
							void change(editor.id ? "edit" : "submit", {
								...(editor.id ? { id: editor.id, expectedVersion: editor.version } : {}),
								title: editor.title.trim(),
								body: editor.body.trim(),
								sources: references(editor.sources),
							});
						},
						onKeyDown: (event: KeyboardEvent) => {
							if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
								event.preventDefault();
								(event.currentTarget as HTMLFormElement).requestSubmit();
							}
						},
					},
					h("h2", null, editor.id ? "Edit ticket" : "New ticket"),
					field("Title", "ticket-title", editor.title, (v) => editField("title", v), false, 200),
					field("Description", "ticket-body", editor.body, (v) => editField("body", v), true),
					field(
						"Sources · one reference per line",
						"ticket-sources",
						editor.sources,
						(v) => editField("sources", v),
						true,
						16384,
					),
					h(
						"div",
						{ class: "rsi-actions" },
						h(
							Button,
							{ type: "submit", disabled: busy || !!pending, "data-ticket-save": true },
							busy ? "Saving…" : "Save ticket",
						),
						h(
							Button,
							{
								disabled: busy || !!pending,
								onClick: () => {
									if (window.confirm("Discard the unsaved draft?")) setEditor(null);
								},
							},
							"Cancel",
						),
					),
				)
			: h(
					"div",
					{ class: "rsi-layout", "data-selected": !!ticket },
					h(
						"aside",
						{ class: "rsi-list", "aria-label": "Ticket list" },
						h(
							"label",
							{ class: "rsi-filter" },
							"Status",
							h(
								"select",
								{
									value: filter,
									onChange: (event: Event) => {
										selected.current = null;
										setView(null);
										setFilter((event.currentTarget as HTMLSelectElement).value);
									},
								},
								h("option", { value: "" }, "All tickets"),
								Object.entries(labels).map(([value, label]) => h("option", { key: value, value }, label)),
							),
						),
						listContent(),
						page.cursor && h(Button, { onClick: () => void refresh(true), disabled: busy }, "Next tickets"),
					),
					ticket && view
						? h(
								"article",
								{ class: "rsi-detail", "data-ticket-detail": ticket.id },
								h(
									Button,
									{
										class: "rsi-back",
										onClick: () => {
											selected.current = null;
											setView(null);
										},
									},
									"Back to tickets",
								),
								h(
									"div",
									{ class: "rsi-detail-heading" },
									h("span", { class: "rsi-state", "data-ticket-state": ticket.state }, labels[ticket.state]),
									h("span", { class: "rsi-meta" }, `Revision ${ticket.contentRevision}`),
								),
								h("h2", null, ticket.title),
								h("p", { class: "rsi-body" }, ticket.body),
								ticket.sources.length > 0 &&
									h(
										"ul",
										{ class: "rsi-sources" },
										ticket.sources.map((value, i) => h("li", { key: i }, h(Reference, { value }))),
									),
								view.permissions.edit &&
									h(
										Button,
										{
											"data-ticket-edit": true,
											disabled: busy || !!pending,
											onClick: () =>
												setEditor({
													id: ticket.id,
													version: ticket.version,
													title: ticket.title,
													body: ticket.body,
													sources: ticket.sources.join("\n"),
												}),
										},
										"Edit ticket",
									),
								view.permissions.assign &&
									h(
										"section",
										{ class: "rsi-section" },
										h("h3", null, "Handler"),
										h(
											"div",
											{ class: "rsi-actions" },
											h(
												"select",
												{
													"aria-label": "Assigned handler",
													value: handlerId,
													disabled: busy || !!pending,
													onChange: (event: Event) =>
														setHandlerId((event.currentTarget as HTMLSelectElement).value),
												},
												h("option", { value: "" }, "Unassigned"),
												capabilities?.handlers.map((row) =>
													h("option", { value: row.id, key: row.id }, row.label),
												),
											),
											h(
												Button,
												{
													disabled: busy || !!pending,
													onClick: () =>
														void change("assign", {
															id: ticket.id,
															expectedVersion: ticket.version,
															handlerId: handlerId || null,
														}),
												},
												"Assign",
											),
											view.permissions.dispatch &&
												h(
													Button,
													{
														disabled:
															busy ||
															!!pending ||
															!ticket.handler ||
															ticket.state === "closed" ||
															ticket.runs.some((r) =>
																["pending", "queued", "placed", "unknown"].includes(r.state),
															),
														onClick: () =>
															void change("dispatch", { id: ticket.id, expectedVersion: ticket.version }),
													},
													"Start work",
												),
										),
									),
								(ticket.runs.length > 0 || view.cursors.runs) &&
									h(
										"section",
										{ class: "rsi-section" },
										h("h3", null, "Runs"),
										historyButton("runs"),
										ticket.runs.map((run) =>
											h(
												"p",
												{ key: run.id },
												`Revision ${run.contentRevision} · ${run.handlerId} · ${run.state}`,
												view.permissions.dispatch &&
													["planned", "dispatching", "unknown"].includes(run.stage) &&
													h(
														Button,
														{
															disabled: busy || !!pending,
															"data-ticket-recover": run.id,
															onClick: () =>
																void change("recover", {
																	id: ticket.id,
																	runId: run.id,
																	expectedVersion: ticket.version,
																}),
														},
														run.stage === "planned" ? "Continue planned work" : "Reconcile original work",
													),
											),
										),
									),
								view.permissions.setState &&
									h(
										"form",
										{
											class: "rsi-section",
											onSubmit: (event: Event) => {
												event.preventDefault();
												void change("set-state", {
													id: ticket.id,
													expectedVersion: ticket.version,
													state: nextState,
													text: report.trim(),
													links: references(reportLinks),
												});
											},
										},
										h("h3", null, "Current state decision"),
										field("Update", "ticket-report", report, setReport, true),
										field(
											"Decision references · one per line",
											"ticket-results",
											reportLinks,
											setReportLinks,
											true,
											16384,
										),
										h(
											"div",
											{ class: "rsi-actions" },
											h(
												"select",
												{
													name: "ticket-state",
													"aria-label": "Next ticket status",
													value: nextState,
													disabled: busy || !!pending,
													onChange: (event: Event) =>
														setNextState((event.currentTarget as HTMLSelectElement).value as TicketState),
												},
												Object.entries(labels).map(([value, label]) =>
													h("option", { key: value, value }, label),
												),
											),
											h(
												Button,
												{ type: "submit", disabled: busy || !!pending, "data-ticket-report": true },
												"Save state decision",
											),
										),
									),
								h(
									"section",
									{ class: "rsi-section" },
									h("h3", null, "History"),
									historyButton("events"),
									h(
										"ol",
										{ class: "rsi-history" },
										[...ticket.events].reverse().map((event) =>
											h(
												"li",
												{ key: event.version },
												h("p", null, event.text),
												h("small", null, date(event.at), " · ", event.actorId),
												event.links.map((value, i) => h("div", { key: i }, h(Reference, { value }))),
												event.runId && h("small", null, "Run " + event.runId),
												event.results?.map((result, i) =>
													h(
														"div",
														{ key: "result:" + i },
														h(Reference, { value: result.uri }),
														result.description && h("p", null, result.description),
														result.version && h("small", null, "Version " + result.version),
														result.sha256 && h("code", null, result.sha256),
													),
												),
											),
										),
									),
								),
								h(
									"details",
									{ class: "rsi-section" },
									h("summary", null, "Content revisions"),
									historyButton("revisions"),
									[...ticket.revisions].reverse().map((revision) =>
										h(
											"section",
											{ key: revision.revision, class: "rsi-revision" },
											h("h4", null, `Revision ${revision.revision} · ${revision.title}`),
											h("p", { class: "rsi-body" }, revision.body),
											revision.sources.map((value, i) => h("div", { key: i }, h(Reference, { value }))),
										),
									),
								),
							)
						: h("div", { class: "rsi-empty" }, "Choose a ticket to see its progress."),
				),
	);
}
