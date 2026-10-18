import { h, type TargetedSubmitEvent, type TargetedInputEvent, type TargetedEvent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, Field, Icon, Notice, Stack } from "@pakka/webui/components";
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
export function MemberPanel({ context }: WebInterfaceProps) {
	const pendingKey = `pakka.mas.pending:${JSON.stringify([context.extension, context.person.id, context.target])}`;
	const [pending, setPending] = useState<Pending | null>(() => savedPending(pendingKey));
	const remember = (value: Pending | null) => {
		setPending(value);
		try {
			value
				? sessionStorage.setItem(pendingKey, JSON.stringify(value))
				: sessionStorage.removeItem(pendingKey);
		} catch {
			/* The current panel still retains the original identity. */
		}
	};
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
										busy ||
										!!pending ||
										!text.trim() ||
										["ended", "retired", "failed", "unknown"].includes(member.phase),
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
												disabled: busy || !!pending || !text.trim(),
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
							"div",
							{ class: "mas-controls" },
							h(
								Button,
								{
									"data-mas-abort": true,
									disabled: busy || !!pending || member.phase === "retired",
									onClick: () => {
										void perform("abort");
									},
								},
								"Stop work",
							),
							h(
								Button,
								{
									"data-mas-retire": true,
									disabled: busy || !!pending || member.phase === "retired",
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
