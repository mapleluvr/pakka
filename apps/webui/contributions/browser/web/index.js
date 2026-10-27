import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import { Button, Icon, Notice } from "@pakka/webui/components";
import { browserCall } from "./client.js";
const html = htm.bind(h);

export function Browser({ context }) {
	const pendingKey =
		"pakka.browser.action." +
		JSON.stringify([
			context.extension,
			context.person.id,
			context.target?.sessionId,
			context.target?.conversationId,
			context.target?.key,
			context.target?.incarnation,
			context.target?.profile,
		]);
	const [view, setView] = useState(null),
		[frame, setFrame] = useState(null),
		[url, setUrl] = useState(""),
		[selector, setSelector] = useState(""),
		[text, setText] = useState(""),
		[busy, setBusy] = useState(false),
		[status, setStatus] = useState(""),
		[pending, setPending] = useState(() => sessionStorage.getItem(pendingKey));
	const writable = context.person.role !== "viewer",
		blocked = busy || Boolean(pending);
	const remember = (requestId) => {
		if (requestId) sessionStorage.setItem(pendingKey, requestId);
		else sessionStorage.removeItem(pendingKey);
		setPending(requestId);
	};
	const apply = (value) => {
		if (context.signal.aborted) return;
		setView(value.view);
		setFrame(value.frame ?? null);
	};
	useEffect(() => context.subscribe("view", {}, apply, { intervalMs: 1000 }), [context]);
	const action = async (method, input) => {
		if (blocked || context.signal.aborted) return;
		setBusy(true);
		setStatus("");
		try {
			const requestId = crypto.randomUUID();
			remember(requestId);
			const result = await browserCall(context, method, input, { requestId });
			if (context.signal.aborted) return;
			if (result.state === "done") remember(null);
			setStatus(result.state === "done" ? "Action recorded" : "Outcome unknown. Check the original action.");
			apply(await browserCall(context, "view"));
		} catch (error) {
			if (!context.signal.aborted) {
				if (error.outcome === "denied") remember(null);
				setStatus(error.message);
			}
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	const reconcile = async () => {
		if (busy || !pending || context.signal.aborted) return;
		setBusy(true);
		try {
			const result = await context.operationByRequest(pending);
			if (context.signal.aborted) return;
			if (result?.requestId !== pending) throw new Error("Original action outcome unconfirmed");
			const confirmed = result.state === "done" && result.value?.state === "done";
			if (confirmed) remember(null);
			setStatus(confirmed ? "Original action recorded." : "Outcome remains unknown.");
			apply(await browserCall(context, "view"));
		} catch (error) {
			if (!context.signal.aborted) setStatus(error.message);
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	return html`<section
		data-owned-browser
		style="padding:1rem;max-width:70rem;margin:auto;min-width:0;overflow-wrap:anywhere"
	>
		<h2>Project Browser</h2>
		<p>Server Browser · ${view?.title || "No page open"}</p>
		${writable &&
		html`<form
			style="display:flex;flex-wrap:wrap;gap:.5rem"
			onSubmit=${(e) => {
				e.preventDefault();
				void action("navigate", { url });
			}}
		>
			<input
				style="flex:1;min-width:0"
				name="browser-url"
				aria-label="Approved page URL"
				placeholder="Approved page URL"
				value=${url}
				onInput=${(e) => setUrl(e.currentTarget.value)}
				disabled=${blocked}
			/>
			<${Button} data-browser-go type="submit" disabled=${blocked || !url.trim()}>Go<//>
		</form>`}
		<output role="status">${status}</output>
		${pending &&
		html`<div data-browser-pending>
			<p>An action needs confirmation: <code>${pending}</code></p>
			<${Button} data-browser-reconcile disabled=${busy} onClick=${reconcile}>Check original action<//>
		</div>`}
		${view?.url && html`<p><code>${view.url}</code></p>`}
		${frame
			? html`<img
					data-browser-frame
					alt="Current isolated project page"
					style="display:block;max-width:100%;height:auto;border:1px solid var(--border-color,#555);border-radius:.5rem"
					src=${"data:image/png;base64," + frame.base64}
				/>`
			: html`<${Notice}>Open a host-approved page to inspect it.<//>`}
		${writable &&
		html`<section style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem">
			<input
				name="browser-selector"
				aria-label="Page control selector"
				placeholder="CSS selector"
				style="flex:1;min-width:0"
				value=${selector}
				disabled=${blocked}
				onInput=${(e) => setSelector(e.currentTarget.value)}
			/>
			<${Button}
				data-browser-click
				disabled=${blocked || !selector.trim() || !view?.open}
				onClick=${() => action("click", { selector })}
				>Click control<//
			>
			<input
				name="browser-text"
				aria-label="Text for page field"
				placeholder="Text to enter"
				style="flex:1;min-width:0"
				value=${text}
				disabled=${blocked}
				onInput=${(e) => setText(e.currentTarget.value)}
			/>
			<${Button}
				data-browser-fill
				disabled=${blocked || !selector.trim() || !view?.open}
				onClick=${() => action("fill", { selector, text })}
				>Fill field<//
			>
		</section>`}
		<details open>
			<summary class="pocket-disclosure"><${Icon} name="chevron" />Page text</summary>
			<pre data-browser-text style="white-space:pre-wrap;overflow-wrap:anywhere">${view?.text || ""}</pre>
		</details>
	</section>`;
}
