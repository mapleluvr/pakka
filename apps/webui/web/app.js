// pakka-webui workbench. Adapted from pi-pocket's app/composer/transcript patterns; authority is the public WebUI client.
import { render } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useContext } from "preact/hooks";
import htm from "htm";
import { h, createContext } from "preact";
import { Icon } from "@pakka/webui/components";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { createPocketClient, applyPocketObservation } from "@pakka/client/pocket";
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
import { useCreation } from "./creation.js";
import { resourceKey } from "./resource-identity.js";
import { ConversationSettings } from "./navigation.js";
import { Appearance, readAppearance, applyAppearance } from "./appearance.js";
import { Frontend, Glyph, Menu } from "./frontend.js";
import { NativeComposer } from "./native-composer.js";
import { SettingsNavigation, SettingsPage } from "./settings-page.js";
import { createModelsClient } from "./models-client.js";
import { ProductModelSettings, useProductModelSettings } from "./product-model-settings.js";
import { BudgetSettings, useBudgetSettings } from "./budget-settings.js";
import { SessionSettings, useSessionRecovery } from "./session-settings.js";
import { ContentCache } from "./content-cache.js";
import {
	TextBody,
	ContentDisclosure,
	ImageDisclosure,
	originalDownload,
	useDisclosure,
} from "./content-reader.js";
import { DisclosureState } from "./disclosure-state.js";
import { subscribeObservation } from "./observation-client.js";
import { fitHistoryWindow } from "./virtual-window.js";
import { VirtualTranscript } from "./virtual-transcript.js";

const ReaderContext = createContext({ cache: null, target: null, disclosures: null });

const html = htm.bind(h);
const HISTORY_WINDOW_BYTES = 4 * 1024 * 1024;
const historyBytesLabel = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const emptyHistoryWindow = () => ({
	entries: [],
	retainedBytes: 0,
	unloadedOlder: false,
	unloadedNewer: false,
});
const csrf = () => /(?:^|; )pakka_csrf=([A-Za-z0-9_-]{43})(?:;|$)/.exec(document.cookie)?.[1] ?? null;
const client = createPocketClient({ endpoint: new URL("/pocket/rpc", location.href).href, csrf });
let contentScope = null;
const bodyCache = new ContentCache({
	scope: () => contentScope,
	visible: () => document.visibilityState === "visible",
	pressure: () => navigator.connection?.saveData === true,
	request: async (target, reference, range, options) => {
		const result = await client.request({ op: "content.read", target, reference, range }, options);
		if (result.kind !== "content") throw new Error("Original content is unconfirmed");
		return result.chunk;
	},
});
const disclosures = new DisclosureState({ scope: () => contentScope });
const incoming = new URLSearchParams(location.hash.slice(1));
let signInToken = incoming.get("signin") ?? incoming.get("invite") ?? "";
const signInKind = incoming.has("invite") ? "invite" : "session";
let requestedConversation = incoming.get("conversation"),
	requestedSession = incoming.get("session");
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
	const { cache, target, disclosures } = useContext(ReaderContext);
	const [open, setOpen] = useDisclosure(disclosures, target, "tool:" + callKey(source, call.callId));
	const id = call.callId,
		key = id ? callKey(source, id) : undefined;
	const result = key ? results?.get(key) : undefined,
		running = key ? live?.get(key) : undefined;
	const status = running?.status,
		name = call.name ?? result?.toolName ?? "Tool";
	const resultParts = (
		typeof result?.content === "string"
			? [{ type: "text", text: result.content, contentReference: result.contentReference }]
			: (result?.content ?? [])
	).map(describePart);
	const output = typeof running?.output === "string" && running.output !== "" ? running.output : undefined;
	const first = resultParts.find((part) => part.kind === "text")?.text;
	const preview =
		output ?? first ?? (resultParts.some((part) => part.kind === "image") ? "Image result" : "");
	return html`<details
		class="tool-card"
		open=${open}
		data-call-id=${id || undefined}
		data-source-conversation=${source || undefined}
		data-tool-status=${status || undefined}
		data-tool-error=${result?.isError ? "true" : undefined}
		onToggle=${(event) => setOpen(event.currentTarget.open)}
	>
		<summary class="tool-card-head pocket-disclosure">
			<${Icon} name="chevron" /><span class="tool-name">${name}</span>
			${status && html`<span class="status-pill" data-tool-pill>${status}</span>`}
			${result?.isError && html`<span class="status-pill" data-tool-result-error>error</span>`}
			${orphan && html`<span class="tool-orphan" data-tool-orphan>call not in this view</span>`}
			${preview && html`<span class="tool-preview" data-tool-preview>${preview.split("\n")[0]}</span>`}
		</summary>
		${open &&
		html`<div class="tool-body" data-tool-body>
			${call.arguments != null &&
			html`<${TextBody}
				cache=${cache}
				target=${target}
				reference=${call.reference}
				inline=${JSON.stringify(call.arguments, null, 2)}
				label="Arguments"
				marker="arguments"
			/>`}
			${output !== undefined &&
			html`<${TextBody}
				key="live-output"
				cache=${cache}
				target=${target}
				reference=${running.contentReference}
				inline=${output}
				label="Published tool output"
				marker="output"
			/>`}
			${(running?.droppedBytes || running?.droppedLines) &&
			html`<p class="content-hint" data-source-truncated>
				Source capture omitted ${running.droppedBytes ?? 0} bytes / ${running.droppedLines ?? 0} lines;
				original reading cannot recover them.
			</p>`}
			${output === undefined &&
			resultParts.map((part, at) =>
				part.kind === "text"
					? html`<${TextBody}
							key=${at}
							cache=${cache}
							target=${target}
							reference=${part.reference}
							inline=${part.text}
							label="Tool result"
							marker="output"
						/>`
					: part.kind === "image"
						? html`<${ImageDisclosure}
								key=${at}
								cache=${cache}
								disclosures=${disclosures}
								target=${target}
								reference=${part.reference}
								mime=${part.mime}
								data=${part.data}
								label="Tool result attachment"
							/>`
						: html`<p
								key=${at}
								class="part-unrenderable"
								data-part-type=${part.type ?? "unknown"}
								data-part-mime=${part.mime || undefined}
							>
								${part.mime
									? `Attachment (${part.mime}) cannot be previewed here.`
									: "This part cannot be shown here."}${part.reference &&
								html`<a href=${originalDownload(target, part.reference)} download>Save original</a>`}
							</p>`,
			)}
		</div>`}
	</details>`;
}

function Message({ message, onDraft, results, live, isLive, source }) {
	const { cache, target, disclosures } = useContext(ReaderContext);
	const content =
		typeof message.content === "string"
			? [{ type: "text", text: message.content, contentReference: message.contentReference }]
			: message.content;
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
							/>
							${part.reference &&
							!part.reference.previewComplete &&
							html`<${ContentDisclosure}
								key=${"full-" + i}
								cache=${cache}
								disclosures=${disclosures}
								target=${target}
								reference=${part.reference}
								text=${part.text}
								label="Complete original text"
							/>`}`;
					case "thinking":
						return html`<${ContentDisclosure}
							key=${i}
							cache=${cache}
							disclosures=${disclosures}
							target=${target}
							reference=${part.reference}
							text=${part.text}
							label="Reasoning"
						/>`;
					case "toolCall":
						return html`<${ToolCard}
							key=${callKey(source, part.callId)}
							call=${part}
							results=${results}
							live=${live}
							source=${source}
						/>`;
					case "image":
						return html`<${ImageDisclosure}
							key=${i}
							cache=${cache}
							disclosures=${disclosures}
							target=${target}
							reference=${part.reference}
							mime=${part.mime}
							data=${part.data}
							label="Conversation attachment"
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
								: "This part cannot be shown here."}${part.reference &&
							html`<a href=${originalDownload(target, part.reference)} download>Save original</a>`}
						</p>`;
				}
			})}
			${message.role === "assistant" &&
			message.errorMessage &&
			html`<p class="pocket-error" data-message-error>${message.errorMessage}</p>
				${message.errorReference &&
				html`<${ContentDisclosure}
					cache=${cache}
					disclosures=${disclosures}
					target=${target}
					reference=${message.errorReference}
					text=${message.errorMessage}
					label="Complete error"
				/>`}`}
			${message.role === "user" &&
			onDraft &&
			!parts.some((part) => part.reference && !part.reference.previewComplete) &&
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
		? "Result unknown: check before resending."
		: receipt.status === "unanswered"
			? receipt.reason === "blocked"
				? "Not delivered: policy refused this input."
				: receipt.reason === "aborted"
					? "Withdrawn before delivery."
					: "Not delivered."
			: null;
function InvitationRole({ value, change }) {
	const [trigger, setTrigger] = useState(null);
	const choices = [
		["viewer", "Viewer"],
		["sender", "Sender"],
		["driver", "Driver"],
		["admin", "Admin"],
	];
	function browse(event) {
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const items = [...event.currentTarget.querySelectorAll('[role="menuitemradio"]')],
			index = items.indexOf(document.activeElement);
		let next;
		if (event.key === "Home") next = 0;
		else if (event.key === "End") next = items.length - 1;
		else next = (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
		items[next]?.focus();
	}
	return html`<div class="settings-card-row invite-role-field">
		<label class="card-row-label" for="invite-role-trigger">Invite Role</label>
		<button
			id="invite-role-trigger"
			type="button"
			class="invite-role-trigger"
			aria-label="Invite Role"
			aria-describedby="invite-role-value"
			aria-haspopup="menu"
			aria-expanded=${Boolean(trigger)}
			value=${value}
			onClick=${(event) => setTrigger(trigger ? null : event.currentTarget)}
			onKeyDown=${(event) => {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					setTrigger(event.currentTarget);
				}
			}}
		>
			<span id="invite-role-value">${choices.find(([role]) => role === value)?.[1]}</span
			><${Icon} name="chevron" />
		</button>
		${trigger &&
		html`<${Menu}
			name="invite-role" trigger=${trigger} close=${() => setTrigger(null)} align="end"
			initialFocus=${'[aria-checked="true"]'} closeOnTab=${true}
		>
			<div onKeyDown=${browse}>
				${choices.map(
					([role, label]) =>
						html`<button
							type="button"
							class="menu-row"
							role="menuitemradio"
							aria-checked=${value === role}
							data-invite-role-choice=${role}
							onClick=${() => {
								change(role);
								setTrigger(null);
							}}
						>
							<span class="invite-role-marker" aria-hidden="true"
								>${value === role && html`<${Icon} name="check" />`}</span
							><span>${label}</span>
						</button>`,
				)}
			</div>
		</${Menu}>`}
	</div>`;
}
function App() {
	const [person, setPerson] = useState(null),
		[refs, setRefs] = useState([]),
		[titles, setTitles] = useState({}),
		[states, setStates] = useState({}),
		[resourceIds, setResourceIds] = useState({}),
		[sessionDirectory, setSessionDirectory] = useState(null),
		[workspaceSessionId, setWorkspaceSessionId] = useState(null),
		[pendingNavigation, setPendingNavigation] = useState({}),
		[showArchived, setShowArchived] = useState(false),
		[find, setFind] = useState(""),
		[historyWindow, setHistoryWindow] = useState(emptyHistoryWindow),
		[historyCursor, setHistoryCursor] = useState(undefined),
		[selected, select] = useState(null),
		[view, setView] = useState(null),
		[shared, setShared] = useState(null);
	const historyEntries = historyWindow.entries;
	const title = (ref) => titles[resourceKey(ref)] ?? label(ref);
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
		[searchQuery, setSearchQuery] = useState("");
	const [modelConnection, setModelConnection] = useState(null);
	const modelTransport = useMemo(
		() => modelConnection && createModelsClient({ serverId: modelConnection.serverId, csrf }),
		[modelConnection?.serverId, modelConnection?.personId],
	);
	const models =
		person?.id === modelConnection?.personId && modelConnection?.nativeModels ? modelTransport : null;
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
	const contextKey = JSON.stringify([
		person?.id,
		selected?.sessionId,
		selected?.conversationId,
		selected?.key,
		selected?.incarnation,
	]);
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
				acceptNavigation(list);
				extensions.leave(true);
				select(current);
				setDrawer(false);
			} catch (failure) {
				if (mounted.current && resourceContext.current === binding) error(failure);
			}
		},
	});
	const invalidate = () => {
		contentScope = null;
		bodyCache.clear();
		disclosures.clear();
		clearDirectoryPreferences(person);
		void clearNotifications().catch(() => {});
		resourceContext.current = null;
		extensions.clear();
		setView(null);
		setShared(null);
		setRefs([]);
		setTitles({});
		setStates({});
		setResourceIds({});
		setPendingNavigation({});
		setHistoryWindow(emptyHistoryWindow());
		setHistoryCursor(undefined);
		setFind("");
		select(null);
		setPeople(null);
		openSheet(null);
		setReceipt(null);
		setRetry(null);
		setDraft("");
		setSessionDirectory(null);
		setWorkspaceSessionId(null);
		setModelConnection(null);
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
	const productModels = useProductModelSettings(models, error);
	const budget = useBudgetSettings(person?.id === modelConnection?.personId ? modelTransport : null, error);
	const sessionRecovery = useSessionRecovery(client, person?.id, refresh, error);
	const creation = useCreation({
		person,
		workspaceSessionId,
		configuration,
		selected,
		client,
		models,
		created: creationCompleted,
		sessionCreated: (session) =>
			setSessionDirectory(
				(previous) =>
					previous && {
						...previous,
						sessions: [...previous.sessions.filter((row) => row.id !== session.id), session],
					},
			),
		error,
	});
	function acceptNavigation(list) {
		setRefs(list.conversations);
		setResourceIds(
			Object.fromEntries((list.navigation ?? []).map((row) => [resourceKey(row.ref), row.resourceId])),
		);
		setTitles(Object.fromEntries((list.navigation ?? []).map((row) => [resourceKey(row.ref), row.name])));
		setStates(
			Object.fromEntries(
				(list.navigation ?? []).map((row) => [
					resourceKey(row.ref),
					{ version: row.version, archived: row.archived },
				]),
			),
		);
	}
	async function refresh(options) {
		const signal = options?.signal;
		const hello = await client.request({ op: "hello" }, { signal });
		const list = await client.request({ op: "list" }, { signal });
		const directory = await client.request({ op: "session.list" }, { signal });
		if (!mounted.current || options?.canPublish?.() === false) return;
		const nextScope = { serverId: hello.serverId, personId: hello.person.id };
		if (JSON.stringify(nextScope) !== JSON.stringify(contentScope)) bodyCache.clear();
		contentScope = nextScope;
		setPerson(hello.person);
		setModelConnection({
			serverId: hello.serverId,
			personId: hello.person.id,
			nativeModels: hello.nativeModels === true,
		});
		setWorkspaceSessionId(hello.sessionId);
		setSessionDirectory(directory);
		acceptNavigation(list);
		if (requestedConversation) {
			const matches = list.conversations.filter(
				(row) =>
					row.conversationId === requestedConversation &&
					(!requestedSession || row.sessionId === requestedSession),
			);
			const ref = matches.length === 1 ? matches[0] : null;
			requestedConversation = null;
			requestedSession = null;
			if (matches.length > 1)
				notify("This Conversation ID belongs to multiple Sessions. Select its Session explicitly.");
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
			requestedSession = new URLSearchParams(location.hash.slice(1)).get("session");
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
			if (event.shiftKey && event.key.toLowerCase() === "o") {
				event.preventDefault();
				beginCreation("conversation", selected?.sessionId);
			} else if (event.key.toLowerCase() === "k") {
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
	}, [person?.id, collapsed, drawer, selected?.sessionId]);
	useLayoutEffect(() => {
		setView(null);
		setShared(null);
		openSheet(null);
		setReceipt(null);
		setRetry(null);
		setHistoryWindow(emptyHistoryWindow());
		setHistoryCursor(undefined);
		setFind("");
		follow.current = true;
	}, [selected?.sessionId, selected?.conversationId, selected?.incarnation, person?.id]);
	useEffect(() => {
		if (!selected || !person || !modelConnection?.serverId) return;
		const binding = resourceContext.current;
		let active = true,
			observed;
		const events = subscribeObservation({
			target: selected,
			scope: { serverId: modelConnection.serverId, personId: person.id },
			reset: () => {
				if (active && resourceContext.current === binding) {
					observed = undefined;
					setView(null);
					setShared(null);
				}
			},
			event: (value) => {
				if (!active || resourceContext.current !== binding) return;
				try {
					if (value.kind === "invalidated" || value.kind === "resnapshot") {
						observed = undefined;
						setView(null);
						setShared(null);
						return;
					}
					if (value.kind === "collaboration") {
						if (
							value.snapshot.conversationId !== selected.conversationId ||
							(value.snapshot.sessionId !== undefined && value.snapshot.sessionId !== selected.sessionId)
						)
							throw new Error("Foreign collaboration");
						setShared(value.snapshot);
					} else {
						observed = applyPocketObservation(observed, value, {
							serverId: modelConnection.serverId,
							target: selected,
						});
						bodyCache.activity();
						setView(observed.snapshot);
					}
				} catch {
					events.close();
					observed = undefined;
					setView(null);
					setShared(null);
					bodyCache.clear();
					notify("Observation changed. Select the conversation again for a fresh read.");
				}
			},
			error: (kind) => {
				if (!active || resourceContext.current !== binding) return;
				observed = undefined;
				setView(null);
				setShared(null);
				bodyCache.clear();
				if (kind === "scope-changed") invalidate();
				void refresh().catch(error);
			},
		});
		return () => {
			active = false;
			events.close();
		};
	}, [
		selected?.sessionId,
		selected?.conversationId,
		selected?.incarnation,
		person?.id,
		modelConnection?.serverId,
	]);
	useEffect(() => {
		if (scroll.current && follow.current) scroll.current.scrollTop = scroll.current.scrollHeight;
	}, [view]);
	useEffect(() => {
		const activity = () => bodyCache.activity();
		const visibility = () => {
			if (document.visibilityState !== "visible") bodyCache.activity();
		};
		window.addEventListener("pointerdown", activity, { passive: true });
		window.addEventListener("keydown", activity);
		document.addEventListener("visibilitychange", visibility);
		const idle = setInterval(() => void bodyCache.pumpIdle(), 250);
		return () => {
			clearInterval(idle);
			window.removeEventListener("pointerdown", activity);
			window.removeEventListener("keydown", activity);
			document.removeEventListener("visibilitychange", visibility);
			bodyCache.clear();
		};
	}, []);
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
				.request({ op: "wait", id: result.receipt.id, sessionId: result.receipt.target.sessionId })
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
		const text = draft;
		await run(async () => {
			if (text.trimStart().startsWith("/")) {
				const accepted = await extensions.slash(text);
				if (accepted !== null) {
					if (accepted) setDraft("");
					return;
				}
			}
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
	function beginCreation(kind, sessionId) {
		dictation.stop();
		extensions.closeSettings();
		openSheet(null);
		setDrawer(false);
		void creation.open(kind, sessionId);
	}
	async function creationCompleted(ref, navigate) {
		await refresh();
		if (!mounted.current || !navigate) return;
		extensions.leave();
		select(ref);
		setDrawer(false);
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
				op: "preview",
				target: selected,
				page: { limit: 64, beforeEntryId: cursor, maxBytes: 256 * 1024 },
			});
			if (!mounted.current || resourceContext.current !== binding) return;
			follow.current = false;
			setHistoryWindow((previous) => {
				const next = fitHistoryWindow([...result.snapshot.entries, ...previous.entries], {
					maxBytes: HISTORY_WINDOW_BYTES,
					anchorId: result.snapshot.entries.at(-1)?.id,
				});
				return {
					...next,
					unloadedOlder: next.unloadedOlder || previous.unloadedOlder,
					unloadedNewer: next.unloadedNewer || previous.unloadedNewer,
				};
			});
			setHistoryCursor(result.snapshot.entriesTruncated ? result.snapshot.olderBeforeId : null);
		});
	}
	function latestHistory() {
		follow.current = true;
		setHistoryWindow(emptyHistoryWindow());
		setHistoryCursor(undefined);
		setFind("");
		composer.current?.focus();
	}
	function useDraft(text) {
		if (text.length > 8192) {
			notify("This input exceeds the current draft limit; it was not truncated or sent.");
			return;
		}
		setDraft(text);
		notify("Copied to draft.");
		composer.current?.focus();
	}
	const allEntries = [
		...new Map([...historyEntries, ...(view?.entries ?? [])].map((entry) => [entry.id, entry])).values(),
	];
	// One call can arrive as a `toolCall` part (id), a `toolResult` message (toolCallId) and a
	// live tool entry (callId). Index all three before rendering so each call resolves to exactly
	// one card, and so a result whose declaration was truncated is still shown rather than lost.
	const toolResults = new Map(),
		declaredCalls = new Set(),
		matchingCalls = new Set();
	const literal = find.toLocaleLowerCase();
	const matchesEntry = (entry) =>
		!find || JSON.stringify([entry.messages, entry.display?.text]).toLocaleLowerCase().includes(literal);
	for (const entry of allEntries) {
		const source = entrySource(entry),
			matched = find && matchesEntry(entry);
		for (const message of entry.messages) {
			if (message.role === "toolResult" && message.toolCallId) {
				const key = callKey(source, message.toolCallId);
				toolResults.set(key, message);
				if (matched) matchingCalls.add(key);
			}
			if (Array.isArray(message.content))
				for (const part of message.content)
					if (part && part.type === "toolCall" && part.id) {
						const key = callKey(source, part.id);
						declaredCalls.add(key);
						if (matched) matchingCalls.add(key);
					}
		}
	}
	const liveTools = new Map(
		(view?.live.tools ?? []).map((tool) => [callKey(view.ref.conversationId, tool.callId), tool]),
	);
	const visibleEntries = allEntries.filter(
		(entry) =>
			matchesEntry(entry) ||
			entry.messages.some(
				(message) =>
					Array.isArray(message.content) &&
					message.content.some(
						(part) =>
							part && part.type === "toolCall" && matchingCalls.has(callKey(entrySource(entry), part.id)),
					),
			),
	);
	const transcriptRows = visibleEntries
		.map((entry) => ({
			entry,
			messages: entry.messages.filter(
				(message) =>
					message.role !== "toolResult" ||
					!declaredCalls.has(callKey(entrySource(entry), message.toolCallId)),
			),
			source: entrySource(entry),
		}))
		.filter((row) => row.entry.display || row.messages.length);
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
				!creation.visible &&
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
		...(person.role === "admin" && models
			? [
					{
						id: "models",
						title: "Models & Providers",
						category: "Workspace",
						icon: "settings",
						open: () => settingsRoute("models"),
					},
				]
			: []),
		...(sessionDirectory?.canCreate
			? [
					{
						id: "sessions",
						title: "Sessions",
						category: "Workspace",
						icon: "folder",
						open: () => settingsRoute("sessions"),
					},
				]
			: []),
		...(person.role === "admin"
			? [
					{
						id: "budget",
						title: "Session Budget",
						category: "Workspace",
						icon: "settings",
						open: () => settingsRoute("budget"),
					},
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
	return html`<${SettingsNavigation.Provider} value=${settingsPages}><${ReaderContext.Provider} value=${{ cache: bodyCache, target: selected, disclosures }}><${Frontend}
		person=${person} refs=${refs} titles=${titles} states=${states} selected=${selected} view=${view} extensions=${extensions}
		drawer=${drawer} collapsed=${collapsed} drawerToggle=${drawerToggle} dismissDrawer=${dismissDrawer}
		sessions=${sessionDirectory?.sessions ?? []} canCreate=${sessionDirectory?.canCreate ?? false}
		workspaceSessionId=${workspaceSessionId} resourceIds=${resourceIds} client=${client} error=${error} stopInput=${dictation.stop}
		newSession=${() => beginCreation("session")} newConversation=${(sessionId) => beginCreation("conversation", sessionId)}
		choose=${(ref) => {
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
		configuration=${configuration}
		transcript=${html`<div
			class="conversation-scroll"
			ref=${scroll}
			onScroll=${(event) => {
				const node = event.currentTarget;
				follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
			}}
		>
			<div class="message-list">
				${historyWindow.entries.length > 0 &&
				html`<div class="history-window-status" data-history-cache-bytes=${historyWindow.retainedBytes}>
					<span
						>${historyBytesLabel.format(historyWindow.retainedBytes / 1024 / 1024)} MiB of history previews
						retained</span
					>
					${(historyWindow.unloadedOlder || historyWindow.unloadedNewer) &&
					html`<p data-history-unloaded role="status">
						Previously visited previews were unloaded from this window. The original archive is retained.
					</p>`}
					<button class="pill-btn" data-action="history-latest" disabled=${working} onClick=${latestHistory}>
						Back to latest history
					</button>
				</div>`}
				${olderCursor &&
				html`<button
					class="pill-btn"
					data-action="show-earlier"
					data-history-before=${olderCursor}
					disabled=${working}
					onClick=${() => void earlier()}
				>
					Show earlier history
				</button>`}
				${!view
					? html`<p role="status">Connecting…</p>`
					: html`<${VirtualTranscript}
							rows=${transcriptRows}
							scroll=${scroll}
							follow=${follow}
							rowKey=${(row) => transcriptKey(row.messages, row.source, row.entry?.id)}
							renderRow=${({ entry, messages, source, isLive }) => {
								return html`<section
									key=${transcriptKey(messages, source, entry?.id)}
									data-entry=${entry?.id}
								>
									${entry?.display
										? html`<aside class="tool-card">
												<div class="tool-card-head">
													${entry.display.kind === "chat" ? "People Chat" : "Card"}
												</div>
												<p>${entry.display.text}</p>
												${entry.display.contentReference &&
												!entry.display.contentReference.previewComplete &&
												html`<${ContentDisclosure}
													cache=${bodyCache}
													disclosures=${disclosures}
													target=${selected}
													reference=${entry.display.contentReference}
													text=${entry.display.text}
													label="Complete original card"
												/>`}
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
							}}
						/>`}
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
										result = await client.request({
											op: "withdraw",
											id: original.id,
											sessionId: original.target.sessionId,
										});
									setReceipt((current) => (current?.id === original.id ? result.receipt : current));
								})}
						>
							Withdraw original input
						</button>`}
				</div>`
			}
			${retry && html`<button class="pill-btn" onClick=${() => void run(() => submit(retry))}>Retry original request</button>`}
		</${NativeComposer}>`}
		recovery=${creation.recovery}
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
							(showArchived || !states[resourceKey(ref)]?.archived) &&
							title(ref).toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()),
					)
					.map(
						(ref) =>
							html`<button
								class="palette-row"
								data-search-conversation=${ref.conversationId}
								data-session=${ref.sessionId}
								onClick=${() => {
									extensions.leave();
									select(ref);
									openSheet(null);
								}}
							>
								<${Glyph} name="message" /><span
									>${title(ref)}${states[resourceKey(ref)]?.archived ? " · Archived" : ""}</span
								>
							</button>`,
					)}
				<div class="palette-caption">Actions</div>
				<button class="palette-row" onClick=${() => {
					openSheet(null);
					beginCreation("session");
				}}><${Glyph} name="plus" /><span>New Session</span></button>
				<button class="palette-row" data-action="commands" onClick=${() => {
					openSheet(null);
					extensions.openCommands();
				}}><${Glyph} name="commands" /><span>Commands & Extensions</span></button>
				<button class="palette-row" onClick=${() => openSheet("appearance")}><${Glyph} name="system" /><span>Appearance…</span></button>
				<label class="palette-row"><input type="checkbox" data-action="show-archived" checked=${showArchived} onChange=${(event) => setShowArchived(event.currentTarget.checked)} />Show Archived Conversations</label>
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
				state=${states[resourceKey(selected)] ?? { version: 0, archived: false }}
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
		${sheet === "models" && models && person.role === "admin" && html`<${ProductModelSettings} control=${productModels} close=${() => openSheet(null)} />`}
		${sheet === "sessions" && sessionDirectory?.canCreate && html`<${SessionSettings} control=${sessionRecovery} sessions=${sessionDirectory.sessions} close=${() => openSheet(null)} />`}
		${sheet === "budget" && person.role === "admin" && html`<${BudgetSettings} control=${budget} sessions=${sessionDirectory?.sessions ?? []} workspaceSessionId=${workspaceSessionId} defaultSessionId=${selected?.sessionId ?? workspaceSessionId} close=${() => openSheet(null)} />`}
		${
			(sheet === "model" || sheet === "directory") &&
			selected &&
			configuration &&
			html`<${sheet === "model" ? ModelPicker : DirectoryPicker}
				key=${person.id + ":" + selected.key + ":" + selected.incarnation}
				target=${selected}
				person=${person}
				value=${configuration}
				models=${models}
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
			html`<${SettingsPage} title="People & Invitations" label="People & Invitations" category="Workspace" icon="user" closeLabel="Close people" close=${() => openSheet(null)}>
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
					)}<${InvitationRole} value=${inviteRole} change=${setInviteRole} />
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
		${creation.dialog}
	</${Frontend}></${ReaderContext.Provider}></${SettingsNavigation.Provider}>`;
}
const root = document.getElementById("app");
root.replaceChildren();
render(html`<${App} />`, root);
