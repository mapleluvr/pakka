// Human collaboration UI adapted from pi-pocket's side-chat, notes and take-turns interaction patterns.
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
const html = htm.bind(h);

export function Collaboration({ person, target, client, snapshot, updated, notice, error, close }) {
	const [draft, setDraft] = useState(""),
		[quoteId, setQuote] = useState(null),
		[mention, setMention] = useState("");
	const [note, setNote] = useState(snapshot?.note.text ?? ""),
		[noteVersion, setNoteVersion] = useState(snapshot?.note.version ?? 0),
		[dirty, setDirty] = useState(false);
	const [pending, setPending] = useState(false),
		[retry, setRetry] = useState(null),
		[clock, setClock] = useState(Date.now());
	const active = useRef(true),
		dialog = useRef(null),
		typingUntil = useRef(0),
		lastTyping = useRef(0),
		publishPresence = useRef(null),
		originalFocus = useRef(document.activeElement);
	const canEdit = person.role !== "viewer",
		canDrive = ["driver", "admin"].includes(person.role);
	const driver = snapshot?.driver,
		own = driver?.personId === person.id,
		alive = driver?.expiresAt > clock;
	useEffect(() => {
		if (!dirty && snapshot) {
			setNote(snapshot.note.text);
			setNoteVersion(snapshot.note.version);
		}
	}, [snapshot?.note.version, dirty]);
	useEffect(() => {
		active.current = true;
		const publish = () =>
			client
				.request({
					op: "collaboration.presence",
					target,
					input: { state: document.hidden ? "away" : Date.now() < typingUntil.current ? "typing" : "here" },
				})
				.then((result) => {
					if (active.current) updated(result.snapshot);
				})
				.catch((failure) => {
					if (active.current) error(failure);
				});
		publishPresence.current = publish;
		const timer = setInterval(() => {
			setClock(Date.now());
			void publish();
		}, 10000);
		void publish();
		dialog.current?.focus();
		const key = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			}
			if (event.key === "Tab") {
				const nodes = [
					...dialog.current.querySelectorAll(
						'button:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
					),
				].filter((node) => node.getClientRects().length);
				if (
					nodes.length &&
					((!event.shiftKey && document.activeElement === nodes.at(-1)) ||
						(event.shiftKey &&
							(document.activeElement === nodes[0] || document.activeElement === dialog.current)))
				) {
					event.preventDefault();
					(event.shiftKey ? nodes.at(-1) : nodes[0]).focus();
				}
			}
		};
		document.addEventListener("keydown", key);
		document.addEventListener("visibilitychange", publish);
		return () => {
			active.current = false;
			publishPresence.current = null;
			clearInterval(timer);
			document.removeEventListener("keydown", key);
			document.removeEventListener("visibilitychange", publish);
			void client
				.request({ op: "collaboration.presence", target, input: { state: "leave" } })
				.catch(() => {});
			if (originalFocus.current?.isConnected) originalFocus.current.focus();
		};
	}, [target.conversationId, target.incarnation, person.id]);
	async function action(command) {
		if (pending) return;
		setPending(true);
		try {
			const result = await client.request(command);
			if (!active.current) return;
			updated(result.snapshot);
			setRetry(null);
			return result;
		} catch (failure) {
			if (active.current) {
				if (failure.outcome === "unknown") setRetry(command);
				error(failure);
			}
		} finally {
			if (active.current) setPending(false);
		}
	}
	function driverAction(kind) {
		return action({
			op: "collaboration.driver",
			target,
			input: {
				expectedVersion: driver.version,
				action: kind,
				...(kind !== "release" ? { ttlMs: 120000 } : {}),
			},
		});
	}
	return html`<div
		class="pocket-scrim"
		onClick=${(event) => {
			if (event.target === event.currentTarget) close();
		}}
	>
		<section
			class="pocket-sheet pocket-collaboration"
			ref=${dialog}
			role="dialog"
			aria-modal="true"
			aria-label="Team Collaboration"
			tabIndex="-1"
		>
			<header>
				<h2>Team Collaboration</h2>
				<button class="pocket-icon-button" aria-label="Close collaboration" onClick=${close}>
					<${Icon} name="close" />
				</button>
			</header>
			<div class="pocket-sheet-body">
				<p class="pocket-secondary">Human workspace · chat and notes stay outside the model context.</p>
				<section class="pocket-turns" aria-label="Driver Control">
					<p data-driver-status>
						${!driver?.personId
							? "Open to authorized contributors"
							: own
								? alive
									? "You are driving"
									: "Your driver lease expired"
								: alive
									? "Another driver holds this conversation"
									: "The driver lease expired"}
					</p>
					${canDrive &&
					html`<button
						data-action="claim-driver"
						disabled=${pending || !!(driver?.personId && !own && alive)}
						onClick=${() => void driverAction("claim")}
					>
						${own && alive ? "Renew driver lease" : "Take a turn"}
					</button>`}
					${canDrive &&
					driver?.personId &&
					(own || person.role === "admin") &&
					html`<button
						data-action="release-driver"
						disabled=${pending}
						onClick=${() => void driverAction("release")}
					>
						Release turn
					</button>`}
					${person.role === "admin" &&
					driver?.personId &&
					!own &&
					html`<button disabled=${pending} onClick=${() => void driverAction("take")}>Take over</button>`}
				</section>
				<section class="pocket-form" aria-label="Human Team Chat">
					<h3>Team Chat</h3>
					<p class="pocket-secondary" data-presence>
						${snapshot?.presence
							.map((row) => row.name + (row.state === "typing" ? " is typing" : " is here"))
							.join(" · ") || "No other active viewers"}
					</p>
					<div class="pocket-chat-messages" aria-live="polite">
						${snapshot?.messages.map(
							(message) =>
								html`<article key=${message.id} data-chat-message=${message.id} class="pocket-chat-row">
									<header>
										<strong>${message.authorName}</strong
										><time datetime=${new Date(message.createdAt).toISOString()}
											>${new Date(message.createdAt).toLocaleTimeString()}</time
										>${message.pinned && html`<span>Pinned</span>`}
									</header>
									${message.quoteId &&
									html`<blockquote>
										${snapshot.messages.find((row) => row.id === message.quoteId)?.text}
									</blockquote>`}
									<p>${message.text}</p>
									${message.mentions.length > 0 && html`<small>${message.mentions.length} mentioned</small>`}
									<footer>
										<button
											disabled=${pending}
											class="pocket-reaction"
											data-action="react-chat"
											aria-label=${"React to message from " + message.authorName}
											onClick=${() =>
												void action({
													op: "collaboration.react",
													target,
													input: {
														messageId: message.id,
														emoji: "👍",
														active: !message.reactions.some(
															(r) => r.emoji === "👍" && r.people.includes(person.id),
														),
													},
												})}
										>
											<${Icon} name="thumbsUp" /> ${message.reactions.find((r) => r.emoji === "👍")?.people
												.length ?? 0}
										</button>
										<button onClick=${() => setQuote(message.id)}>Quote</button>${canEdit &&
										html`<button
											disabled=${pending}
											data-action="pin-chat"
											onClick=${() =>
												void action({
													op: "collaboration.pin",
													target,
													input: { messageId: message.id, pinned: !message.pinned },
												})}
										>
											${message.pinned ? "Unpin" : "Pin"}
										</button>`}
									</footer>
								</article>`,
						)}
					</div>
					<form
						class="pocket-form"
						onSubmit=${(event) => {
							event.preventDefault();
							const command = {
								op: "collaboration.post",
								target,
								input: {
									requestId: crypto.randomUUID(),
									text: draft,
									...(quoteId ? { quoteId } : {}),
									...(mention ? { mentions: [mention] } : {}),
								},
							};
							void action(command).then((result) => {
								if (result && active.current) {
									setDraft("");
									setQuote(null);
									setMention("");
								}
							});
						}}
					>
						${quoteId &&
						html`<p>
							Quoting selected message
							<button type="button" onClick=${() => setQuote(null)}>Remove quote</button>
						</p>`}
						<label
							>Message the people here<textarea
								name="teamChat"
								maxlength="8192"
								rows="2"
								value=${draft}
								onInput=${(event) => {
									setDraft(event.currentTarget.value);
									typingUntil.current = Date.now() + 5000;
									if (Date.now() - lastTyping.current >= 1000) {
										lastTyping.current = Date.now();
										void publishPresence.current?.();
									}
								}}
							/>
						</label>
						<label
							>Mention<select value=${mention} onChange=${(event) => setMention(event.currentTarget.value)}>
								<option value="">Nobody</option>
								${snapshot?.presence
									.filter((p) => p.personId !== person.id)
									.map((p) => html`<option key=${p.personId} value=${p.personId}>${p.name}</option>`)}
							</select></label
						>
						<button class="button" data-action="post-chat" disabled=${pending || !draft.trim()} type="submit">
							Post to team
						</button>
					</form>
				</section>
				<section class="pocket-form" aria-label="Shared Notes">
					<h3>Shared Notes</h3>
					<label
						>Note<textarea
							name="sharedNote"
							value=${note}
							maxlength="32768"
							disabled=${!canEdit}
							rows="4"
							onInput=${(event) => {
								setNote(event.currentTarget.value);
								setDirty(true);
							}}
						/>
					</label>
					<small
						>${"Version " + (snapshot?.note.version ?? 0)}${dirty && snapshot?.note.version !== noteVersion
							? " · Changed by another person. Reload before saving."
							: ""}</small
					>
					${canEdit &&
					html`<button
						data-action="save-note"
						disabled=${pending || !dirty}
						onClick=${() =>
							void action({
								op: "collaboration.note",
								target,
								input: { expectedVersion: noteVersion, text: note },
							}).then((result) => {
								if (result && active.current) {
									setDirty(false);
									notice("Shared note saved.");
								}
							})}
					>
						Save note
					</button>`}
					${dirty &&
					html`<button
						onClick=${() => {
							setNote(snapshot.note.text);
							setNoteVersion(snapshot.note.version);
							setDirty(false);
						}}
					>
						Reload shared note
					</button>`}
				</section>
				${retry &&
				html`<p role="status">This result is unconfirmed. Read the shared state before retrying.</p>
					<button disabled=${pending} onClick=${() => void action({ op: "collaboration.read", target })}>
						Check shared state
					</button>`}
			</div>
		</section>
	</div>`;
}
