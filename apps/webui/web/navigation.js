import { h } from "preact";
import { useState, useRef, useLayoutEffect } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { Sheet } from "./sheet.js";
const html = htm.bind(h);

export function ConversationSettings({
	target,
	name,
	state,
	entries,
	canManage,
	client,
	changed,
	refresh,
	pending,
	setPending,
	close,
	error,
}) {
	const [title, setTitle] = useState(name),
		[forkName, setForkName] = useState(""),
		[entryId, setEntryId] = useState(entries.at(-1)?.id ?? ""),
		[busy, setBusy] = useState(false),
		[reconciliation, setReconciliation] = useState("");
	const live = useRef(true);
	// A reply belongs to this exact resource/view; cleanup never cancels admitted metadata or forks.
	useLayoutEffect(
		() => () => {
			live.current = false;
		},
		[],
	);
	async function perform(command, lookup = false) {
		setBusy(true);
		setReconciliation("");
		if (!lookup) setPending(command);
		try {
			const result = await client.request(
				lookup ? { op: "conversation.lookup", original: command } : command,
			);
			if (!live.current) return;
			if (lookup && !result.result) {
				setReconciliation("Original result unconfirmed. Replacement submission remains blocked.");
				return;
			}
			setPending(null);
			await changed(
				lookup
					? result.command === "conversation.set"
						? result.result.ref
						: result.result
					: result.kind === "reference"
						? result.ref
						: target,
				command.op === "conversation.set" && command.input.archived,
			);
			if (live.current) close();
		} catch (failure) {
			if (live.current) {
				if (!lookup && failure.outcome === "denied") setPending(null);
				error(failure);
			}
		} finally {
			if (live.current) setBusy(false);
		}
	}
	return html`<${Sheet} label="Conversation Details" close=${close}>
			<header><h2>Conversation</h2><button class="pocket-icon-button" aria-label="Close conversation details" onClick=${close}><${Icon} name="close" /></button></header>
			<div class="pocket-sheet-body">
				<p>${state.archived ? "Archived" : "Active"} · metadata version ${state.version}/256</p>
				${state.version >= 256 && html`<p role="status">Metadata capacity reached. Original receipts are retained; no more metadata writes are admitted.</p>`}
				<form class="pocket-form" onSubmit=${(event) => {
					event.preventDefault();
					void perform({
						op: "conversation.set",
						target,
						input: {
							requestId: crypto.randomUUID(),
							expectedVersion: state.version,
							name: title,
							archived: state.archived,
						},
					});
				}}>
					<label>Conversation name<input name="conversationName" maxlength="80" value=${title} disabled=${!canManage || state.version >= 256 || busy || !!pending} onInput=${(event) => setTitle(event.currentTarget.value)} required /></label>
					<button class="button" data-action="rename" disabled=${!canManage || state.version >= 256 || busy || !!pending}>Save name</button>
				</form>
				<button class="button" data-action=${state.archived ? "restore" : "archive"} disabled=${!canManage || state.version >= 256 || busy || !!pending} onClick=${() => void perform({ op: "conversation.set", target, input: { requestId: crypto.randomUUID(), expectedVersion: state.version, name, archived: !state.archived } })}>${state.archived ? "Restore conversation" : "Archive conversation"}</button>
				${
					canManage &&
					html`<form
						class="pocket-form"
						onSubmit=${(event) => {
							event.preventDefault();
							void perform({
								op: "fork",
								target,
								requestId: crypto.randomUUID(),
								name: forkName,
								profile: target.profile,
								entryId,
							});
						}}
					>
						<h3>Fork Committed History</h3>
						<label
							>Fork name<input
								name="forkName"
								value=${forkName}
								maxlength="80"
								onInput=${(event) => setForkName(event.currentTarget.value)}
								required
								disabled=${busy || !!pending}
						/></label>
						<label
							>Last inherited entry<select
								aria-label="Fork through entry"
								value=${entryId}
								onChange=${(event) => setEntryId(event.currentTarget.value)}
								disabled=${busy || !!pending}
							>
								${entries
									.filter((entry) => /^[0-9]+$/.test(entry.id))
									.map((entry) => html`<option value=${entry.id}>Entry ${entry.id} · ${entry.kind}</option>`)}
							</select></label
						>
						<button
							class="button"
							data-action="fork"
							disabled=${busy || !!pending || !entryId || !forkName.trim()}
						>
							Create fork
						</button>
					</form>`
				}
				${
					pending &&
					html`<div class="pocket-form" role="status">
						<p>Result unconfirmed. Reconcile the same original request; do not submit a replacement.</p>
						${reconciliation && html`<p>${reconciliation}</p>`}
						<button
							class="button"
							data-action="reconcile-original"
							disabled=${busy}
							onClick=${() => void perform(pending, true)}
						>
							Check original request</button
						><button class="button" disabled=${busy} onClick=${() => void refresh().catch(error)}>
							Read current metadata
						</button>
					</div>`
				}
			</div>
	</${Sheet}>`;
}
