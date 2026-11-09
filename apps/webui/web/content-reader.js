import { h } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { virtualRange } from "./virtual-window.js";
import { scanOriginal } from "./original-search.js";

const html = htm.bind(h);
const sizeLabel = (bytes) =>
	bytes < 1024
		? bytes + " B"
		: bytes < 1024 * 1024
			? (bytes / 1024).toFixed(1) + " KiB"
			: (bytes / 1024 / 1024).toFixed(1) + " MiB";
export const originalDownload = (target, reference) =>
	"/pocket/content/download?" +
	new URLSearchParams({ target: JSON.stringify(target), reference: JSON.stringify(reference) });

/** One loaded 64 KiB segment at a time; even a long single line has a visible column window. */
export function TextViewport({ text = "", marker }) {
	const ref = useRef(null);
	const [position, setPosition] = useState({ top: 0, left: 0 });
	const lines = useMemo(() => String(text).split("\n"), [text]);
	const range = virtualRange(
		lines.map(() => 20),
		position.top,
		280,
		4,
	);
	const column = Math.max(0, Math.floor(position.left / 8) - 8);
	const width = Math.max(1, ...lines.map((line) => line.length)) * 8;
	return html`<div
		class="content-text-viewport"
		ref=${ref}
		data-text-window
		data-tool-output=${marker === "output" ? "true" : undefined}
		data-tool-arguments=${marker === "arguments" ? "true" : undefined}
		onScroll=${(event) =>
			setPosition({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
	>
		<div class="content-text-canvas" style=${{ height: lines.length * 20 + "px", width: width + "px" }}>
			${lines
				.slice(range.start, range.end)
				.map(
					(line, index) =>
						html`<div
							class="content-text-line"
							data-content-line
							style=${{ top: (range.start + index) * 20 + "px", left: column * 8 + "px" }}
						>
							${line.slice(column, column + 2048) || " "}
						</div>`,
				)}
		</div>
	</div>`;
}

/** Mounted only for an expanded body. Content progress, retained bytes and DOM residence remain independent. */
export function TextBody({ cache, target, reference, inline = "", label = "Original content", marker }) {
	const [, update] = useState(0);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState(""),
		[offset, setOffset] = useState(0);
	const [needle, setNeedle] = useState(""),
		[match, setMatch] = useState(""),
		[excerpt, setExcerpt] = useState("");
	const node = useRef(null),
		current = useRef(null),
		mounted = useRef(true),
		scanCursor = useRef({ query: "", offset: 0, index: 0 });
	// Unreferenced live/display content is a preview, not evidence of a complete archive.
	const previewOnly = !reference;
	const completeInline = previewOnly || (reference.encoding === "text" && reference.previewComplete);
	const state = reference && !completeInline ? cache.state(target, reference) : null;
	const part = state?.parts.find((part) => part.offset === offset) ?? state?.parts[0];
	const text = completeInline ? inline : (part?.text ?? "");
	// Establish the first read before controls become usable; a delayed mount effect must not abort user work.
	useLayoutEffect(() => {
		mounted.current = true;
		const remove = cache.subscribe(() => {
			if (mounted.current) update((value) => value + 1);
		});
		let eligible;
		const observer = new IntersectionObserver(
			(entries) => {
				eligible?.();
				eligible = undefined;
				if (!completeInline && reference && entries.some((entry) => entry.isIntersecting))
					eligible = cache.eligible(target, reference);
			},
			{ rootMargin: "200px" },
		);
		if (node.current) observer.observe(node.current);
		if (!completeInline && reference && !state?.parts.length) void load(false);
		return () => {
			mounted.current = false;
			current.current?.abort();
			eligible?.();
			observer.disconnect();
			remove();
		};
	}, [reference?.id, target.sessionId, target.conversationId, target.incarnation]);
	async function load(all, at) {
		current.current?.abort();
		const controller = (current.current = new AbortController());
		setBusy(true);
		setError("");
		cache.activity();
		try {
			if (at !== undefined) {
				await cache.loadRange(target, reference, at, { signal: controller.signal });
				if (mounted.current) setOffset(at);
			} else {
				do {
					const before = cache.state(target, reference).progressOffset;
					const after = await cache.loadMore(target, reference, { signal: controller.signal });
					if (!all || after.complete || after.progressOffset === before) break;
					await new Promise((resolve) => setTimeout(resolve, 125));
				} while (!controller.signal.aborted);
			}
		} catch (failure) {
			if (!controller.signal.aborted && mounted.current)
				setError(failure.message || "Original content is unavailable. Refresh its preview.");
		} finally {
			if (mounted.current) setBusy(false);
		}
	}
	async function findOriginal() {
		current.current?.abort();
		const controller = (current.current = new AbortController());
		setBusy(true);
		setError("");
		setMatch("");
		cache.activity();
		try {
			if (completeInline) {
				const found = inline.includes(needle);
				if (previewOnly)
					setMatch(
						found
							? "Found in this preview."
							: "Not found in this preview; the complete original was not searched.",
					);
				else setMatch(found ? "Found in this complete original." : "Not found in this complete original.");
				return;
			}
			const continuing =
				scanCursor.current.query === needle && scanCursor.current.offset < reference.byteLength;
			const start = continuing ? scanCursor.current.offset : 0;
			const result = await scanOriginal({
				query: needle,
				start,
				startIndex: continuing ? scanCursor.current.index : 0,
				coordinates: "archive",
				byteLength: reference.byteLength,
				signal: controller.signal,
				read: async (at) => {
					const read = await cache.loadRange(target, reference, at, { signal: controller.signal });
					const part = read.parts.find((item) => item.offset === at);
					if (!part) throw new Error("Search range was evicted. Retry this original range.");
					return part;
				},
				yield: () => new Promise((resolve) => setTimeout(resolve, 16)),
			});
			if (!mounted.current || controller.signal.aborted) return;
			scanCursor.current = { query: needle, offset: result.nextOffset, index: result.nextIndex };
			if (result.rangeOffset !== undefined) {
				await cache.loadRange(target, reference, result.rangeOffset, { signal: controller.signal });
				if (mounted.current && !controller.signal.aborted) {
					setOffset(result.rangeOffset);
					setExcerpt(result.excerpt ?? "");
					setMatch(`Found in original archive range ${result.rangeOffset}–${result.rangeEnd}.`);
				}
			} else {
				setExcerpt("");
				setMatch("Not found in the remaining original; next search starts at the beginning.");
			}
		} catch (failure) {
			if (mounted.current && !controller.signal.aborted)
				setError(failure.message || "Original search is unconfirmed.");
		} finally {
			if (mounted.current) setBusy(false);
		}
	}
	async function copyBlock() {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			if (mounted.current)
				setError(
					previewOnly
						? "Clipboard unavailable; select the preview text instead."
						: "Clipboard unavailable; save the original content instead.",
				);
		}
	}
	const previous = state?.parts.filter((item) => item.offset < (part?.offset ?? 0)).at(-1);
	const next = state?.parts.find((item) => item.offset === part?.nextOffset);
	return html`<section
		class="content-reader"
		data-content-reader
		data-content-reference=${reference?.id}
		data-content-scope=${previewOnly ? "preview" : "original"}
		ref=${node}
	>
		<div class="content-reader-head">
			<strong>${label}</strong>${reference
				? html`<span>${sizeLabel(reference.byteLength)}</span>`
				: html`<span>Preview only</span>`}
		</div>
		<div class="content-original-search">
			<input
				data-original-query
				aria-label=${previewOnly ? "Find literal text in preview" : "Find literal text in original"}
				placeholder=${previewOnly ? "Find in preview (case-sensitive)" : "Find in original (case-sensitive)"}
				maxlength="512"
				value=${needle}
				onInput=${(event) => {
					setNeedle(event.currentTarget.value);
					setMatch("");
					setExcerpt("");
				}}
				onKeyDown=${(event) => {
					if (event.key === "Enter" && needle && !busy) {
						event.preventDefault();
						void findOriginal();
					}
				}}
			/><button
				class="pill-btn"
				data-original-find
				disabled=${busy || !needle}
				onClick=${() => void findOriginal()}
			>
				Find next
			</button>
		</div>
		${match && html`<p class="content-hint" data-original-match role="status">${match}</p>`}${excerpt &&
		html`<${TextViewport} text=${excerpt} />`}
		${text !== ""
			? html`<${TextViewport} key=${part?.offset ?? "inline"} text=${text} marker=${marker} />`
			: html`<p class="content-hint" role="status">
					${busy ? "Reading original range…" : "Expand or load the original content."}
				</p>`}
		${state &&
		html`<div
			class="content-progress"
			role="status"
			data-content-complete=${state.complete ? "true" : "false"}
		>
			${state.complete ? "Full original read" : `${sizeLabel(state.progressOffset)} read`} ·
			${sizeLabel(state.retainedBytes)}
			retained${part ? ` · original range ${part.offset}–${part.nextOffset}` : ""}${state.complete &&
			!state.retainedComplete
				? " · other ranges unloaded"
				: ""}
		</div>`}
		<div class="content-actions">
			<button class="pill-btn" data-content-copy disabled=${!text} onClick=${() => void copyBlock()}>
				${previewOnly ? "Copy preview" : completeInline ? "Copy original" : "Copy this block"}
			</button>
			${state &&
			html`<button class="pill-btn" disabled=${busy || !previous} onClick=${() => setOffset(previous.offset)}>
					Previous retained block</button
				><button class="pill-btn" disabled=${busy || !next} onClick=${() => setOffset(next.offset)}>
					Next retained block
				</button>`}
			${state &&
			!state.complete &&
			html`<button class="pill-btn" data-content-more disabled=${busy} onClick=${() => void load(false)}>
					Load more</button
				><button class="pill-btn" data-content-all disabled=${busy} onClick=${() => void load(true)}>
					Read full original
				</button>`}
			${state &&
			part?.offset > 0 &&
			html`<button class="pill-btn" disabled=${busy} onClick=${() => void load(false, 0)}>
				Read from beginning
			</button>`}
			${busy &&
			html`<button class="pill-btn" onClick=${() => current.current?.abort()}>Stop reading</button>`}
			${reference &&
			html`<a class="pill-btn" data-content-download href=${originalDownload(target, reference)} download
				>Save original</a
			>`}
		</div>
		${error && html`<p class="content-error" role="alert">${error}</p>`}
	</section>`;
}

let mediaBytes = 0;
const MEDIA_LIMIT = 12 * 1024 * 1024;
/** Explicit media expansion only. Blob bytes are budgeted and released on collapse/unmount. */
export function ImageBody({ target, reference, mime, data, cache }) {
	const [url, setUrl] = useState(""),
		[error, setError] = useState("");
	useEffect(() => {
		const controller = new AbortController();
		let active = true,
			ownedUrl = "",
			reserved = 0;
		const scope = JSON.stringify(cache.options.scope());
		void (async () => {
			try {
				if (!reference) {
					if (active) setUrl(`data:${mime};base64,${data}`);
					return;
				}
				const expected = Math.ceil((reference.byteLength * 3) / 4);
				if (expected > MEDIA_LIMIT || mediaBytes + expected > MEDIA_LIMIT)
					throw new Error("Image exceeds the preview cache budget. Save its original instead.");
				reserved = expected;
				mediaBytes += reserved;
				const response = await fetch(originalDownload(target, reference), {
					signal: controller.signal,
					credentials: "same-origin",
					cache: "no-store",
					redirect: "error",
				});
				if (!response.ok) throw new Error("Original image is unavailable. Refresh its preview.");
				const blob = await response.blob();
				if (!active || scope !== JSON.stringify(cache.options.scope())) return;
				if (blob.size > expected || blob.size > MEDIA_LIMIT) throw new Error("Original image size changed.");
				ownedUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
				setUrl(ownedUrl);
			} catch (failure) {
				if (active && !controller.signal.aborted) setError(failure.message || "Image unavailable");
			}
		})();
		return () => {
			active = false;
			controller.abort();
			if (ownedUrl) URL.revokeObjectURL(ownedUrl);
			mediaBytes -= reserved;
		};
	}, [reference?.id, target.sessionId, target.conversationId, target.incarnation]);
	return html`<div class="content-media" data-media-reader>
		${url
			? html`<img
					class="pocket-image"
					src=${url}
					alt="Original attachment"
					loading="lazy"
					decoding="async"
				/>`
			: html`<p role="status">${error || "Reading original image…"}</p>`}${reference &&
		html`<a class="pill-btn" href=${originalDownload(target, reference)} download>Save original image</a>`}
	</div>`;
}

/** The collapsed disclosure has only summary DOM; neither text layout nor image decoding is hidden behind CSS. */
export function useDisclosure(disclosures, target, identity) {
	const remembered = () => (target && identity && disclosures ? disclosures.get(target, identity) : false);
	const [open, update] = useState(remembered);
	useLayoutEffect(() => update(remembered()), [JSON.stringify([target, identity]), disclosures]);
	const setOpen = (value) => {
		if (target && identity && disclosures) disclosures.set(target, identity, value);
		update(value);
	};
	return [open, setOpen];
}

export function ImageDisclosure({ cache, target, reference, mime, data, disclosures, label = "Attachment" }) {
	const [open, setOpen] = useDisclosure(disclosures, target, reference?.id);
	return html`<details
		class="content-disclosure"
		open=${open}
		data-image-disclosure
		onToggle=${(event) => setOpen(event.currentTarget.open)}
	>
		<summary class="pocket-disclosure">
			<${Icon} name="chevron" />${label}
			(${mime})${reference && html`<span class="content-size">${sizeLabel(reference.byteLength)}</span>`}
		</summary>
		${open &&
		html`<${ImageBody} cache=${cache} target=${target} reference=${reference} mime=${mime} data=${data} />`}
	</details>`;
}

export function ContentDisclosure({
	cache,
	target,
	reference,
	text = "",
	label = "Original content",
	marker,
	disclosures,
}) {
	const [open, setOpen] = useDisclosure(disclosures, target, reference?.id);
	return html`<details
		class="content-disclosure"
		open=${open}
		onToggle=${(event) => setOpen(event.currentTarget.open)}
	>
		<summary class="pocket-disclosure">
			<${Icon} name="chevron" />${label}${reference &&
			html`<span class="content-size">${sizeLabel(reference.byteLength)}</span>`}
		</summary>
		${open &&
		html`<${TextBody}
			cache=${cache}
			target=${target}
			reference=${reference}
			inline=${text}
			label=${label}
			marker=${marker}
		/>`}
	</details>`;
}
