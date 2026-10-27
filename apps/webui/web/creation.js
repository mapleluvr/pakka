import { h } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { Sheet } from "./sheet.js";
import { ModelPicker, DirectoryPicker } from "./conversation-configuration.js";
const html = htm.bind(h);
const unknown = (value) => ["session-unknown", "conversation-unknown"].includes(value?.phase);

/** One creation flow; dismissing its view never releases an unconfirmed operation. */
export function useCreation({
	person,
	workspaceSessionId,
	configuration,
	selected,
	client,
	created,
	sessionCreated,
	error,
}) {
	const [value, setValue] = useState(null),
		[visible, setVisible] = useState(false),
		[picker, setPicker] = useState(null);
	const current = useRef(null),
		opened = useRef(false),
		live = useRef(true),
		latest = useRef(null);
	latest.current = { person, workspaceSessionId, configuration, selected };
	useEffect(
		() => () => {
			live.current = false;
		},
		[],
	);
	useEffect(() => {
		current.current = null;
		setValue(null);
		opened.current = false;
		setVisible(false);
		setPicker(null);
	}, [person?.id, workspaceSessionId]);
	const valid = (id) =>
		live.current && current.current?.id === id && current.current.actorId === latest.current.person?.id;
	function update(next) {
		current.current = next;
		if (live.current) setValue(next);
		return next;
	}
	function show() {
		opened.current = true;
		setVisible(true);
	}
	function close() {
		opened.current = false;
		setVisible(false);
		setPicker(null);
		if (!current.current?.pending && !unknown(current.current) && !current.current?.parent) update(null);
	}
	async function open(kind, parentId) {
		const prior = current.current;
		if (prior && (prior.pending || unknown(prior) || (prior.parent && !prior.complete))) {
			show();
			return;
		}
		const context = latest.current;
		if (!context.person || !context.workspaceSessionId) return;
		const next = update({
			id: crypto.randomUUID(),
			actorId: context.person.id,
			kind,
			phase: "loading",
			pending: false,
			message: "",
		});
		setPicker(null);
		show();
		try {
			const listed = await client.request({ op: "session.list" });
			if (!valid(next.id)) return;
			if (!listed.canCreate || !listed.defaults) {
				update({
					...next,
					phase: "failed",
					message: "Conversation creation is unavailable for this account.",
				});
				return;
			}
			const parents = listed.sessions.filter((row) => row.status === "ready"),
				parent =
					kind === "session"
						? null
						: (parents.find((row) => row.id === (parentId ?? context.selected?.sessionId)) ?? parents[0]),
				source =
					parent && context.configuration?.ref.sessionId === parent.id ? context.configuration.current : null;
			update({
				...next,
				phase: "editing",
				sessions: listed.sessions,
				defaults: { ...listed.defaults, serverId: listed.serverId },
				sessionId: parent?.id ?? "",
				sessionName: "New Session",
				name: "",
				model: source?.model ?? listed.defaults.model,
				cwd: source?.cwd ?? parent?.cwd ?? listed.defaults.cwd,
				withConversation: true,
			});
		} catch (failure) {
			if (!valid(next.id)) return;
			update({
				...next,
				phase: "failed",
				message: "Session information could not be read.",
			});
			if (failure.code === "UNAUTHORIZED") error(failure);
		}
	}
	useLayoutEffect(() => {
		if (visible && value?.phase === "editing")
			document
				.querySelector(
					value.kind === "session" && !value.parent
						? '[data-creation-form] [name="sessionName"]'
						: '[data-creation-form] [name="name"]',
				)
				?.focus();
	}, [visible, value?.id, value?.phase]);
	function field(key, input) {
		const row = current.current;
		if (!row || row.pending || unknown(row)) return;
		update({ ...row, [key]: input, message: "" });
	}
	function draftConfiguration(change) {
		const row = current.current;
		if (row && !row.pending && !unknown(row)) update({ ...row, ...change });
		setPicker(null);
	}
	async function completeConversation(ref, row) {
		if (!valid(row.id)) return;
		update({
			...current.current,
			pending: false,
			phase: "conversation-created",
			complete: true,
			ref,
			message: "Conversation created.",
		});
		try {
			await created(ref, opened.current);
			if (valid(row.id)) close();
		} catch (failure) {
			if (!valid(row.id)) return;
			update({
				...current.current,
				message: "Conversation created. Navigation could not be refreshed.",
			});
			if (failure.code === "UNAUTHORIZED") error(failure);
		}
	}
	async function makeConversation(row) {
		const command = {
			op: "create",
			requestId: crypto.randomUUID(),
			sessionId: row.parent?.id ?? row.sessionId,
			name: row.name.trim(),
			profile: row.defaults.profile,
			configuration: { model: row.model, cwd: row.cwd },
		};
		update({
			...row,
			conversationRequest: command,
			phase: "creating-conversation",
			pending: true,
			message: "",
		});
		try {
			const result = await client.request(command);
			if (valid(row.id)) await completeConversation(result.ref, row);
		} catch (failure) {
			if (!valid(row.id)) return;
			const uncertain = failure.outcome !== "denied";
			update({
				...current.current,
				pending: false,
				phase: uncertain ? "conversation-unknown" : "editing",
				conversationRequest: uncertain ? command : null,
				message: uncertain
					? "Conversation result unconfirmed. Check the original request."
					: row.parent
						? "The Session is ready. Conversation creation was refused; review the fields and continue in this Session."
						: "Conversation creation was refused. Review the fields before trying again.",
			});
			if (failure.code === "UNAUTHORIZED") error(failure);
		}
	}
	async function confirm(event) {
		event.preventDefault();
		let row = current.current;
		if (!row || row.pending || row.phase !== "editing") return;
		if (!row.sessionId && !row.parent) {
			const command = {
				op: "session.create",
				requestId: crypto.randomUUID(),
				name: row.sessionName.trim(),
				cwd: row.cwd,
			};
			update({ ...row, sessionRequest: command, phase: "creating-session", pending: true, message: "" });
			try {
				const result = await client.request(command);
				if (!valid(row.id)) return;
				if (result.session?.status !== "ready") {
					update({
						...current.current,
						pending: false,
						phase: "session-unknown",
						message: "Session initialization is unconfirmed. Check the original request before continuing.",
					});
					return;
				}
				row = update({
					...current.current,
					pending: false,
					phase: "editing",
					parent: result.session,
					sessionId: result.session.id,
				});
				sessionCreated(result.session);
			} catch (failure) {
				if (!valid(row.id)) return;
				const uncertain = failure.outcome !== "denied";
				update({
					...current.current,
					pending: false,
					phase: uncertain ? "session-unknown" : "editing",
					sessionRequest: uncertain ? command : null,
					message: uncertain
						? "Session result unconfirmed. Check the original request."
						: "Session creation was refused. No Conversation was submitted.",
				});
				if (failure.code === "UNAUTHORIZED") error(failure);
				return;
			}
		}
		if (row.withConversation) await makeConversation(row);
		else
			update({
				...row,
				complete: true,
				phase: "session-created",
				message: "Session created. It has no Conversations yet.",
			});
	}
	async function inspect() {
		const row = current.current;
		if (!row || row.pending || !unknown(row)) return;
		update({ ...row, pending: true });
		try {
			if (row.phase === "session-unknown") {
				const result = await client.request({ op: "session.lookup", original: row.sessionRequest });
				if (!valid(row.id)) return;
				if (result.session?.status === "ready") {
					sessionCreated(result.session);
					update({
						...row,
						parent: result.session,
						sessionId: result.session.id,
						pending: false,
						phase: "editing",
						message: "",
					});
				} else
					update({
						...row,
						pending: false,
						message: "Session result unconfirmed. Creation remains blocked.",
					});
			} else {
				const result = await client.request({ op: "conversation.lookup", original: row.conversationRequest });
				if (!valid(row.id)) return;
				if (result.result) await completeConversation(result.result, row);
				else
					update({
						...row,
						pending: false,
						message: "Conversation result unconfirmed. Creation remains blocked.",
					});
			}
		} catch (failure) {
			if (!valid(row.id)) return;
			update({
				...row,
				pending: false,
				message: "Original result unconfirmed. Creation remains blocked.",
			});
			if (failure.code === "UNAUTHORIZED") error(failure);
		}
	}
	const needsParent = value && !value.sessionId && !value.parent,
		blocked = value?.pending || unknown(value) || value?.phase !== "editing",
		label = value?.kind === "session" ? "New Session" : "New Conversation",
		configurationValue = value?.defaults && {
			...value.defaults,
			current: { model: value.model, cwd: value.cwd },
			canConfigure: true,
		};
	return {
		open,
		visible,
		dialog:
			visible &&
			value &&
			html`<${Sheet} label=${label} close=${close} initialFocus=${value.kind === "session" ? '[name="sessionName"]' : '[name="name"]'}>
			<header><h2>${label}</h2><button type="button" class="pocket-icon-button" aria-label="Close creation" onClick=${close}><${Icon} name="close" /></button></header>
			<div class="pocket-sheet-body creation-body">
				${value.phase === "loading" && html`<p role="status">Loading Session information…</p>`}
				${
					value.defaults &&
					!value.complete &&
					html`<form data-creation-form onSubmit=${confirm}>
						<fieldset class="creation-fields" disabled=${blocked}>
							${value.parent
								? html`<section class="creation-parent" aria-label="Created Session">
										<h3>Session Ready</h3>
										<strong>${value.parent.name}</strong><code>${value.parent.id}</code>
									</section>`
								: value.kind === "conversation" &&
									html`<label class="creation-field"
										>Session<select
											name="sessionId"
											value=${value.sessionId}
											onChange=${(event) => {
												const sessionId = event.currentTarget.value,
													parent = value.sessions.find((row) => row.id === sessionId);
												update({ ...value, sessionId, cwd: parent?.cwd ?? value.defaults.cwd, message: "" });
											}}
										>
											${value.sessions
												.filter((row) => row.status === "ready")
												.map((row) => html`<option key=${row.id} value=${row.id}>${row.name}</option>`)}
											<option value="">New Session…</option>
										</select></label
									>`}
							${needsParent &&
							html`<section class="creation-parent" aria-label="New Session Configuration">
								<label class="creation-field"
									>Session Name<input
										name="sessionName"
										autocomplete="off"
										maxlength="80"
										required
										value=${value.sessionName}
										onInput=${(event) => field("sessionName", event.currentTarget.value)}
								/></label>
							</section>`}
							${value.kind === "session" &&
							!value.parent &&
							html`<label class="creation-check"
								><input
									type="checkbox"
									name="withConversation"
									checked=${value.withConversation}
									onChange=${(event) => field("withConversation", event.currentTarget.checked)}
								/>Create the First Conversation</label
							>`}
							${value.withConversation &&
							html`<label class="creation-field"
									>Conversation Name<input
										name="name"
										autocomplete="off"
										maxlength="80"
										required
										value=${value.name}
										onInput=${(event) => field("name", event.currentTarget.value)}
								/></label>
								<div class="creation-field">
									<span>Model</span
									><button
										type="button"
										class="creation-config-button"
										data-action="creation-model"
										onClick=${() => setPicker("model")}
									>
										<span>${value.model}</span><${Icon} name="chevron" />
									</button>
								</div>`}
							<label class="creation-field"
								>Server Directory
								<div class="creation-location">
									<input name="cwd" value=${value.cwd} readonly title=${value.cwd} /><button
										type="button"
										class="pocket-icon-button"
										data-action="creation-directory"
										aria-label="Choose working directory"
										onClick=${() => setPicker("directory")}
									>
										<${Icon} name="folder" />
									</button></div
							></label>
						</fieldset>
						<footer class="creation-actions">
							<button type="button" class="pill-btn" onClick=${close}>
								${value.pending || value.parent || unknown(value) ? "Close" : "Cancel"}</button
							><button type="submit" class="button primary" data-create-confirm disabled=${blocked}>
								${needsParent
									? value.withConversation
										? "Create Session & Conversation"
										: "Create Session"
									: "Create Conversation"}
							</button>
						</footer>
					</form>`
				}
				${value.pending && html`<p role="status" data-creation-stage=${value.phase}>${value.phase === "creating-session" ? "Creating Session…" : value.phase === "creating-conversation" ? "Creating Conversation…" : "Checking the original result…"}</p>`}
				${value.message && html`<p role="status" data-creation-message>${value.message}</p>`}
				${unknown(value) && html`<div class="creation-reconciliation"><code>${value.conversationRequest?.requestId ?? value.sessionRequest?.requestId}</code><button type="button" class="pill-btn" data-action="check-creation" disabled=${value.pending} onClick=${inspect}>Check Original Creation</button></div>`}
				${value.phase === "session-created" && html`<section class="creation-parent"><strong>${value.parent.name}</strong><code>${value.parent.id}</code><button type="button" class="button primary" onClick=${() => update({ ...value, complete: false, withConversation: true, phase: "editing" })}>New Conversation in This Session</button></section>`}
			</div>
			${picker === "model" && html`<${ModelPicker} value=${configurationValue} client=${client} error=${error} anchor=${null} draftChange=${draftConfiguration} close=${() => setPicker(null)} />`}
			${picker === "directory" && html`<${DirectoryPicker} value=${configurationValue} person=${person} client=${client} error=${error} draftChange=${draftConfiguration} loadDirectories=${(input) => client.request({ op: "creation.directories", ...input })} close=${() => setPicker(null)} />`}
		</${Sheet}>`,
		recovery:
			!visible &&
			value &&
			!value.complete &&
			(value.pending || unknown(value) || value.parent) &&
			html`<div class="creation-recovery" role="status">
				<span
					>${value.pending
						? "Creation is still in progress. Closing its view did not cancel the operation."
						: value.message || "A Session was created; finish the remaining Conversation step."}</span
				><button class="pill-btn" data-action="review-creation" onClick=${show}>Review Creation</button>
			</div>`,
	};
}
