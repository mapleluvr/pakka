import { h } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);

/** Shell-owned focus/back lifecycle. Closing a view never cancels an admitted operation. */
export function Sheet({ label, close, children }) {
	const panel = useRef(null),
		onClose = useRef(close);
	onClose.current = close;
	useLayoutEffect(() => {
		const previous = document.activeElement,
			id = crypto.randomUUID();
		history.pushState({ pakkaSheet: id }, "", location.href);
		const back = () => {
			if (history.state?.pakkaSheet !== id) onClose.current();
		};
		window.addEventListener("popstate", back);
		(
			panel.current?.querySelector("button:not(:disabled),input:not(:disabled),select:not(:disabled)") ??
			panel.current
		)?.focus();
		return () => {
			window.removeEventListener("popstate", back);
			if (history.state?.pakkaSheet === id) history.back();
			if (previous?.isConnected) previous.focus();
		};
	}, []);
	function keys(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
		if (event.key !== "Tab") return;
		const nodes = [
			...panel.current.querySelectorAll(
				'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
			),
		].filter((node) => !node.hidden && node.getClientRects().length);
		if (!nodes.length) {
			event.preventDefault();
			panel.current.focus();
			return;
		}
		if (event.shiftKey && (document.activeElement === nodes[0] || document.activeElement === panel.current)) {
			event.preventDefault();
			nodes.at(-1).focus();
		} else if (
			!event.shiftKey &&
			(document.activeElement === nodes.at(-1) || document.activeElement === panel.current)
		) {
			event.preventDefault();
			nodes[0].focus();
		}
	}
	return html`<div
		class="pocket-scrim"
		onClick=${(event) => {
			if (event.target === event.currentTarget) close();
		}}
	>
		<section
			ref=${panel}
			class="pocket-sheet"
			role="dialog"
			aria-modal="true"
			aria-label=${label}
			tabindex="-1"
			onKeyDown=${keys}
		>
			${children}
		</section>
	</div>`;
}
