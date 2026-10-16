// Pakka-Pocket workbench. Adapted from pi-pocket's app/composer/transcript patterns; authority is the public Pocket client.
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { h } from "preact";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { createPocketClient } from "@pakka/client/pocket";
import { decodePocketEvent } from "@pakka/protocol/pocket";
import { useExtensions } from "./extensions.js";
import { Collaboration } from "./collaboration.js";

const html = htm.bind(h);
const csrf = () => /(?:^|; )pakka_csrf=([A-Za-z0-9_-]{43})(?:;|$)/.exec(document.cookie)?.[1] ?? null;
const client = createPocketClient({ endpoint: new URL("/pocket/rpc", location.href).href, csrf });
const incoming = new URLSearchParams(location.hash.slice(1));
let signInToken = incoming.get("signin") ?? incoming.get("invite") ?? "";
const signInKind = incoming.has("invite") ? "invite" : "session";
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
const markdown = (text) =>
	DOMPurify.sanitize(marked.parse(String(text), { async: false }), {
		FORBID_TAGS: ["form", "input", "button", "iframe", "style", "link"],
		FORBID_ATTR: ["style"],
		ALLOW_DATA_ATTR: false,
	});
const label = (ref) => ref.profile + " · " + ref.conversationId.slice(0, 8);

function Message({ message }) {
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
	</article>`;
}
function App() {
	const [person, setPerson] = useState(null),
		[refs, setRefs] = useState([]),
		[titles, setTitles] = useState({}),
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
	const mounted = useRef(true),
		scroll = useRef(null),
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
		resourceContext.current = null;
		extensions.clear();
		setView(null);
		setShared(null);
		setRefs([]);
		setTitles({});
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
				: failure.code === "CONFLICT"
					? "This shared record changed. Reload it before saving again."
					: "This operation was refused.",
		);
	};
	async function refresh() {
		const hello = await client.request({ op: "hello" });
		const list = await client.request({ op: "list" });
		if (!mounted.current) return;
		setPerson(hello.person);
		setRefs(list.conversations);
		setTitles(list.titles ?? {});
	}
	useEffect(() => {
		void refresh().catch((failure) => {
			if (failure.code === "UNAUTHORIZED") setPerson(null);
			else error(failure);
		});
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		setView(null);
		setShared(null);
		openSheet(null);
		setReceipt(null);
		setRetry(null);
		if (!selected || !person) return;
		let active = true,
			sequence = 0,
			generation;
		const events = new EventSource(
			"/pocket/events?conversationId=" + encodeURIComponent(selected.conversationId),
		);
		events.addEventListener("pocket", (event) => {
			try {
				const value = decodePocketEvent(JSON.parse(event.data));
				if (!active) return;
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
			if (active) {
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
		if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
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
		const result = await client.request(command);
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
	async function showPeople() {
		await run(async () => {
			const result = await client.request({ op: "people" });
			setPeople(result);
			setLink("");
			setQr("");
			openSheet("people");
		});
	}
	const canSend = person && person.role !== "viewer",
		canDrive = person && ["driver", "admin"].includes(person.role),
		canInput =
			canSend &&
			(!shared?.driver.personId ||
				(shared.driver.personId === person?.id && shared.driver.expiresAt > Date.now()));
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
	return html`<div class=${"layout pocket-workbench" + (drawer ? " drawer-open" : "")}>
		<aside class="sidebar window">
			<div class="pocket-side-head">
				<strong>Pakka-Pocket</strong><span class="pocket-person">${person.name} · ${person.role}</span>
			</div>
			<nav class="pocket-nav" aria-label="Conversations">
				${refs.map(
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
							<span>◈</span><span>${title(ref)}</span>
						</button>`,
				)}
			</nav>
			<nav class="pocket-nav" aria-label="Extensions">${extensions.navigation}</nav>
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
							profile: "default",
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
				/><button class="button" type="submit" disabled=${working}>+</button>
			</form>`}
			<div class="pocket-side-foot">
				<button
					onClick=${() =>
						(document.documentElement.dataset.mode =
							document.documentElement.dataset.mode === "light" ? "dark" : "light")}
				>
					Appearance</button
				><button
					onClick=${() =>
						void run(async () => {
							await client.request({ op: "session.logout" });
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
				<button class="pocket-menu" aria-label="Toggle conversations" onClick=${() => setDrawer(!drawer)}>
					☰
				</button>
				<div class="pocket-title">${selected ? title(selected) : "Your workspace"}</div>
				<span class="pocket-status">${view?.live.busy ? "Working" : view ? "Ready" : ""}</span>${selected &&
				html`<button data-action="collaboration" onClick=${showCollaboration}>
					Team
				</button>`}${extensions.button}${person.role === "admin" &&
				html`<button data-action="people" onClick=${showPeople}>People & invites</button>`}
			</header>
			${extensions.page && extensions.surface}
			<div class="scroller" ref=${scroll} hidden=${extensions.page}>
				${selected
					? html`<div class="transcript">
							${!view
								? html`<p role="status">Connecting…</p>`
								: view.entries.map(
										(entry) =>
											html`<section key=${entry.id} data-entry=${entry.id}>
												${entry.display
													? html`<aside class="pocket-display">
															<span>${entry.display.kind === "chat" ? "Team chat" : "Card"}</span>
															<p>${entry.display.text}</p>
														</aside>`
													: entry.messages.map(
															(message, index) => html`<${Message} key=${index} message=${message} />`,
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
				<form class="composer" onSubmit=${send}>
					<textarea
						name="message"
						aria-label="Message"
						rows="3"
						value=${draft}
						placeholder=${canSend ? "Message your agent…" : "Read-only commands…"}
						onInput=${(event) => setDraft(event.currentTarget.value)}
					/>
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
						><span class="pocket-usage"
							>${view ? view.usage.totalTokens.toLocaleString() + " tokens" : ""}</span
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
				</form>
				${receipt &&
				html`<div class="pocket-receipt" role="status">
					${receipt.status} · ${receipt.id.slice(0, 12)}
				</div>`}${retry &&
				html`<button onClick=${() => void run(() => submit(retry))}>Retry original request</button>`}
			</div>`}
			${notice &&
			html`<div class="pocket-notice" role="alert">
				${notice}<button aria-label="Dismiss notice" onClick=${() => notify("")}>×</button>
			</div>`}
		</main>
		${extensions.overlay}
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
		html`<div
			class="pocket-scrim"
			onClick=${(event) => {
				if (event.target === event.currentTarget) openSheet(null);
			}}
		>
			<section class="pocket-sheet" role="dialog" aria-modal="true" aria-label="People and invitations">
				<header>
					<h2>People & invitations</h2>
					<button aria-label="Close people" onClick=${() => openSheet(null)}>×</button>
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
					>${qr &&
					html`<img
						class="pocket-qr"
						alt="One-use invitation QR code"
						width="180"
						height="180"
						src=${qr}
					/>`}${link &&
					html`<label
						>One-use invitation link<input name="inviteLink" readonly value=${link} /><button
							class="button"
							onClick=${() => navigator.clipboard?.writeText(link)}
						>
							Copy link
						</button></label
					>`}
				</div>
			</section>
		</div>`}
	</div>`;
}
const root = document.getElementById("app");
root.replaceChildren();
render(html`<${App} />`, root);
