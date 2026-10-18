// Pakka-Pocket workbench. Adapted from pi-pocket's app/composer/transcript patterns; authority is the public Pocket client.
import { render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { h } from "preact";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { createPocketClient } from "@pakka/client/pocket";
import { decodePocketEvent } from "@pakka/protocol/pocket";
import { useExtensions } from "./extensions.js";
import { Collaboration } from "./collaboration.js";
import { Configuration } from "./configuration.js";
import {
	useConversationConfiguration,
	ModelPicker,
	DirectoryPicker,
	clearDirectoryPreferences,
} from "./conversation-configuration.js";
import { Notifications, clearNotifications } from "./notifications.js";
import { useDictation, MicButton } from "./voice.js";
import { Sheet } from "./sheet.js";
import { Icon } from "@pakka/webui/components";
import { ConversationSettings } from "./navigation.js";
import { Appearance, readAppearance, applyAppearance } from "./appearance.js";

const html = htm.bind(h);
const csrf = () => /(?:^|; )pakka_csrf=([A-Za-z0-9_-]{43})(?:;|$)/.exec(document.cookie)?.[1] ?? null;
const client = createPocketClient({ endpoint: new URL("/pocket/rpc", location.href).href, csrf });
const incoming = new URLSearchParams(location.hash.slice(1));
let signInToken = incoming.get("signin") ?? incoming.get("invite") ?? "";
const signInKind = incoming.has("invite") ? "invite" : "session";
let requestedConversation = incoming.get("conversation");
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
const markdown = (text) =>
	DOMPurify.sanitize(marked.parse(String(text), { async: false }), {
		FORBID_TAGS: ["form", "input", "button", "iframe", "style", "link"],
		FORBID_ATTR: ["style"],
		ALLOW_DATA_ATTR: false,
	});
const label = (ref) => ref.profile + " · " + ref.conversationId.slice(0, 8);

applyAppearance(readAppearance());
function Message({ message, onDraft }) {
	const content =
		typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
	return html`<article
		class=${message.role === "user" ? "user-row" : "pocket-message"}
		data-role=${message.role}
	>
		<div class="pocket-message-role">
			${message.role === "user"
				? "You"
				: message.role === "assistant"
					? "Agent"
					: (message.toolName ?? "Tool")}
		</div>
		${content.map((part, i) =>
			part.type === "text"
				? html`<div key=${i} class="markdown" dangerouslySetInnerHTML=${{ __html: markdown(part.text) }} />`
				: part.type === "thinking"
					? html`<details key=${i}>
							<summary>Reasoning</summary>
							<pre>${part.thinking}</pre>
						</details>`
					: part.type === "toolCall"
						? html`<details key=${i} class="tool-card">
								<summary>${part.name}</summary>
								<pre>${JSON.stringify(part.arguments, null, 2)}</pre>
							</details>`
						: part.type === "image" && /^image\/(png|jpeg|webp|gif)$/.test(part.mimeType)
							? html`<img
									key=${i}
									class="pocket-image"
									alt="Conversation attachment"
									src=${"data:" + part.mimeType + ";base64," + part.data}
								/>`
							: null,
		)}
		${message.role === "user" &&
		onDraft &&
		html`<button
			data-action="use-draft"
			onClick=${() =>
				onDraft(
					content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n"),
				)}
		>
			Use as draft
		</button>`}
	</article>`;
}
function App() {
	const [person, setPerson] = useState(null),
		[refs, setRefs] = useState([]),
		[titles, setTitles] = useState({}),
		[states, setStates] = useState({}),
		[pendingNavigation, setPendingNavigation] = useState({}),
		[query, setQuery] = useState(""),
		[showArchived, setShowArchived] = useState(false),
		[find, setFind] = useState(""),
		[historyEntries, setHistoryEntries] = useState([]),
		[historyCursor, setHistoryCursor] = useState(undefined),
		[selected, select] = useState(null),
		[view, setView] = useState(null),
		[shared, setShared] = useState(null);
	const title = (ref) => titles[ref.conversationId] ?? label(ref);
	const [name, setName] = useState(""),
		[token, setToken] = useState(signInToken),
		[draft, setDraft] = useState(""),
		[mode, setMode] = useState("prompt");
	const [notice, notify] = useState(""),
		[working, setWorking] = useState(false),
		[sheet, openSheet] = useState(null),
		[people, setPeople] = useState(null),
		[link, setLink] = useState(""),
		[qr, setQr] = useState(""),
		[inviteRole, setInviteRole] = useState("viewer");
	const [receipt, setReceipt] = useState(null),
		[retry, setRetry] = useState(null),
		[drawer, setDrawer] = useState(false),
		[newName, setNewName] = useState("");
	const drawerToggle = useRef(null);
	const dismissDrawer = () => {
		setDrawer(false);
		drawerToggle.current?.focus();
	};
	const mounted = useRef(true),
		scroll = useRef(null),
		follow = useRef(true),
		composer = useRef(null),
		resourceContext = useRef(null);
	const contextKey = JSON.stringify([person?.id, selected?.key, selected?.incarnation]);
	if (resourceContext.current?.key !== contextKey) resourceContext.current = { key: contextKey };
	const extensions = useExtensions({
		person,
		target: selected,
		csrf,
		notice: notify,
		opened: () => setDrawer(false),
		error: (failure) => error(failure),
		navigate: (ref) => {
			if (refs.some((row) => row.key === ref.key && row.incarnation === ref.incarnation)) {
				extensions.leave();
				select(ref);
				setDrawer(false);
			} else notify("This conversation is unavailable.");
		},
	});
	const invalidate = () => {
		clearDirectoryPreferences(person);
		void clearNotifications().catch(() => {});
		resourceContext.current = null;
		extensions.clear();
		setView(null);
		setShared(null);
		setRefs([]);
		setTitles({});
		setStates({});
		setPendingNavigation({});
		setHistoryEntries([]);
		setHistoryCursor(undefined);
		setFind("");
		select(null);
		setPeople(null);
		openSheet(null);
		setReceipt(null);
		setRetry(null);
		setDraft("");
	};
	const error = (failure) => {
		if (failure.code === "UNAUTHORIZED" || failure.code === "FORBIDDEN") {
			invalidate();
			if (failure.code === "UNAUTHORIZED") setPerson(null);
		}
		notify(
			failure.outcome === "unknown"
				? "The result is unconfirmed. Check the receipt before retrying."
				: failure.code === "CONVERSATION_UNAVAILABLE"
					? "Model input is unavailable in this conversation. Start a new conversation. Existing requests and spent attempts are kept."
					: failure.code === "CONFLICT"
						? "This shared record changed. Reload it before saving again."
						: "This operation was refused.",
		);
	};
	const configuration = useConversationConfiguration(selected, person, client, error);
	async function refresh() {
		const hello = await client.request({ op: "hello" });
		const list = await client.request({ op: "list" });
		if (!mounted.current) return;
		setPerson(hello.person);
		setRefs(list.conversations);
		setTitles(list.titles ?? {});
		setStates(list.states ?? {});
		if (requestedConversation) {
			const ref = list.conversations.find((row) => row.conversationId === requestedConversation);
			requestedConversation = null;
			if (ref) {
				extensions.leave();
				select(ref);
				setDrawer(false);
			}
		}
	}
	useEffect(() => {
		const navigate = () => {
			const conversation = new URLSearchParams(location.hash.slice(1)).get("conversation");
			if (!conversation) return;
			requestedConversation = conversation;
			history.replaceState(null, "", location.pathname + location.search);
			void refresh().catch(error);
		};
		window.addEventListener("hashchange", navigate);
		void refresh().catch((failure) => {
			if (failure.code === "UNAUTHORIZED") setPerson(null);
			else error(failure);
		});
		return () => {
			window.removeEventListener("hashchange", navigate);
			mounted.current = false;
		};
	}, []);
	useLayoutEffect(() => {
		setView(null);
		setShared(null);
		openSheet(null);
		setReceipt(null);
		setRetry(null);
		setHistoryEntries([]);
		setHistoryCursor(undefined);
		setFind("");
		follow.current = true;
	}, [selected?.conversationId, selected?.incarnation, person?.id]);
	useEffect(() => {
		if (!selected || !person) return;
		const binding = resourceContext.current;
		let active = true,
			sequence = 0,
			generation;
		const events = new EventSource(
			"/pocket/events?conversationId=" + encodeURIComponent(selected.conversationId),
		);
		events.addEventListener("pocket", (event) => {
			try {
				const value = decodePocketEvent(JSON.parse(event.data));
				if (!active || resourceContext.current !== binding) return;
				if (value.kind === "invalidated" || value.kind === "resnapshot") {
					setView(null);
					setShared(null);
					sequence = 0;
					generation = value.streamId;
					return;
				}
				if (generation === value.streamId && value.sequence <= sequence) throw new Error("Stale stream");
				generation = value.streamId;
				sequence = value.sequence;
				if (value.kind === "collaboration") {
					if (value.snapshot.conversationId !== selected.conversationId)
						throw new Error("Foreign collaboration");
					setShared(value.snapshot);
				} else {
					if (
						value.snapshot.ref.key !== selected.key ||
						value.snapshot.ref.incarnation !== selected.incarnation ||
						value.snapshot.ref.sessionId !== selected.sessionId
					)
						throw new Error("Stale resource");
					setView(value.snapshot);
				}
			} catch {
				events.close();
				setView(null);
				setShared(null);
				notify("Connection changed. Select the conversation again to reconnect.");
			}
		});
		events.onerror = () => {
			if (active && resourceContext.current === binding) {
				setView(null);
				setShared(null);
				void refresh().catch(error);
			}
		};
		return () => {
			active = false;
			events.close();
		};
	}, [selected?.conversationId, selected?.incarnation, person?.id]);
	useEffect(() => {
		if (scroll.current && follow.current) scroll.current.scrollTop = scroll.current.scrollHeight;
	}, [view]);
	async function run(action) {
		setWorking(true);
		notify("");
		try {
			await action();
		} catch (failure) {
			error(failure);
		} finally {
			setWorking(false);
		}
	}
	async function signIn(event) {
		event.preventDefault();
		await run(async () => {
			const response = await fetch("/pocket/exchange", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				redirect: "error",
				body: JSON.stringify({ kind: signInKind, token, ...(signInKind === "invite" ? { name } : {}) }),
			});
			if (!response.ok) throw Object.assign(new Error("Sign-in refused"), { outcome: "denied" });
			signInToken = "";
			setToken("");
			await refresh();
		});
	}
	async function submit(command) {
		setRetry(command);
		let result;
		try {
			result = await client.request(command);
		} catch (failure) {
			if (failure.outcome === "denied") setRetry(null);
			throw failure;
		}
		setRetry(null);
		if (result.kind === "receipt") {
			setReceipt(result.receipt);
			void client
				.request({ op: "wait", id: result.receipt.id })
				.then((done) => {
					if (mounted.current)
						setReceipt((current) => (current?.id === result.receipt.id ? done.receipt : current));
				})
				.catch((failure) => {
					if (mounted.current) error(failure);
				});
		}
	}
	async function send(event) {
		event.preventDefault();
		dictation.stop();
		if (!selected || !draft.trim()) return;
		if (draft.trimStart().startsWith("/")) {
			await run(async () => {
				if (await extensions.slash(draft)) setDraft("");
			});
			return;
		}
		const text = draft;
		await run(async () => {
			if (mode === "chat") {
				const result = await client.request({
					op: "collaboration.post",
					target: selected,
					input: { requestId: crypto.randomUUID(), text },
				});
				setShared(result.snapshot);
				openSheet("collaboration");
			} else
				await submit({
					op: "submit",
					target: selected,
					input: { requestId: crypto.randomUUID(), text, mode },
				});
			setDraft("");
		});
	}
	async function configurationApplied(next) {
		const binding = resourceContext.current;
		await refresh();
		if (!mounted.current || resourceContext.current !== binding) return;
		extensions.leave();
		select(next);
		openSheet(null);
	}
	async function showPeople() {
		await run(async () => {
			const result = await client.request({ op: "people" });
			setPeople(result);
			setLink("");
			setQr("");
			openSheet("people");
		});
	}
	async function navigationChanged(ref, archived) {
		const binding = resourceContext.current;
		await refresh();
		if (!mounted.current || resourceContext.current !== binding) return;
		extensions.leave();
		openSheet(null);
		select(archived ? null : ref);
		if (archived) notify("Archive hides navigation only; it does not cancel admitted work.");
	}
	async function earlier() {
		const binding = resourceContext.current,
			cursor = historyCursor === undefined ? view?.olderBeforeId : historyCursor;
		if (!cursor) return;
		await run(async () => {
			const result = await client.request({
				op: "read",
				target: selected,
				page: { limit: 64, beforeEntryId: cursor },
			});
			if (!mounted.current || resourceContext.current !== binding) return;
			follow.current = false;
			setHistoryEntries((previous) => [...result.snapshot.entries, ...previous]);
			setHistoryCursor(result.snapshot.entriesTruncated ? result.snapshot.olderBeforeId : null);
		});
	}
	function useDraft(text) {
		if (text.length > 8192) {
			notify("This input exceeds the current draft limit; it was not truncated or sent.");
			return;
		}
		setDraft(text);
		notify("Copied to draft. Review and Send explicitly to create a new native input.");
		composer.current?.focus();
	}
	const allEntries = [
		...new Map([...historyEntries, ...(view?.entries ?? [])].map((entry) => [entry.id, entry])).values(),
	];
	const visibleEntries = allEntries.filter(
		(entry) =>
			!find ||
			JSON.stringify([entry.messages, entry.display?.text])
				.toLocaleLowerCase()
				.includes(find.toLocaleLowerCase()),
	);
	const olderCursor =
		historyCursor === undefined ? (view?.entriesTruncated ? view.olderBeforeId : null) : historyCursor;
	const canSend = person && person.role !== "viewer",
		canDrive = person && ["driver", "admin"].includes(person.role),
		canInput =
			canSend &&
			(!shared?.driver.personId ||
				(shared.driver.personId === person?.id && shared.driver.expiresAt > Date.now()));
	const dictation = useDictation(composer, setDraft, {
		scope: contextKey + ":" + mode,
		enabled: Boolean(
			selected &&
				view &&
				!working &&
				!sheet &&
				!drawer &&
				!extensions.page &&
				!extensions.overlay &&
				(mode === "chat" || canInput),
		),
		notice: notify,
	});
	const showCollaboration = () => {
		const binding = resourceContext.current;
		void run(async () => {
			try {
				const result = await client.request({ op: "collaboration.read", target: selected });
				if (!mounted.current || resourceContext.current !== binding) return;
				setShared(result.snapshot);
				openSheet("collaboration");
			} catch (failure) {
				if (resourceContext.current === binding) throw failure;
			}
		});
	};
	if (!person)
		return html`<main class="pocket-signin">
			<section class="signin">
				<div class="pocket-brand">P</div>
				<h1>Pakka-Pocket</h1>
				<p>A shared workbench for your agents.</p>
				<form onSubmit=${signIn}>
					<label
						>Sign-in or invitation token<input
							name="token"
							type="password"
							autocomplete="off"
							value=${token}
							onInput=${(event) => setToken(event.currentTarget.value)}
							required /></label
					>${signInKind === "invite" &&
					html`<label
						>Your name<input
							name="person"
							maxlength="80"
							value=${name}
							onInput=${(event) => setName(event.currentTarget.value)}
							required
					/></label>`}<button class="button primary" data-action="signin" type="submit" disabled=${working}>
						${signInKind === "invite" ? "Join workbench" : "Sign in"}
					</button>
				</form>
				${notice && html`<p role="alert">${notice}</p>`}
			</section>
		</main>`;
	return html`<div
		class=${"layout pocket-workbench" + (drawer ? " drawer-open" : "")}
		onKeyDown=${(event) => {
			if (drawer && event.key === "Escape" && !event.defaultPrevented) {
				event.preventDefault();
				dismissDrawer();
			}
		}}
	>
		${drawer &&
		html`<button
			type="button"
			class="pocket-drawer-backdrop"
			aria-label="Close conversations"
			onClick=${dismissDrawer}
		/>`}
		<aside class="sidebar window" id="pocket-sidebar">
			<div class="pocket-side-head">
				<strong>Pakka-Pocket</strong><span class="pocket-person">${person.name} · ${person.role}</span>
			</div>
			<div class="pocket-navigation-tools">
				<input
					aria-label="Find conversations"
					type="search"
					value=${query}
					onInput=${(event) => setQuery(event.currentTarget.value)}
					placeholder="Find conversations"
				/>
				<label
					><input
						type="checkbox"
						data-action="show-archived"
						checked=${showArchived}
						onChange=${(event) => setShowArchived(event.currentTarget.checked)}
					/>
					Show archived</label
				>
				<button class="button" onClick=${() => void run(refresh)}>Refresh conversations</button>
			</div>
			<nav class="pocket-nav" aria-label="Conversations">
				${refs
					.filter(
						(ref) =>
							(showArchived || !states[ref.conversationId]?.archived) &&
							title(ref).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
					)
					.map(
						(ref) =>
							html`<button
								key=${ref.key}
								data-conversation=${ref.conversationId}
								class=${selected?.key === ref.key ? "selected" : ""}
								onClick=${() => {
									extensions.leave();
									select(ref);
									setDrawer(false);
								}}
							>
								<${Icon} name="conversation" />
								<span>${title(ref)}${states[ref.conversationId]?.archived ? " · Archived" : ""}</span>
							</button>`,
					)}
			</nav>
			${(extensions.workspaceNavigation.length > 0 || extensions.navigation.length > 0) &&
			html`<div class="pocket-tool-navigation" role="region" aria-label="Tools and extensions" tabindex="0">
				${extensions.workspaceNavigation.length > 0 &&
				html`<nav class="pocket-nav" aria-label="WebUI">
					<h2>WebUI</h2>
					${extensions.workspaceNavigation}
				</nav>`}
				${extensions.navigation.length > 0 &&
				html`<nav class="pocket-nav" aria-label="Extensions">
					<h2>Extensions</h2>
					${extensions.navigation}
				</nav>`}
			</div>`}
			${canDrive &&
			html`<form
				class="pocket-new"
				onSubmit=${(event) => {
					event.preventDefault();
					void run(async () => {
						const created = await client.request({
							op: "create",
							requestId: crypto.randomUUID(),
							name: newName,
							profile: selected?.profile ?? "default",
							...(selected ? { inherit: selected } : {}),
						});
						setNewName("");
						extensions.leave();
						await refresh();
						select(created.ref);
						setDrawer(false);
					});
				}}
			>
				<input
					aria-label="New conversation name"
					value=${newName}
					placeholder="New conversation"
					onInput=${(event) => setNewName(event.currentTarget.value)}
					required
				/><button
					class="button pocket-icon-button"
					type="submit"
					aria-label="Create conversation"
					title="Create conversation"
					disabled=${working}
				>
					<${Icon} name="plus" />
				</button>
			</form>`}
			<div class="pocket-side-foot">
				<button
					data-action="appearance"
					onClick=${() => {
						setDrawer(false);
						openSheet("appearance");
					}}
				>
					Appearance</button
				><button
					data-action="logout"
					onClick=${() =>
						void run(async () => {
							await client.request({ op: "session.logout" });
							clearDirectoryPreferences(person);
							invalidate();
							setPerson(null);
						})}
				>
					Sign out
				</button>
			</div>
		</aside>
		<main class="pane window">
			<header class="topbar pocket-topbar">
				<button
					class="pocket-menu pocket-icon-button"
					aria-label="Toggle conversations"
					aria-controls="pocket-sidebar"
					aria-expanded=${drawer}
					ref=${drawerToggle}
					onClick=${() => setDrawer(!drawer)}
				>
					<${Icon} name="menu" />
				</button>
				<div class="pocket-heading">
					<div class="pocket-title">${selected ? title(selected) : "Your workspace"}</div>
					${selected &&
					html`<button
						type="button"
						class="pocket-directory-trigger"
						data-action="cwd"
						aria-label=${"Working directory: " + (configuration?.current?.cwd ?? "Loading")}
						title=${configuration?.current?.cwd ?? ""}
						disabled=${!configuration?.canConfigure}
						onClick=${() => openSheet("directory")}
					>
						<${Icon} name="folder" /><span>${configuration?.current?.cwd ?? "Loading directory…"}</span>
					</button>`}
				</div>
				<span class="pocket-status">${view?.live.busy ? "Working" : view ? "Ready" : ""}</span>${selected &&
				html`<button data-action="conversation" onClick=${() => openSheet("conversation")}>
						Conversation
					</button>
					<button data-action="settings" onClick=${() => openSheet("configuration")}>Settings</button>
					<button data-action="notifications" onClick=${() => openSheet("notifications")}>
						Notifications
					</button>
					<button data-action="collaboration" onClick=${showCollaboration}>
						Team
					</button>`}${extensions.button}${person.role === "admin" &&
				html`<button data-action="people" onClick=${showPeople}>People & invites</button>`}
			</header>
			${extensions.page && extensions.surface}
			<div
				class="scroller"
				ref=${scroll}
				hidden=${extensions.page}
				onScroll=${(event) => {
					const node = event.currentTarget;
					follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
				}}
			>
				${selected
					? html`<div class="transcript">
							<label class="pocket-history-find"
								>Find loaded history<input
									type="search"
									aria-label="Find loaded history"
									value=${find}
									onInput=${(event) => setFind(event.currentTarget.value)}
							/></label>
							${olderCursor &&
							html`<button
								class="button"
								data-action="show-earlier"
								disabled=${working}
								onClick=${() => void earlier()}
							>
								Show earlier history
							</button>`}
							${find &&
							html`<p role="status">
								${visibleEntries.length} matching loaded entries. Earlier unread history is not searched.
							</p>`}
							${!view
								? html`<p role="status">Connecting…</p>`
								: visibleEntries.map(
										(entry) =>
											html`<section key=${entry.id} data-entry=${entry.id}>
												${entry.display
													? html`<aside class="pocket-display">
															<span>${entry.display.kind === "chat" ? "Team chat" : "Card"}</span>
															<p>${entry.display.text}</p>
														</aside>`
													: entry.messages.map(
															(message, index) =>
																html`<${Message}
																	key=${index}
																	message=${message}
																	onDraft=${canSend ? useDraft : undefined}
																/>`,
														)}
											</section>`,
									)}${view?.live.message &&
							html`<${Message} message=${view.live.message} />`}${view?.live.tools.map(
								(tool) =>
									html`<div class="tool-card">
										${tool.name} · ${tool.status}${tool.output && html`<pre>${tool.output}</pre>`}
									</div>`,
							)}
						</div>`
					: html`<div class="pocket-welcome">
							<div class="pocket-brand">P</div>
							<h1>Your agents, together.</h1>
							<p>Select a conversation or start a new one.</p>
						</div>`}
				${!extensions.page && extensions.surface}
			</div>
			${selected &&
			!extensions.page &&
			html`<div class="composer-wrap pocket-composer">
				<div class="pocket-model-bar">
					<button
						type="button"
						class="pocket-model-trigger"
						data-action="model"
						aria-haspopup="dialog"
						disabled=${!configuration?.canConfigure}
						onClick=${() => openSheet("model")}
					>
						<span>${configuration?.current?.model ?? "Loading model…"}</span><${Icon} name="chevron" />
					</button>
				</div>
				<form class="composer" onSubmit=${send}>
					<textarea
						ref=${composer}
						name="message"
						maxlength="8192"
						aria-label="Message"
						rows="3"
						value=${draft}
						placeholder=${canSend ? "Message your agent…" : "Read-only commands…"}
						onInput=${(event) => setDraft(event.currentTarget.value)}
					/>
					${dictation.available &&
					html`<p id="pocket-dictation-help" class="pocket-dictation-help" data-dictation-help>
						Browser speech recognition is provided by this browser. Review the draft before sending.
					</p>`}
					${draft.trimStart().startsWith("/") && extensions.suggestions(draft, () => setDraft(""))}
					<div class="composer-row">
						<select
							aria-label="Input mode"
							value=${mode}
							onChange=${(event) => setMode(event.currentTarget.value)}
						>
							<option value="prompt" disabled=${!canSend}>Prompt</option>
							${canDrive &&
							html`<option value="steer">Steer</option>
								<option value="followUp">Follow up</option>`}
							<option value="chat">Team chat</option></select
						>${canDrive &&
						view?.live.busy &&
						html`<button
							type="button"
							onClick=${() => void run(() => client.request({ op: "abort", target: selected }))}
						>
							Stop
						</button>`}<button
							class="button primary"
							data-action="send"
							type="submit"
							disabled=${(mode !== "chat" && !canInput && !draft.trimStart().startsWith("/")) ||
							working ||
							!view ||
							(mode === "prompt" && view?.live.busy && !draft.trimStart().startsWith("/"))}
						>
							Send
						</button>
					</div>
					<div class="pocket-composer-meta">
						<${MicButton} dictation=${dictation} />
						<span class="pocket-usage"
							>${view ? view.usage.totalTokens.toLocaleString() + " tokens" : ""}</span
						>
					</div>
				</form>
				${receipt &&
				html`<div class="pocket-receipt" role="status">
					${receipt.status} · ${receipt.id.slice(0, 12)}
					${receipt.status === "queued" &&
					canSend &&
					html`<button
						disabled=${working}
						onClick=${() =>
							void run(async () => {
								const original = receipt,
									result = await client.request({ op: "withdraw", id: original.id });
								setReceipt((current) => (current?.id === original.id ? result.receipt : current));
							})}
					>
						Withdraw original input
					</button>`}
				</div>`}${retry &&
				html`<button onClick=${() => void run(() => submit(retry))}>Retry original request</button>`}
			</div>`}
			${notice &&
			html`<div class="pocket-notice" role="alert">
				${notice}<button class="pocket-icon-button" aria-label="Dismiss notice" onClick=${() => notify("")}>
					<${Icon} name="close" />
				</button>
			</div>`}
		</main>
		${extensions.overlay} ${sheet === "appearance" && html`<${Appearance} close=${() => openSheet(null)} />`}
		${sheet === "conversation" &&
		selected &&
		html`<${ConversationSettings}
			key=${contextKey}
			target=${selected}
			name=${title(selected)}
			state=${states[selected.conversationId] ?? { version: 0, archived: false }}
			entries=${allEntries}
			canManage=${person.role === "admin"}
			client=${client}
			changed=${navigationChanged}
			refresh=${refresh}
			pending=${pendingNavigation[contextKey] ?? null}
			setPending=${(command) => setPendingNavigation((previous) => ({ ...previous, [contextKey]: command }))}
			close=${() => openSheet(null)}
			error=${error}
		/>`}
		${sheet === "notifications" &&
		selected &&
		html`<${Notifications}
			key=${person.id + ":" + selected.key + ":" + selected.incarnation}
			target=${selected}
			person=${person}
			client=${client}
			close=${() => openSheet(null)}
			error=${error}
		/>`}
		${(sheet === "model" || sheet === "directory") &&
		selected &&
		configuration &&
		html`<${sheet === "model" ? ModelPicker : DirectoryPicker}
			key=${person.id + ":" + selected.key + ":" + selected.incarnation}
			target=${selected}
			person=${person}
			value=${configuration}
			client=${client}
			busy=${view?.live.busy ?? true}
			applied=${configurationApplied}
			close=${() => openSheet(null)}
			error=${error}
		/>`}
		${sheet === "configuration" &&
		selected &&
		html`<${Configuration}
			key=${person.id + ":" + selected.key + ":" + selected.incarnation}
			target=${selected}
			client=${client}
			busy=${view?.live.busy ?? true}
			applied=${configurationApplied}
			close=${() => openSheet(null)}
			error=${error}
		/>`}
		${sheet === "collaboration" &&
		selected &&
		shared &&
		html`<${Collaboration}
			key=${selected.conversationId + ":" + selected.incarnation}
			person=${person}
			target=${selected}
			client=${client}
			snapshot=${shared}
			updated=${setShared}
			notice=${notify}
			error=${error}
			close=${() => openSheet(null)}
		/>`}
		${sheet === "people" &&
		html`<${Sheet} label="People and invitations" close=${() => openSheet(null)}>
				<header>
					<h2>People & invitations</h2>
					<button class="pocket-icon-button" aria-label="Close people" onClick=${() => openSheet(null)}><${Icon} name="close" /></button>
				</header>
				<div class="pocket-sheet-body">
					${people?.people.map(
						(p) =>
							html`<div class="pocket-person-row">
								<span>${p.name}</span><span>${p.role} · ${p.active ? "Active" : "Revoked"}</span>${p.id !==
									person.id &&
								p.active &&
								html`<button
									onClick=${() =>
										void run(async () => {
											await client.request({ op: "person.revoke", id: p.id });
											setPeople(await client.request({ op: "people" }));
										})}
								>
									Revoke
								</button>`}
							</div>`,
					)}<label
						>Invite role<select
							aria-label="Invite role"
							value=${inviteRole}
							onChange=${(event) => setInviteRole(event.currentTarget.value)}
						>
							<option value="viewer">Viewer</option>
							<option value="sender">Sender</option>
							<option value="driver">Driver</option>
							<option value="admin">Admin</option>
						</select></label
					>
					<p>Invite to ${selected ? "this conversation" : "the workspace"}.</p>
					<button
						class="button"
						data-action="invite"
						onClick=${() =>
							void run(async () => {
								const result = await client.request({
									op: "invite",
									requestId: crypto.randomUUID(),
									role: inviteRole,
									resources: selected ? [selected.conversationId] : "*",
									ttlMs: 3600000,
								});
								setLink(result.token ? location.origin + "/#invite=" + result.token : "");
								setQr(result.qr ?? "");
							})}
					>
						Create invitation</button
					>${
						qr &&
						html`<img
							class="pocket-qr"
							alt="One-use invitation QR code"
							width="180"
							height="180"
							src=${qr}
						/>`
					}${
						link &&
						html`<label
							>One-use invitation link<input name="inviteLink" readonly value=${link} /><button
								class="button"
								onClick=${() => navigator.clipboard?.writeText(link)}
							>
								Copy link
							</button></label
						>`
					}
				</div>
		</${Sheet}>`}
	</div>`;
}
const root = document.getElementById("app");
root.replaceChildren();
render(html`<${App} />`, root);
