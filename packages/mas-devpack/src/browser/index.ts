import {
	h,
	type TargetedKeyboardEvent,
	type TargetedSubmitEvent,
	type TargetedInputEvent,
	type TargetedEvent,
} from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, Field, Icon, Notice, Stack } from "@pakka/webui/components";
import type { WebInterfaceProps } from "@pakka/webui/ui";
import {
	readBoard,
	readMember,
	readReceipt,
	readInbox,
	type WorkbenchMember,
	type WorkbenchView,
	type WorkbenchReceipt,
} from "./client.ts";

// Adapted from pi-pocket's pinned subagents-board.js: grouped cells, state filter, keyboard navigation and mobile detail.
// Native subagent stores, global subscriptions, routes and authority are deliberately absent; the host owns each instance.
const tone = (phase: WorkbenchMember["phase"]) =>
	phase === "active" || phase === "ready"
		? "working"
		: phase === "failed" || phase === "unknown"
			? "failed"
			: "stopped";
const stylesheet = () => h("link", { rel: "stylesheet", href: new URL("board.css", import.meta.url).href });
export function Board({ context }: WebInterfaceProps) {
	const [snapshot, setSnapshot] = useState<WorkbenchView | null>(null),
		[filter, setFilter] = useState("all"),
		[query, setQuery] = useState("");
	useEffect(
		() => context.subscribe("view", {}, (value) => setSnapshot(readBoard(value)), { intervalMs: 500 }),
		[context],
	);
	const members = snapshot?.members ?? [],
		phases = [...new Set(members.map((row) => row.phase))];
	const matching = members.filter(
		(row) =>
			(filter === "all" || row.phase === filter) &&
			[row.key, row.parent, row.lifetime, row.phase].join(" ").toLowerCase().includes(query.toLowerCase()),
	);
	const open = (member: WorkbenchMember) => context.open("member", { target: member.ref });
	return h(
		"section",
		{ class: "board mas-board", "aria-label": "MAS team members" },
		stylesheet(),
		h(
			"header",
			{ class: "board-head" },
			h(
				"div",
				{ class: "board-title" },
				h("h2", null, h(Icon, { name: "board" }), "Team"),
				h(
					"div",
					{ class: "board-sub" },
					`${members.length} visible members · ${snapshot?.namespace ?? "Loading"}`,
				),
			),
			h(
				"label",
				{ class: "board-search" },
				h("input", {
					"aria-label": "Find a member",
					value: query,
					onInput: (event) => setQuery(event.currentTarget.value),
					placeholder: "Find a member",
				}),
			),
		),
		h(
			"div",
			{ class: "board-summary-bar" },
			h(
				"div",
				{ class: "board-legend", role: "group", "aria-label": "Member lifecycle filter" },
				["all", ...phases].map((phase) =>
					h(
						"button",
						{
							key: phase,
							class: `board-filter ${filter === phase ? "on" : ""}`,
							"aria-pressed": filter === phase,
							onClick: () => setFilter(phase),
						},
						phase,
						h(
							"span",
							{ class: "board-filter-count" },
							phase === "all" ? members.length : members.filter((row) => row.phase === phase).length,
						),
					),
				),
			),
		),
		h(
			"div",
			{ class: "board-body" },
			h(
				"div",
				{ class: "board-main" },
				!snapshot
					? h("p", { class: "board-empty" }, "Loading members…")
					: matching.length === 0
						? h("p", { class: "board-empty" }, "No visible members match this filter.")
						: h(
								"div",
								{ class: "board-row" },
								h(
									"div",
									{ class: "board-session" },
									h("span", { class: "board-session-name" }, snapshot.namespace),
								),
								h(
									"div",
									{
										class: "board-cells",
										onKeyDown: (event: TargetedKeyboardEvent<HTMLDivElement>) => {
											if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
											const buttons = Array.from(
													event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
												),
												index = buttons.indexOf(document.activeElement as HTMLButtonElement);
											if (index < 0) return;
											event.preventDefault();
											buttons[
												Math.max(
													0,
													Math.min(
														buttons.length - 1,
														index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1),
													),
												)
											]?.focus();
										},
									},
									matching.map((member) =>
										h(
											"button",
											{
												key: member.key,
												"data-member": member.key,
												class: `board-cell ${tone(member.phase)}`,
												title: `${member.key} · ${member.phase} · ${member.lifetime}${member.parent ? " · owned by " + member.parent : ""}`,
												"aria-label": `${member.key}, ${member.phase}, ${member.lifetime}`,
												onClick: () => open(member),
											},
											member.key.slice(0, 2).toUpperCase(),
										),
									),
								),
							),
			),
		),
	);
}
export function MemberPanel({ context }: WebInterfaceProps) {
	const [member, setMember] = useState<WorkbenchMember | null>(null),
		[text, setText] = useState(""),
		[mode, setMode] = useState("prompt"),
		[receipt, setReceipt] = useState<WorkbenchReceipt | null>(null),
		[inbox, setInbox] = useState<readonly WorkbenchReceipt[]>([]),
		[busy, setBusy] = useState(false),
		[notice, setNotice] = useState("");
	useEffect(
		() => context.subscribe("inspect", {}, (value) => setMember(readMember(value)), { intervalMs: 500 }),
		[context],
	);
	const canReply = member?.permissions.includes("send") && member.phase === "active";
	useEffect(() => {
		if (!canReply) {
			setInbox([]);
			return;
		}
		return context.subscribe("inbox", {}, (value) => setInbox(readInbox(value)), { intervalMs: 500 });
	}, [context, canReply]);
	useEffect(() => {
		if (!receipt || !["queued", "placed"].includes(receipt.status)) return;
		const timer = setTimeout(() => {
			void context
				.call("receipt", { id: receipt.id })
				.then((operation) => {
					if (operation.state === "done" && !context.signal.aborted) setReceipt(readReceipt(operation.value));
				})
				.catch(() => {
					if (!context.signal.aborted)
						setNotice("Receipt observation interrupted. The admitted work may still be running.");
				});
		}, 350);
		return () => clearTimeout(timer);
	}, [context, receipt]);
	const perform = async (action: string, receivedId?: string) => {
		if (busy || !member) return;
		setBusy(true);
		setNotice("");
		try {
			const operation = await context.call(
				action,
				action === "send"
					? { text }
					: action === "steer"
						? { text, mode }
						: action === "reply" && receivedId
							? { id: receivedId, text }
							: {},
			);
			if (context.signal.aborted) return;
			if (operation.state !== "done") {
				setNotice("Result unconfirmed. Check the original receipt before retrying.");
				return;
			}
			if (action === "send" || action === "steer" || action === "reply") {
				setReceipt(readReceipt(operation.value));
				setText("");
			} else setMember(readMember(operation.value));
		} catch {
			if (!context.signal.aborted) setNotice("Operation unavailable or unconfirmed. No retry was sent.");
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	return h(
		Stack,
		null,
		stylesheet(),
		!member
			? h(Notice, null, "Loading member…")
			: h(
					"div",
					{ class: "mas-member" },
					h("h3", null, member.key),
					h(
						"dl",
						null,
						h("dt", null, "Lifecycle"),
						h("dd", { "data-member-phase": true }, member.phase),
						h("dt", null, "Lifetime"),
						h("dd", null, member.lifetime),
						h("dt", null, "Owned by"),
						h("dd", null, member.parent ?? (member.owner ? "You" : "Another owner")),
						h("dt", null, "Conversation"),
						h("dd", null, member.ref.conversationId),
					),
					member.permissions.includes("send") &&
						h(
							"form",
							{
								onSubmit: (event: TargetedSubmitEvent<HTMLFormElement>) => {
									event.preventDefault();
									void perform(mode === "prompt" ? "send" : "steer");
								},
							},
							h(
								Field,
								{ label: "Message" },
								h("textarea", {
									name: "masMessage",
									value: text,
									required: true,
									maxLength: 16384,
									onInput: (event: TargetedInputEvent<HTMLTextAreaElement>) =>
										setText(event.currentTarget.value),
								}),
							),
							member.permissions.includes("steer") &&
								h(
									Field,
									{ label: "Input mode" },
									h(
										"select",
										{
											value: mode,
											onChange: (event: TargetedEvent<HTMLSelectElement, Event>) =>
												setMode(event.currentTarget.value),
										},
										h("option", { value: "prompt" }, "Prompt"),
										h("option", { value: "steer" }, "Steer current work"),
										h("option", { value: "followUp" }, "Queue follow-up"),
									),
								),
							h(
								Button,
								{
									type: "submit",
									disabled:
										busy || !text.trim() || ["ended", "retired", "failed", "unknown"].includes(member.phase),
									"data-mas-send": true,
								},
								"Send",
							),
						),
					canReply &&
						inbox.length > 0 &&
						h(
							"section",
							{ "data-mas-inbox": true },
							h("h4", null, "Recent peer receipts (up to 128)"),
							h(
								"ul",
								null,
								inbox.map((incoming) =>
									h(
										"li",
										{ key: incoming.id },
										h("span", null, `${incoming.status} · ${incoming.id}`),
										h(
											Button,
											{
												"data-mas-reply": incoming.id,
												disabled: busy || !text.trim(),
												onClick: () => {
													void perform("reply", incoming.id);
												},
											},
											"Reply",
										),
									),
								),
							),
						),
					receipt &&
						h(
							"p",
							{ "data-mas-receipt": receipt.id, role: "status" },
							`${receipt.status}${receipt.reason ? " (" + receipt.reason + ")" : ""} · ${receipt.id}`,
						),
					notice && h(Notice, null, notice),
					member.reason && h(Notice, null, member.reason),
					member.permissions.includes("manage") &&
						h(
							"div",
							{ class: "mas-controls" },
							h(
								Button,
								{
									disabled: busy || member.phase === "retired",
									"data-mas-abort": true,
									onClick: () => {
										void perform("abort");
									},
								},
								"Stop work",
							),
							h(
								Button,
								{
									disabled: busy || member.phase === "retired",
									"data-mas-retire": true,
									onClick: () => {
										void perform("retire");
									},
								},
								"Retire member",
							),
						),
				),
	);
}
