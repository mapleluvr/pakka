import { h, type TargetedSubmitEvent, type TargetedInputEvent, type TargetedEvent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, Icon, Notice, Stack } from "@pakka/webui/components";
import type { WebInterfaceProps } from "@pakka/webui/ui";
import { readMember, readReceipt, readInbox, type WorkbenchMember, type WorkbenchReceipt } from "./client.ts";
import type { ExtensionOperation } from "@pakka/webui/extension";
import { GraphBoard } from "./graph-board.ts";

const stylesheet = () => h("link", { rel: "stylesheet", href: new URL("board.css", import.meta.url).href });
export const Board = GraphBoard;
type Pending = { readonly requestId: string; readonly action: string };
function savedPending(key: string): Pending | null {
	try {
		const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
		return value &&
			typeof value.requestId === "string" &&
			["send", "steer", "reply", "abort", "retire"].includes(value.action)
			? value
			: null;
	} catch {
		return null;
	}
}
const inputModes = [
	["prompt", "Prompt"],
	["steer", "Steer"],
	["followUp", "Follow up"],
] as const;
function MemberModeMenu({
	trigger,
	mode,
	select,
	close,
}: {
	trigger: HTMLButtonElement;
	mode: string;
	select: (value: string) => void;
	close: () => void;
}) {
	const root = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		root.current?.querySelector<HTMLButtonElement>("button")?.focus();
		const outside = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				close();
			}
		};
		window.addEventListener("pointerdown", outside, true);
		window.addEventListener("keydown", escape, true);
		window.addEventListener("resize", close);
		return () => {
			window.removeEventListener("pointerdown", outside, true);
			window.removeEventListener("keydown", escape, true);
			window.removeEventListener("resize", close);
			if (trigger.isConnected) trigger.focus();
		};
	}, [trigger]);
	const rect = trigger.getBoundingClientRect();
	return h(
		"div",
		{
			ref: root,
			class: "member-mode-options",
			role: "menu",
			style: {
				position: "fixed",
				bottom: "auto",
				left: `${Math.max(8, Math.min(rect.right - 180, innerWidth - 188))}px`,
				top: `${Math.max(8, rect.top - 118)}px`,
			},
		},
		inputModes.map(([value, label]) =>
			h(
				"button",
				{
					type: "button",
					role: "menuitemradio",
					"aria-checked": mode === value,
					"data-mas-mode": value,
					onClick: () => {
						select(value);
						close();
					},
				},
				label,
			),
		),
	);
}
export function MemberPanel({ context }: WebInterfaceProps) {
	const pendingKey = `pakka.mas.pending:${JSON.stringify([context.extension, context.person.id, context.target])}`;
	const [pending, setPending] = useState<Pending | null>(() => savedPending(pendingKey));
	const remember = (value: Pending | null) => {
		setPending(value);
		try {
			if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value));
			else sessionStorage.removeItem(pendingKey);
		} catch {
			/* The current panel still retains the original identity. */
		}
	};
	const [member, setMember] = useState<WorkbenchMember | null>(null),
		[text, setText] = useState(""),
		[mode, setMode] = useState("prompt"),
		[retiring, setRetiring] = useState(false),
		[modeAnchor, setModeAnchor] = useState<HTMLButtonElement | null>(null),
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
	const finish = async (operation: ExtensionOperation) => {
		if (operation.state !== "done") {
			setNotice("Result unconfirmed. Check the original operation.");
			return;
		}
		if (["send", "steer", "reply"].includes(operation.action)) {
			let value = readReceipt(operation.value);
			if (value.status === "unknown") {
				const read = await context.call("receipt", { id: value.id });
				if (context.signal.aborted) return;
				if (read.state === "done") value = readReceipt(read.value);
			}
			setReceipt(value);
			if (value.status === "unknown") {
				setNotice("The native delivery result is unknown. Check the original operation again.");
				return;
			}
			setText("");
		} else setMember(readMember(operation.value));
		remember(null);
		setNotice("");
	};
	const reconcile = async () => {
		if (!pending || busy || context.signal.aborted) return;
		setBusy(true);
		try {
			const result = await context.operationByRequest(pending.requestId);
			if (!context.signal.aborted) await finish(result);
		} catch {
			if (!context.signal.aborted) setNotice("The original operation is unavailable or remains unconfirmed.");
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	const perform = async (action: string, receivedId?: string) => {
		if (busy || pending || !member || context.signal.aborted) return;
		const requestId = crypto.randomUUID();
		remember({ requestId, action });
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
				{ requestId },
			);
			if (context.signal.aborted) return;
			await finish(operation);
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
						h("dt", null, "Membership phase"),
						h("dd", { "data-member-phase": true }, member.phase),

						h("dt", null, "Owned by"),
						h("dd", null, member.parent ?? (member.owner ? "You" : "Another owner")),
						h("dt", null, "Conversation"),
						h("dd", null, member.ref.conversationId),
					),
					member.permissions.includes("send") &&
						h(
							"form",
							{
								class: "composer-card compact member-composer",
								onSubmit: (event: TargetedSubmitEvent<HTMLFormElement>) => {
									event.preventDefault();
									void perform(mode === "prompt" ? "send" : "steer");
								},
							},
							h(
								"div",
								{ class: "composer-surface" },
								h(
									"div",
									{ class: "composer-body" },
									h(
										"div",
										{ class: "composer-editor" },
										h("textarea", {
											name: "masMessage",
											value: text,
											required: true,
											maxLength: 16384,
											rows: 2,
											"aria-label": `Message to ${member.key}`,
											placeholder: "Reply to this Agent…",
											onInput: (event: TargetedInputEvent<HTMLTextAreaElement>) =>
												setText(event.currentTarget.value),
										}),
									),
									h(
										"div",
										{ class: "composer-toolbar" },
										h(
											"span",
											{ class: "native-mode-label" },
											mode === "prompt" ? "Prompt" : mode === "steer" ? "Steer" : "Follow up",
										),
										h(
											"div",
											{ class: "send-group", "data-empty": !text.trim() || busy || Boolean(pending) },

											h(
												"button",
												{
													class: "send-btn",
													type: "submit",
													"aria-label": "Send",
													"data-mas-send": true,
													disabled:
														busy ||
														Boolean(pending) ||
														!text.trim() ||
														["ended", "retired", "failed", "unknown"].includes(member.phase),
												},
												h(Icon, { name: "up" }),
											),

											member.permissions.includes("steer") &&
												h(
													"button",
													{
														class: "send-caret member-mode-trigger",
														type: "button",
														"aria-label": "Member input mode",
														"aria-haspopup": "menu",
														"aria-expanded": Boolean(modeAnchor),
														onClick: (event: TargetedEvent<HTMLButtonElement, MouseEvent>) =>
															setModeAnchor(modeAnchor ? null : event.currentTarget),
													},
													h(Icon, { name: "chevron" }),
												),
										),
									),
								),
							),
						),
					modeAnchor &&
						h(MemberModeMenu, {
							trigger: modeAnchor,
							mode,
							select: setMode,
							close: () => setModeAnchor(null),
						}),
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
												disabled: busy || Boolean(pending) || !text.trim(),

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
					pending &&
						h(
							"div",
							{ "data-mas-pending": pending.requestId, role: "status" },
							h("p", null, "An operation is awaiting confirmation. New controls are locked."),
							h(
								Button,
								{ "data-mas-reconcile": true, disabled: busy, onClick: () => void reconcile() },
								"Check original operation",
							),
						),
					notice && h(Notice, null, notice),
					member.reason && h(Notice, null, member.reason),
					member.permissions.includes("manage") &&
						h(
							"details",
							{ class: "member-management" },
							h("summary", { "data-member-management": true }, "Management"),
							h(
								"div",
								{ class: "mas-controls" },
								h(
									Button,
									{
										"data-mas-abort": true,
										disabled: busy || Boolean(pending) || member.phase === "retired",
										onClick: () => void perform("abort"),
									},
									"Stop work",
								),

								h(
									Button,
									{
										"data-mas-retire": true,
										disabled: busy || Boolean(pending) || member.phase === "retired",
										onClick: () => setRetiring(true),
									},
									"Retire member…",
								),
							),
							retiring &&
								h(
									"section",
									{ role: "group", "aria-label": "Confirm retirement", class: "member-retirement" },
									h(
										"p",
										null,
										`Retire ${member.key}? This changes membership; already admitted work may still need receipt verification.`,
									),
									h(
										Button,
										{
											"data-mas-confirm-retire": true,
											disabled: busy || Boolean(pending),
											onClick: () => {
												setRetiring(false);
												void perform("retire");
											},
										},
										"Confirm retirement",
									),

									h(Button, { "data-mas-cancel-retire": true, onClick: () => setRetiring(false) }, "Cancel"),
								),
						),
				),
	);
}
