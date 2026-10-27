// Adapts the pinned pi-pocket Memory sheet's groups, attribution and approval flow to public extension slots.
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import { Button, Notice } from "@pakka/webui/components";
import { memoryCall } from "./client.js";
const html = htm.bind(h);
function savedRequest(key) {
	try {
		return sessionStorage.getItem(key) || null;
	} catch {
		return null;
	}
}

function Lesson({ lesson, data, busy, change, context, edits, setEdits }) {
	// Polling, status notices and approval regrouping may remount a row; drafts belong to this panel instance.
	const state = edits[lesson.id] ?? {},
		draft = state.draft ?? null,
		conflict = state.conflict ?? false,
		forgetting = state.forgetting ?? false;
	const update = (key, value) =>
		setEdits((previous) => ({ ...previous, [lesson.id]: { ...previous[lesson.id], [key]: value } }));
	const setDraft = (value) => update("draft", value),
		setConflict = (value) => update("conflict", value),
		setForgetting = (value) => update("forgetting", value);
	const writable = data.canWrite && !busy;
	const apply = async (action, text) => {
		const result = await change("change", {
			id: lesson.id,
			expectedVersion: draft?.version ?? lesson.version,
			action,
			...(text === undefined ? {} : { text }),
		});
		if (context.signal.aborted) return;
		if (result?.state === "done") {
			setDraft(null);
			setConflict(false);
			setForgetting(false);
		} else if (result?.state === "conflict") setConflict(true);
	};
	return html`<article class="memory-row" data-memory-lesson=${lesson.id}>
		<header>
			<span class="memory-meta"
				>${`${lesson.scope === "global" ? "All conversations" : "This project"} · ${lesson.byAgent ? "Agent" : lesson.mine ? "You" : lesson.authorName} · Version ${lesson.version}`}</span
			>
			${(lesson.pending || lesson.proposal) &&
			html`<span class="memory-state" data-memory-pending>Awaiting approval</span>`}
		</header>
		<p>${lesson.text}</p>
		${lesson.proposal &&
		html`<blockquote>
			<small
				>${`${lesson.proposal.byAgent ? "Agent" : lesson.proposal.mine ? "You" : lesson.proposal.authorName} ${lesson.proposal.text === null ? "proposes forgetting this lesson." : "proposes:"}`}</small
			>${lesson.proposal.text !== null && html`<p>${lesson.proposal.text}</p>`}
		</blockquote>`}
		${draft &&
		html`<label
				>Lesson<textarea
					data-memory-draft
					maxlength=${data.limits.text}
					value=${draft.text}
					disabled=${busy}
					onInput=${(event) => setDraft({ ...draft, text: event.currentTarget.value })}
				/>
			</label>
			${conflict &&
			html`<div data-memory-conflict>
				<${Notice}
					>This lesson changed elsewhere. Your unsaved draft is kept. The saved version above has not been
					overwritten.<//
				>
			</div>`}
			<div class="memory-actions">
				<${Button}
					disabled=${busy}
					onClick=${() => {
						setDraft(null);
						setConflict(false);
					}}
					>Cancel edit<//
				><${Button}
					data-memory-save
					disabled=${!writable || !draft.text.trim()}
					onClick=${() => apply("edit", draft.text)}
					>Save<//
				>
			</div>`}
		${!draft &&
		data.canWrite &&
		html`<div class="memory-actions">
			${data.owner &&
			(lesson.pending || lesson.proposal) &&
			html`<${Button} data-memory-approve disabled=${!writable} onClick=${() => apply("approve")}
				>Approve<//
			>`}
			${((data.owner && (lesson.pending || lesson.proposal)) ||
				(lesson.pending && lesson.mine) ||
				lesson.proposal?.mine) &&
			html`<${Button} data-memory-discard disabled=${!writable} onClick=${() => apply("discard")}
				>${data.owner ? "Discard" : "Withdraw"}<//
			>`}
			${(!lesson.pending || lesson.mine || data.owner) &&
			html`<${Button}
				data-memory-edit
				disabled=${!writable}
				onClick=${() => {
					setDraft({ text: lesson.text, version: lesson.version });
					setConflict(false);
				}}
				>Edit<//
			>`}
			${!lesson.pending &&
			html`<${Button}
				data-memory-forget
				disabled=${!writable}
				onClick=${() => {
					if (forgetting) void apply("remove");
					else setForgetting(true);
				}}
				>${forgetting ? "Confirm forget" : "Forget"}<//
			>`}
		</div>`}
	</article>`;
}
function Group({ title, lessons, ...props }) {
	return html`<section>
		<h3>${title}</h3>
		${lessons.length
			? lessons.map((lesson) => html`<${Lesson} key=${lesson.id} lesson=${lesson} ...${props} />`)
			: html`<p class="memory-meta">Nothing yet.</p>`}
	</section>`;
}

export function Memory({ context }) {
	const storageKey = "pakka.memory.pending:" + context.person.id + ":" + JSON.stringify(context.target);
	const [data, setData] = useState(null),
		[text, setText] = useState(""),
		[scope, setScope] = useState("project"),
		[edits, setEdits] = useState({}),
		[busy, setBusy] = useState(false),
		[problem, setProblem] = useState(""),
		[pending, setPending] = useState(() => savedRequest(storageKey));
	const remember = (id) => {
		try {
			if (id) sessionStorage.setItem(storageKey, id);
			else sessionStorage.removeItem(storageKey);
		} catch {}
		setPending(id);
	};
	const refresh = async () => {
		const value = await memoryCall(context, "read");
		if (!context.signal.aborted) setData(value);
	};
	useEffect(
		() =>
			context.subscribe(
				"read",
				{},
				(value) => {
					if (!context.signal.aborted) setData(value);
				},
				{ intervalMs: 400 },
			),
		[context],
	);
	const change = async (action, input) => {
		if (busy || pending || context.signal.aborted) return;
		const requestId = crypto.randomUUID();
		remember(requestId);
		setBusy(true);
		setProblem("");
		try {
			const value = await memoryCall(context, action, input, { requestId });
			if (context.signal.aborted) return;
			remember(null);
			if (value.state === "conflict")
				setProblem("The saved lesson changed. Your draft has not been discarded.");
			if (action === "add" && value.state === "done") setText("");
			await refresh();
			return value;
		} catch (error) {
			if (!context.signal.aborted) setProblem(error.message || "Memory result unconfirmed");
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	const reconcile = async () => {
		if (!pending || busy || context.signal.aborted) return;
		setBusy(true);
		setProblem("");
		try {
			const operation = await context.operationByRequest(pending);
			if (context.signal.aborted) return;
			// The inner persistent mutation can be known even when the outer handler lost its response.
			const value =
				operation.state === "done"
					? operation.value
					: await memoryCall(context, "operation", { requestId: operation.id });
			if (context.signal.aborted) return;
			if (!value || !["done", "conflict"].includes(value.state))
				throw Error("The original memory mutation is still unconfirmed. It was not replayed.");
			remember(null);
			if (value.state === "conflict")
				setProblem("The original edit conflicted. Its draft has not been overwritten.");
			await refresh();
		} catch (error) {
			if (!context.signal.aborted) setProblem(error.message || "Original memory operation unavailable");
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	if (!data)
		return html`<section class="workspace-memory" data-workspace-memory>
			<link rel="stylesheet" href=${new URL("./memory.css", import.meta.url).href} />
			<h2>Memory</h2>
			<p>Loading lessons…</p>
		</section>`;
	const waiting = data.lessons.filter((lesson) => lesson.pending || lesson.proposal),
		approved = data.lessons.filter((lesson) => !waiting.includes(lesson)),
		disabled = busy || !!pending;
	const lessonProps = { data, busy: disabled, change, context, edits, setEdits };
	return html`<section class="workspace-memory" data-workspace-memory>
		<link rel="stylesheet" href=${new URL("./memory.css", import.meta.url).href} />
		<header>
			<h2>Memory</h2>
			${data.owner &&
			html`<${Button}
				data-memory-enabled
				aria-pressed=${String(data.enabled)}
				disabled=${disabled}
				onClick=${() => change("activation", { enabled: !data.enabled })}
				>${data.enabled ? "Automatic memory: allowed" : "Automatic memory: paused"}<//
			>`}
		</header>
		${!data.enabled &&
		html`<${Notice}>Automatic memory is paused. Stored lessons and proposals are preserved.<//>`}
		${!data.canWrite &&
		html`<p class="memory-readonly">Read-only access. Only approved lessons are shown.</p>`}
		${problem && html`<${Notice}>${problem}<//>`}
		${pending &&
		html`<${Notice}
			>A memory operation is awaiting confirmation. It will not be repeated.<${Button}
				data-memory-reconcile
				disabled=${busy}
				onClick=${reconcile}
				>Check original operation<//
			><//
		>`}
		${data.canWrite &&
		html`<div class="memory-compose">
			<label
				>New lesson<textarea
					data-memory-text
					placeholder="e.g. Run the integration tests with npm test."
					maxlength=${data.limits.text}
					value=${text}
					disabled=${disabled}
					onInput=${(event) => setText(event.currentTarget.value)}
				/>
			</label>
			<div class="memory-actions">
				<label
					>For
					<select
						data-memory-scope
						value=${data.project ? scope : "global"}
						disabled=${disabled || !data.project}
						onChange=${(event) => setScope(event.currentTarget.value)}
					>
						${data.project && html`<option value="project">This project</option>`}
						<option value="global">All conversations</option>
					</select></label
				>
				<${Button}
					data-memory-add
					disabled=${disabled || !text.trim()}
					onClick=${() => change("add", { text, scope: data.project ? scope : "global" })}
					>Remember<//
				>
			</div>
		</div>`}
		${waiting.length > 0 &&
		html`<${Group}
			title=${data.owner ? "To approve · " + waiting.length : "Awaiting approval · " + waiting.length}
			lessons=${waiting}
			...${lessonProps}
		/>`}
		${data.project &&
		html`<${Group}
			title=${"This project: " + data.project.name}
			lessons=${approved.filter((lesson) => lesson.scope === "project")}
			...${lessonProps}
		/>`}
		<${Group}
			title="All conversations"
			lessons=${approved.filter((lesson) => lesson.scope === "global")}
			...${lessonProps}
		/>
	</section>`;
}
