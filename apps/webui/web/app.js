// pakka-webui workbench. Adapted from pi-pocket's app/composer/transcript patterns; authority is the public WebUI client.
import { render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { h } from "preact";
import { Icon } from "@pakka/webui/components";
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
import { useDictation } from "./voice.js";
import { describePart } from "./message-parts.js";
import { Sheet } from "./sheet.js";
import { ConversationSettings } from "./navigation.js";
import { Appearance, readAppearance, applyAppearance } from "./appearance.js";
import { Frontend, Glyph } from "./frontend.js";
import { NativeComposer } from "./native-composer.js";
import { SettingsNavigation, SettingsPage } from "./settings-page.js";

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

// One call reaches the transcript through three carriers: the `toolCall` part (id), the
// `toolResult` message (toolCallId) and `live.tools` (callId). A single card resolves all three
// so a call can never appear twice, and a result whose declaration was truncated still shows.
function ToolCard({ call, results, live, orphan, source }) {
	const id = call.callId;
	const key = id ? callKey(source, id) : undefined;
	const result = key ? results?.get(key) : undefined;
	const running = key ? live?.get(key) : undefined;
	const status = running?.status;
	const name = call.name ?? result?.toolName ?? "Tool";
	// A tool result is a message like any other: its content may carry images next to text. Each
	// part goes through the same describer, so a result never loses a part just because it is not
	// plain text, and a supported image is shown rather than flattened into a string.
	const resultParts = (
		typeof result?.content === "string" ? [{ type: "text", text: result.content }] : (result?.content ?? [])
	).map((part) => describePart(part));
	// An empty live output is no output: treating it as present would hide the result parts that
	// arrived with the committed message.
	const liveOutput =
		typeof running?.output === "string" && running.output !== "" ? running.output : undefined;
	const firstText = resultParts.find((part) => part.kind === "text")?.text;
	const firstImage = resultParts.find((part) => part.kind === "image");
	const firstUnrenderable = resultParts.find((part) => part.kind === "unrenderable");
	const preview =
		liveOutput ??
		(firstText ||
			(firstImage ? "Image result" : undefined) ||
			(firstUnrenderable?.mime ? `Attachment (${firstUnrenderable.mime})` : undefined));
	return html`<details
		class="tool-card"
		data-call-id=${id || undefined}
		data-source-conversation=${source || undefined}
		data-tool-status=${status || undefined}
		data-tool-error=${result?.isError ? "true" : undefined}
	>
		<summary class="tool-card-head pocket-disclosure">
			<${Icon} name="chevron" />
			<span class="tool-name">${name}</span>
			${status && html`<span class="status-pill" data-tool-pill>${status}</span>`}
			${result?.isError && html`<span class="status-pill" data-tool-result-error>error</span>`}
			${orphan && html`<span class="tool-orphan" data-tool-orphan>call not in this view</span>`}
			${preview ? html`<span class="tool-preview" data-tool-preview>${preview.split("\n")[0]}</span>` : null}
		</summary>
		${call.arguments != null &&
		html`<pre key="arguments" data-tool-arguments>${JSON.stringify(call.arguments, null, 2)}</pre>`}
		${liveOutput !== undefined && html`<pre key="live-output" data-tool-output>${liveOutput}</pre>`}
		${liveOutput === undefined &&
		resultParts.map((part, index) => {
			switch (part.kind) {
				case "text":
					return html`<pre key=${"result-" + index} data-tool-output>${part.text}</pre>`;
				case "image":
					return html`<img
						key=${"result-" + index}
						class="pocket-image"
						alt="Tool result attachment"
						src=${`data:${part.mime};base64,${part.data}`}
					/>`;
				default:
					return html`<p
						key=${"result-" + index}
						class="part-unrenderable"
						data-part-type=${part.type ?? "unknown"}
						data-part-mime=${part.mime || undefined}
					>
						${part.mime
							? `Attachment (${part.mime}) cannot be previewed here.`
							: "This part cannot be shown here."}
					</p>`;
			}
		})}
	</details>`;
}

function Message({ message, onDraft, results, live, isLive, source }) {
	const content =
		typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
	const parts = (content ?? []).map((part) => describePart(part));
	return html`<article
		class=${(message.role === "user" ? "message message-user" : "message message-agent") +
		(isLive ? " message-live" : "")}
		data-role=${message.role}
		data-live=${isLive ? "true" : undefined}
	>
		<div class=${"message-avatar " + (message.role === "user" ? "user-avatar" : "agent-avatar")}>
			<${Glyph}
				name=${message.role === "user" ? "user" : "logo"}
				className=${message.role === "user" ? "icon" : "logo-mark"}
			/>
		</div>
		<div class="message-content">
			<div class="message-byline">
				<strong>
					${message.role === "user"
						? "You"
						: message.role === "assistant"
							? "Agent"
							: (message.toolName ?? "Tool")}
				</strong>
			</div>
			${parts.map((part, i) => {
				switch (part.kind) {
					case "text":
						return html`<div
							key=${i}
							class="markdown"
							dangerouslySetInnerHTML=${{ __html: markdown(part.text) }}
						/>`;
					case "thinking":
						return html`<details key=${i}>
							<summary class="pocket-disclosure"><${Icon} name="chevron" />Reasoning</summary>
							<pre>${part.text}</pre>
						</details>`;
					case "toolCall":
						return html`<${ToolCard}
							key=${callKey(source, part.callId)}
							call=${part}
							results=${results}
							live=${live}
							source=${source}
						/>`;
					case "image":
						return html`<img
							key=${i}
							class="pocket-image"
							alt="Conversation attachment"
							src=${"data:" + part.mime + ";base64," + part.data}
						/>`;
					default:
						// A part that passed protocol validation but cannot be shown must still say
						// so: rendering nothing is exactly the fail-open shape this replaces.
						return html`<p
							key=${i}
							class="part-unrenderable"
							data-part-type=${part.type ?? "unknown"}
							data-part-mime=${part.mime || undefined}
						>
							${part.mime
								? "Attachment (" + part.mime + ") cannot be previewed here."
								: "This part cannot be shown here."}
						</p>`;
				}
			})}
			${message.role === "assistant" &&
			message.errorMessage &&
			html`<p class="pocket-error" data-message-error>${message.errorMessage}</p>`}
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
		</div>
	</article>`;
}
// A tool call is identified by its Conversation and its call id: an inherited (fork) result and a
// live call may legitimately share an id across Conversations, and collapsing them would attach
// one Conversation's output to another's call.
const callKey = (conversationId, callId) => JSON.stringify([conversationId, callId]);
const entrySource = (entry) => entry.sourceConversationId ?? entry.conversationId;
// A streamed call and its first committed assistant entry must occupy the same keyed
// section, not merely use the same card key beneath two different parents.
const transcriptKey = (messages, source, entryId) => {
	for (const message of messages) {
		const call = Array.isArray(message.content)
			? message.content.find((part) => part.type === "toolCall" && part.id)
			: undefined;
		if (call) return "call:" + callKey(source, call.id);
	}
	return entryId === undefined ? "live:" + JSON.stringify(source) : "entry:" + JSON.stringify(entryId);
};
const unansweredLabel = (reason) => {
	if (reason === "blocked") return "blocked";
	if (reason === "aborted") return "withdrawn";
	return "not delivered";
};
// Receipt wording is driven by the DTO, never inferred: a refusal, a withdrawal and an
// undelivered input are all `unanswered`, and only the native reason tells them apart.
const receiptGuidance = (receipt) =>
	receipt.status === "unknown"
		? "Result unknown: check before resending. Do not resend blindly."
		: receipt.status === "unanswered"
			? receipt.reason === "blocked"
				? "Not delivered: policy refused this input. Edit it and send again."
				: receipt.reason === "aborted"
					? "Withdrawn before delivery. Send again only when ready."
					: "Not delivered. Review the input before sending again."
			: null;
function App() {
	const [person, setPerson] = useState(null),
		[refs, setRefs] = useState([]),
		[titles, setTitles] = useState({}),
		[states, setStates] = useState({}),
		[pendingNavigation, setPendingNavigation] = useState({}),
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
		[sheet, setSheet] = useState(null),
		[people, setPeople] = useState(null),
		[link, setLink] = useState(""),
		[qr, setQr] = useState(""),
		[inviteRole, setInviteRole] = useState("viewer");
	const [receipt, setReceipt] = useState(null),
		[retry, setRetry] = useState(null),
		[drawer, setDrawer] = useState(false),
		[collapsed, setCollapsed] = useState(false),
		[searchQuery, setSearchQuery] = useState(""),
		[creationSource, setCreationSource] = useState(null),
		[creationAttempt, setCreationAttempt] = useState(null),
		[newName, setNewName] = useState("");
	const creationCommand = useRef(null);
	const settingsIntent = useRef(null);
	function openSheet(page) {
		settingsIntent.current = {};
		setSheet(page);
	}
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
		navigate: async (ref) => {
			const binding = resourceContext.current;
			try {
				const list = await client.request({ op: "list" });
				if (!mounted.current || resourceContext.current !== binding) return;
				const current = list.conversations.find(
					(row) => row.sessionId === ref.sessionId && row.conversationId === ref.conversationId,
				);
				if (!current) {
					notify("This conversation is unavailable.");
					return;
				}
				setRefs(list.conversations);
				setTitles(list.titles ?? {});
				setStates(list.states ?? {});
				extensions.leave(true);
				select(current);
				setDrawer(false);
			} catch (failure) {
				if (mounted.current && resourceContext.current === binding) error(failure);
			}
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
		creationCommand.current = null;
		setCreationAttempt(null);
		setCreationSource(null);
		setNewName("");
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
	useEffect(() => {
		if (!person) return;
		const shortcut = (event) => {
			if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
			if (event.key.toLowerCase() === "k") {
				event.preventDefault();
				searchConversations();
			} else if (event.key.toLowerCase() === "b") {
				event.preventDefault();
				if (matchMedia("(max-width: 767px)").matches) {
					if (drawer) dismissDrawer();
					else setDrawer(true);
				} else setCollapsed(!collapsed);
			}
		};
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	}, [person?.id, collapsed, drawer]);
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
		const binding = resourceContext.current;
		const intent = {};
		settingsIntent.current = intent;
		await run(async () => {
			const result = await client.request({ op: "people" });
			if (!mounted.current || resourceContext.current !== binding || settingsIntent.current !== intent)
				return;
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
	function home() {
		setCreationSource(selected ?? creationSource);
		extensions.leave();
		select(null);
		setDrawer(false);
	}
	async function createdConversation(ref, command, binding) {
		if (creationCommand.current !== command) return;
		creationCommand.current = null;
		setCreationAttempt(null);
		setNewName("");
		await refresh();
		if (!mounted.current || resourceContext.current !== binding) return;
		extensions.leave();
		select(ref);
		setDrawer(false);
	}
	async function createConversation(event) {
		event.preventDefault();
		if (working || creationCommand.current || !newName.trim()) return;
		const source = selected ?? creationSource,
			binding = resourceContext.current,
			command = {
				op: "create",
				requestId: crypto.randomUUID(),
				name: newName,
				profile: source?.profile ?? "default",
				...(source ? { inherit: source } : {}),
			};
		creationCommand.current = command;
		setCreationAttempt({ command });
		await run(async () => {
			try {
				const created = await client.request(command);
				await createdConversation(created.ref, command, binding);
			} catch (failure) {
				if (failure.outcome === "denied" && creationCommand.current === command) {
					creationCommand.current = null;
					setCreationAttempt(null);
				}
				throw failure;
			}
		});
	}
	async function checkCreation() {
		const command = creationCommand.current,
			binding = resourceContext.current;
		if (!command || working) return;
		await run(async () => {
			const result = await client.request({ op: "conversation.lookup", original: command });
			if (creationCommand.current !== command) return;
			if (result.result) await createdConversation(result.result, command, binding);
			else setCreationAttempt({ command, missing: true });
		});
	}
	function searchConversations() {
		setSearchQuery("");
		setDrawer(false);
		openSheet("search");
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
	// One call can arrive as a `toolCall` part (id), a `toolResult` message (toolCallId) and a
	// live tool entry (callId). Index all three before rendering so each call resolves to exactly
	// one card, and so a result whose declaration was truncated is still shown rather than lost.
	const toolResults = new Map(),
		declaredCalls = new Set();
	for (const entry of allEntries) {
		const source = entrySource(entry);
		for (const message of entry.messages) {
			if (message.role === "toolResult" && message.toolCallId)
				toolResults.set(callKey(source, message.toolCallId), message);
			if (Array.isArray(message.content))
				for (const part of message.content)
					if (part && part.type === "toolCall" && part.id) declaredCalls.add(callKey(source, part.id));
		}
	}
	const liveTools = new Map(
		(view?.live.tools ?? []).map((tool) => [callKey(view.ref.conversationId, tool.callId), tool]),
	);
	const visibleEntries = allEntries.filter(
		(entry) =>
			!find ||
			JSON.stringify([entry.messages, entry.display?.text])
				.toLocaleLowerCase()
				.includes(find.toLocaleLowerCase()),
	);
	const transcriptRows = visibleEntries.map((entry) => ({
		entry,
		messages: entry.messages,
		source: entrySource(entry),
	}));
	if (view?.live.message)
		transcriptRows.push({
			messages: [view.live.message],
			source: view.ref.conversationId,
			isLive: true,
		});
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
				<h1>pakka-webui</h1>
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
	const settingsRoute = (route) => {
		extensions.closeSettings();
		openSheet(route);
	};
	const settingsPages = [
		{
			id: "appearance",
			title: "Appearance",
			category: "Personal",
			icon: "system",
			open: () => settingsRoute("appearance"),
		},
		{
			id: "configuration",
			title: "Conversation Settings",
			category: "Conversation",
			icon: "settings",
			disabled: !selected,
			open: () => settingsRoute("configuration"),
		},
		{
			id: "notifications",
			title: "Notifications",
			category: "Conversation",
			icon: "bell",
			disabled: !selected,
			open: () => settingsRoute("notifications"),
		},
		...(person.role === "admin"
			? [
					{
						id: "people",
						title: "People & Invitations",
						category: "Workspace",
						icon: "user",
						open: () => {
							extensions.closeSettings();
							void showPeople();
						},
					},
				]
			: []),
		{
			id: "extensions",
			title: "Extensions",
			category: "Workspace",
			icon: "commands",
			open: () => {
				openSheet(null);
				extensions.openSettings();
			},
		},
	];
	return html`<${SettingsNavigation.Provider} value=${settingsPages}><${Frontend}
		person=${person} refs=${refs} titles=${titles} states=${states} selected=${selected} view=${view} extensions=${extensions}
		drawer=${drawer} collapsed=${collapsed} drawerToggle=${drawerToggle} dismissDrawer=${dismissDrawer}
		home=${home} choose=${(ref) => {
			extensions.leave();
			select(ref);
			setDrawer(false);
		}} search=${searchConversations}
		openSheet=${(route) => {
			if (route === "collapse-sidebar") setCollapsed(true);
			else if (route === "expand-sidebar") setCollapsed(false);
			else if (route === "toggle-drawer") setDrawer(!drawer);
			else openSheet(route);
		}}
		showPeople=${showPeople} showCollaboration=${showCollaboration} refresh=${() => void run(refresh)}
		signOut=${() =>
			void run(async () => {
				await client.request({ op: "session.logout" });
				clearDirectoryPreferences(person);
				invalidate();
				setPerson(null);
			})}
		historyFind=${find} setHistoryFind=${setFind}
		canDrive=${canDrive} configuration=${configuration} newName=${newName} setNewName=${setNewName}
		createConversation=${createConversation} working=${working} creationAttempt=${creationAttempt}
		transcript=${html`<div
			class="conversation-scroll"
			ref=${scroll}
			onScroll=${(event) => {
				const node = event.currentTarget;
				follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
			}}
		>
			<div class="message-list">
				${olderCursor &&
				html`<button
					class="pill-btn"
					data-action="show-earlier"
					disabled=${working}
					onClick=${() => void earlier()}
				>
					Show earlier history
				</button>`}
				${!view
					? html`<p role="status">Connecting…</p>`
					: transcriptRows.map(({ entry, messages, source, isLive }) => {
							return html`<section key=${transcriptKey(messages, source, entry?.id)} data-entry=${entry?.id}>
								${entry?.display
									? html`<aside class="tool-card">
											<div class="tool-card-head">
												${entry.display.kind === "chat" ? "Team Chat" : "Card"}
											</div>
											<p>${entry.display.text}</p>
										</aside>`
									: messages.map((message, index) =>
											message.role === "toolResult"
												? declaredCalls.has(callKey(source, message.toolCallId))
													? null
													: html`<${ToolCard}
															key=${index}
															call=${{
																callId: message.toolCallId,
																name: message.toolName,
																arguments: null,
															}}
															results=${toolResults}
															live=${liveTools}
															source=${source}
															orphan
														/>`
												: html`<${Message}
														key=${index}
														message=${message}
														onDraft=${canSend ? useDraft : undefined}
														results=${toolResults}
														live=${liveTools}
														source=${source}
														isLive=${isLive}
													/>`,
										)}
							</section>`;
						})}
				${(view?.live.tools ?? [])
					.filter((tool) => !declaredCalls.has(callKey(view.ref.conversationId, tool.callId)))
					.map(
						(tool) =>
							html`<${ToolCard}
								key=${tool.callId}
								call=${{ callId: tool.callId, name: tool.name, arguments: null }}
								results=${toolResults}
								live=${liveTools}
								source=${view.ref.conversationId}
							/>`,
					)}
				${view?.live.busy &&
				view.live.message &&
				html`<div class="stream-status" data-streaming="true">
					<span class="status-pill" role="status">Streaming</span>
				</div>`}
			</div>
		</div>`}
		composer=${html`<${NativeComposer} inputRef=${composer} draft=${draft} setDraft=${setDraft} mode=${mode} setMode=${setMode} canSend=${canSend} canDrive=${canDrive} canInput=${canInput} working=${working} view=${view} send=${send} abort=${() => void run(() => client.request({ op: "abort", target: selected }))} model=${configuration?.current?.model} canConfigure=${configuration?.canConfigure} configureModel=${() => openSheet("model")} dictation=${dictation} suggestions=${extensions.suggestions(draft, () => setDraft(""))}>
			${
				receipt &&
				html`<div
					class="composer-annotation pocket-receipt"
					role="status"
					data-receipt-status=${receipt.status}
				>
					${`${receipt.status} · ${String(receipt.id).slice(0, 12)}`}${receipt.status === "unanswered" &&
					html`${" "}<span class="receipt-badge" data-receipt-reason=${receipt.reason}
							>${unansweredLabel(receipt.reason)}</span
						>${" "}<span class="receipt-guidance">${receiptGuidance(receipt)}</span>`}${receipt.status ===
						"unknown" &&
					html`${" "}<span class="receipt-badge" data-receipt-reason="unknown">needs review</span>${" "}<span
							class="receipt-guidance"
							>${receiptGuidance(receipt)}</span
						>`}${receipt.status === "queued" &&
					canSend &&
					html`${" "}<button
							class="pill-btn"
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
				</div>`
			}
			${retry && html`<button class="pill-btn" onClick=${() => void run(() => submit(retry))}>Retry original request</button>`}
		</${NativeComposer}>`}
		recovery=${creationAttempt && html`<div class="creation-recovery" role="status"><span>${creationAttempt.missing ? "No committed result is visible. Nothing was replayed; new creation stays blocked in this page." : "New conversation result is unconfirmed. Check the original request before creating another."}</span><button class="pill-btn" data-action="check-creation" disabled=${working} onClick=${checkCreation}>Check original creation</button></div>`}
		notice=${
			notice &&
			html`<div class="toast" role="alert">
				${notice}<button class="icon-btn" aria-label="Dismiss notice" onClick=${() => notify("")}>
					<${Glyph} name="x" />
				</button>
			</div>`
		}
	>
		${extensions.overlay} ${sheet === "appearance" && html`<${Appearance} close=${() => openSheet(null)} />`}
		${
			sheet === "search" &&
			html`<${Sheet} variant="palette" label="Search conversations" initialFocus='input[type="search"]' close=${() => openSheet(null)}>
			<div class="palette-search"><${Glyph} name="search" /><input type="search" aria-label="Search conversations" placeholder="Type a command or search…" value=${searchQuery} onInput=${(event) => setSearchQuery(event.currentTarget.value)} /></div>
			<div class="palette-body">
				${refs
					.filter(
						(ref) =>
							(showArchived || !states[ref.conversationId]?.archived) &&
							title(ref).toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()),
					)
					.map(
						(ref) =>
							html`<button
								class="palette-row"
								data-search-conversation=${ref.conversationId}
								onClick=${() => {
									extensions.leave();
									select(ref);
									openSheet(null);
								}}
							>
								<${Glyph} name="message" /><span
									>${title(ref)}${states[ref.conversationId]?.archived ? " · Archived" : ""}</span
								>
							</button>`,
					)}
				<div class="palette-caption">Actions</div>
				<button class="palette-row" onClick=${() => {
					openSheet(null);
					home();
				}}><${Glyph} name="plus" /><span>New Session</span></button>
				<button class="palette-row" data-action="commands" onClick=${() => {
					openSheet(null);
					extensions.openCommands();
				}}><${Glyph} name="commands" /><span>Commands & Extensions</span></button>
				<button class="palette-row" onClick=${() => openSheet("appearance")}><${Glyph} name="system" /><span>Appearance…</span></button>
				<label class="palette-row"><input type="checkbox" data-action="show-archived" checked=${showArchived} onChange=${(event) => setShowArchived(event.currentTarget.checked)} />Show archived sessions</label>
			</div><div class="palette-footer"><span><kbd aria-label="Up arrow"><${Icon} name="up" /></kbd><kbd aria-label="Down arrow"><${Icon} name="down" /></kbd> Navigate</span><span><kbd>esc</kbd> Close</span><span class="palette-footer-right"><kbd aria-label="Enter"><${Icon} name="enter" /></kbd> Select</span></div>
		</${Sheet}>`
		}
		${
			sheet === "conversation" &&
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
				setPending=${(command) =>
					setPendingNavigation((previous) => ({ ...previous, [contextKey]: command }))}
				close=${() => openSheet(null)}
				error=${error}
			/>`
		}
		${
			sheet === "notifications" &&
			selected &&
			html`<${Notifications}
				key=${person.id + ":" + selected.key + ":" + selected.incarnation}
				target=${selected}
				person=${person}
				client=${client}
				close=${() => openSheet(null)}
				error=${error}
			/>`
		}
		${
			(sheet === "model" || sheet === "directory") &&
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
			/>`
		}
		${
			sheet === "configuration" &&
			selected &&
			html`<${Configuration}
				key=${person.id + ":" + selected.key + ":" + selected.incarnation}
				target=${selected}
				client=${client}
				busy=${view?.live.busy ?? true}
				applied=${configurationApplied}
				close=${() => openSheet(null)}
				error=${error}
			/>`
		}
		${
			sheet === "collaboration" &&
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
			/>`
		}
		${
			sheet === "people" &&
			html`<${SettingsPage} title="People & Invitations" label="People & Invitations" category="Workspace" icon="user" closeLabel="Close people" close=${() => openSheet(null)} description="People with access, their roles and one-use invitations.">
				<div class="settings-card settings-native-fields">
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
		</${SettingsPage}>`
		}
	</${Frontend}></${SettingsNavigation.Provider}>`;
}
const root = document.getElementById("app");
root.replaceChildren();
render(html`<${App} />`, root);
