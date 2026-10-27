import { h } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { Sheet } from "./sheet.js";
import { Menu } from "./frontend.js";
import { resourceKey } from "./resource-identity.js";
const html = htm.bind(h);

/** Personal groups project authorized references; no grouping action changes native ownership. */
export function ConversationGroups({
	person,
	workspaceSessionId,
	refs,
	resourceIds,
	sessions,
	selected,
	title,
	choose,
	newConversation,
	canCreate,
	client,
	error,
	stopInput,
}) {
	const [view, setView] = useState(null),
		[busy, setBusy] = useState(false),
		[message, setMessage] = useState(""),
		[uncertain, setUncertain] = useState(false),
		[dialog, setDialog] = useState(null),
		[modeMenu, setModeMenu] = useState(null),
		[name, setName] = useState(""),
		[folder, setFolder] = useState("");
	const scope = JSON.stringify([person.id, workspaceSessionId]),
		latest = useRef(scope),
		live = useRef(true),
		operation = useRef(null),
		focusAfter = useRef(null),
		generation = useRef(0);
	latest.current = scope;
	const valid = (binding) => live.current && latest.current === binding;
	useEffect(
		() => () => {
			live.current = false;
			generation.current++;
		},
		[],
	);
	async function load(binding) {
		const token = ++generation.current,
			result = await client.request({ op: "navigation.read" });
		if (!valid(binding) || token !== generation.current) return false;
		setView(result.view);
		return true;
	}
	useEffect(() => {
		operation.current = null;
		setView(null);
		setBusy(false);
		setUncertain(false);
		setDialog(null);
		setModeMenu(null);
		setMessage("");
		if (!workspaceSessionId) return;
		void load(scope).catch((failure) => {
			if (!valid(scope)) return;
			setMessage("Personal navigation could not be read.");
			if (failure.code === "UNAUTHORIZED" || failure.code === "FORBIDDEN") error(failure);
		});
	}, [scope]);
	useLayoutEffect(() => {
		if (dialog || !focusAfter.current) return;
		const target = focusAfter.current;
		focusAfter.current = null;
		const node = target.resource
			? [...document.querySelectorAll("[data-move-resource]")].find(
					(node) => node.dataset.moveResource === target.resource,
				)
			: target.folder
				? [...document.querySelectorAll("[data-rename-folder]")].find(
						(node) => node.dataset.renameFolder === target.folder,
					)
				: document.querySelector('[aria-label="New Folder"]');
		(node ?? document.querySelector("[data-navigation-mode]"))?.focus({ preventScroll: true });
	}, [dialog, view]);
	function close() {
		setDialog(null);
	}
	function open(next) {
		if (!view || busy || uncertain || operation.current) return;
		stopInput?.();
		setName(next.folder?.name ?? "");
		setFolder(next.resource ? (view.assignments[next.resource] ?? "") : "");
		setDialog(next);
		setMessage("");
	}
	async function apply(action) {
		if (!view || busy || uncertain || operation.current) return;
		const binding = scope,
			command = {
				op: "navigation.update",
				input: { requestId: crypto.randomUUID(), expectedVersion: view.version, action },
			};
		operation.current = command;
		setBusy(true);
		setMessage("");
		let committed = false;
		try {
			await client.request(command);
			if (!valid(binding)) return;
			committed = true;
			if (!(await load(binding))) return;
			operation.current = null;
			focusAfter.current =
				action.kind === "assign"
					? { resource: action.resourceId }
					: action.kind === "folder.rename"
						? { folder: action.folderId }
						: {};
			setDialog(null);
		} catch (failure) {
			if (!valid(binding)) return;
			if (committed || failure.outcome !== "denied") {
				setUncertain(true);
				setDialog(null);
				setMessage(
					committed
						? "Navigation saved. Refresh failed."
						: "Navigation result unconfirmed. Check the original edit.",
				);
			} else {
				operation.current = null;
				setMessage(
					failure.code === "CONFLICT"
						? "Navigation changed elsewhere. Load the current navigation and review your edit."
						: "Navigation edit refused.",
				);
				if (failure.code === "UNAUTHORIZED" || failure.code === "FORBIDDEN") error(failure);
			}
		} finally {
			if (valid(binding)) setBusy(false);
		}
	}
	async function reload() {
		if (busy) return;
		const binding = scope;
		setBusy(true);
		try {
			if (!(await load(binding))) return;
			operation.current = null;
			setUncertain(false);
			setMessage("Current navigation loaded.");
		} catch (failure) {
			if (!valid(binding)) return;
			setMessage("Current navigation could not be verified.");
			if (failure.code === "UNAUTHORIZED" || failure.code === "FORBIDDEN") error(failure);
		} finally {
			if (valid(binding)) setBusy(false);
		}
	}
	async function inspect() {
		const original = operation.current;
		if (!original || busy) return;
		const binding = scope;
		setBusy(true);
		try {
			const result = await client.request({ op: "navigation.lookup", original: original.input });
			if (!valid(binding)) return;
			if (!result.receipt) {
				setMessage("Original edit unconfirmed in the recent operation window.");
				return;
			}
			if (!(await load(binding))) return;
			operation.current = null;
			setUncertain(false);
			setMessage("Original edit confirmed.");
		} catch (failure) {
			if (!valid(binding)) return;
			setMessage("Original navigation result unconfirmed.");
			if (failure.code === "UNAUTHORIZED" || failure.code === "FORBIDDEN") error(failure);
		} finally {
			if (valid(binding)) setBusy(false);
		}
	}
	function browseMode(event) {
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const items = [...event.currentTarget.querySelectorAll('[role="menuitemradio"]')],
			index = items.indexOf(document.activeElement),
			next =
				event.key === "Home"
					? 0
					: event.key === "End"
						? items.length - 1
						: (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
		items[next]?.focus();
	}
	const blocked = !view || busy || uncertain,
		parents = new Map(sessions.map((row) => [row.id, row])),
		parentName = (ref) => parents.get(ref.sessionId)?.name ?? "Session · " + ref.sessionId.slice(0, 8);
	const rows = (items) =>
		items.map((ref) => {
			const resource = resourceIds[resourceKey(ref)],
				current = selected?.sessionId === ref.sessionId && selected?.conversationId === ref.conversationId;
			return html`<div class="sidebar-conversation-row" key=${resourceKey(ref)}>
				<button
					class="session-row"
					data-session=${ref.sessionId}
					data-conversation=${ref.conversationId}
					aria-current=${current ? "true" : "false"}
					title=${title(ref) + " · " + parentName(ref) + " (" + ref.sessionId + ")"}
					onClick=${() => choose(ref)}
				>
					<span class="session-dot"></span
					><span class="sidebar-conversation-label"
						><span class="session-title">${title(ref)}</span>${view.mode === "default" &&
						html`<small class="sidebar-parent">${parentName(ref)}</small>`}</span
					></button
				><button
					type="button"
					class="icon-btn"
					data-move-resource=${resource}
					aria-label=${"Move " + title(ref) + " to Folder"}
					disabled=${blocked || !resource}
					onClick=${() => open({ type: "move", resource, title: title(ref) })}
				>
					<${Icon} name="folder" />
				</button>
			</div>`;
		});
	const sessionGroups = [...new Set([...sessions.map((row) => row.id), ...refs.map((row) => row.sessionId)])];
	return html`<div class="personal-navigation">
		<div class="navigation-tools">
			<button
				type="button"
				class="navigation-mode-trigger"
				aria-label="Conversation Grouping"
				aria-haspopup="menu"
				aria-expanded=${Boolean(modeMenu) && !blocked}
				data-navigation-mode
				value=${view?.mode ?? "default"}
				disabled=${blocked}
				onClick=${(event) => {
					stopInput?.();
					setModeMenu(modeMenu ? null : event.currentTarget);
				}}
				onKeyDown=${(event) => {
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						setModeMenu(event.currentTarget);
					}
				}}
			>
				<span>${view?.mode === "session" ? "Sort Per Session" : "Default"}</span><${Icon} name="chevron" />
			</button>
			${modeMenu &&
			!blocked &&
			html`<${Menu}
				name="grouping" trigger=${modeMenu} close=${() => setModeMenu(null)}
				initialFocus=${'[aria-checked="true"]'} closeOnTab=${true}
			>
				<div onKeyDown=${browseMode}>
					${[
						["default", "Default"],
						["session", "Sort Per Session"],
					].map(
						([mode, label]) =>
							html`<button
								type="button"
								class="menu-row"
								role="menuitemradio"
								aria-checked=${view.mode === mode}
								data-navigation-choice=${mode}
								onClick=${() => {
									setModeMenu(null);
									if (mode !== view.mode) void apply({ kind: "mode", mode });
								}}
							>
								<span class="grouping-marker" aria-hidden="true"
									>${view.mode === mode && html`<${Icon} name="check" />`}</span
								><span>${label}</span>
							</button>`,
					)}
				</div>
			</${Menu}>`}
			${view?.mode === "default" &&
			html`<button
				type="button"
				class="icon-btn"
				aria-label="New Folder"
				disabled=${blocked}
				onClick=${() => open({ type: "create" })}
			>
				<${Icon} name="plus" />
			</button>`}
		</div>
		${!view && !message && html`<p class="navigation-status" role="status">Loading personal navigation…</p>`}
		<nav aria-label="Conversations" class="session-list">
			${view &&
			(view.mode === "session"
				? sessionGroups.map((id) => {
						const parent = parents.get(id),
							items = refs.filter((ref) => ref.sessionId === id);
						return html`<section class="sidebar-conversation-group" key=${id} data-session-group=${id}>
							<header>
								<h3 title=${id}>${parent?.name ?? "Session · " + id.slice(0, 8)}</h3>
								${canCreate &&
								parent?.status === "ready" &&
								html`<button
									type="button"
									class="icon-btn"
									aria-label=${"New Conversation in " + parent.name}
									onClick=${() => newConversation(id)}
								>
									<${Icon} name="plus" />
								</button>`}
							</header>
							${parent &&
							parent.status !== "ready" &&
							html`<p class="navigation-status" role="status">
								${parent.status === "unknown" ? "Session needs verification" : "Session unavailable"}
							</p>`}${rows(items)}${!items.length && html`<p class="empty-sessions">No conversations</p>`}
						</section>`;
					})
				: html`${view.folders.map(
							(item) =>
								html`<section class="sidebar-conversation-group" data-folder-group=${item.id} key=${item.id}>
									<header>
										<h3 title=${item.name}><${Icon} name="folder" /><span>${item.name}</span></h3>
										<button
											type="button"
											class="icon-btn"
											data-rename-folder=${item.id}
											aria-label=${"Rename " + item.name}
											disabled=${blocked}
											onClick=${() => open({ type: "rename", folder: item })}
										>
											<${Icon} name="right" /></button
										><button
											type="button"
											class="icon-btn"
											data-delete-folder=${item.id}
											aria-label=${"Delete " + item.name}
											disabled=${blocked}
											onClick=${() => open({ type: "delete", folder: item })}
										>
											<${Icon} name="minus" />
										</button>
									</header>
									${rows(refs.filter((ref) => view.assignments[resourceIds[resourceKey(ref)]] === item.id))}
								</section>`,
						)}
						<section class="sidebar-conversation-group" data-uncategorized>
							<header><h3>Uncategorized</h3></header>
							${rows(refs.filter((ref) => !view.assignments[resourceIds[resourceKey(ref)]]))}${!refs.length &&
							html`<p class="empty-sessions">No conversations</p>`}
						</section>`)}
		</nav>
		${busy &&
		html`<p class="navigation-status" role="status">
			${uncertain ? "Checking navigation…" : "Saving navigation…"}
		</p>`}
		${message && html`<p class="navigation-status" role="status" data-navigation-message>${message}</p>`}
		${uncertain &&
		html`<div class="navigation-reconciliation">
			<code>${operation.current?.input.requestId}</code
			><button type="button" class="pill-btn" data-check-navigation disabled=${busy} onClick=${inspect}>
				Check Original Edit</button
			><button type="button" class="pill-btn" disabled=${busy} onClick=${reload}>
				Load Current Navigation
			</button>
		</div>`}
		${!uncertain &&
		message &&
		html`<button type="button" class="pill-btn" disabled=${busy} onClick=${reload}>
			Reload Navigation
		</button>`}
		${dialog &&
		html`<${Sheet} label=${dialog.type === "move" ? "Move Conversation" : dialog.type === "delete" ? "Delete Folder" : dialog.type === "rename" ? "Rename Folder" : "New Folder"} initialFocus=${dialog.type === "move" ? '[name="folderId"]' : dialog.type === "delete" ? undefined : '[name="folderName"]'} close=${close}>
			<header><h2>${dialog.type === "move" ? "Move Conversation" : dialog.type === "delete" ? "Delete Folder" : dialog.type === "rename" ? "Rename Folder" : "New Folder"}</h2><button type="button" class="pocket-icon-button" aria-label="Close folder dialog" onClick=${close}><${Icon} name="close" /></button></header>
			<form class="pocket-sheet-body creation-body" onSubmit=${(event) => {
				event.preventDefault();
				void apply(
					dialog.type === "move"
						? { kind: "assign", resourceId: dialog.resource, folderId: folder || null }
						: dialog.type === "delete"
							? { kind: "folder.delete", folderId: dialog.folder.id }
							: dialog.type === "rename"
								? { kind: "folder.rename", folderId: dialog.folder.id, name }
								: { kind: "folder.create", name },
				);
			}}>
				${
					dialog.type === "move"
						? html`<p>${dialog.title}</p>
								<label class="creation-field"
									>Folder<select
										name="folderId"
										value=${folder}
										disabled=${busy}
										onChange=${(event) => setFolder(event.currentTarget.value)}
									>
										<option value="">Uncategorized</option>
										${view.folders.map(
											(item) => html`<option key=${item.id} value=${item.id}>${item.name}</option>`,
										)}
									</select></label
								>`
						: dialog.type === "delete"
							? html`<p>
									Delete “${dialog.folder.name}”? Its Conversations return to Uncategorized. No native
									Conversation or Session will be deleted.
								</p>`
							: html`<label class="creation-field"
									>Folder Name<input
										name="folderName"
										autocomplete="off"
										required
										maxlength="80"
										value=${name}
										disabled=${busy}
										onInput=${(event) => setName(event.currentTarget.value)}
								/></label>`
				}
				<footer class="creation-actions"><button type="button" class="pill-btn" onClick=${close}>${busy ? "Close" : "Cancel"}</button><button type="submit" class="button primary" data-folder-confirm=${dialog.type === "delete" ? undefined : ""} data-folder-delete-confirm=${dialog.type === "delete" ? "" : undefined} disabled=${busy}>${dialog.type === "delete" ? "Delete Folder" : dialog.type === "move" ? "Move" : dialog.type === "rename" ? "Save" : "Create Folder"}</button></footer>
			</form>
		</${Sheet}>`}
	</div>`;
}
