import { h } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);
const surfaces = {
	dialog: { layer: "pocket-scrim", panel: "pocket-sheet" },
	palette: { layer: "palette-layer", panel: "palette" },
	settings: { layer: "settings-layer", panel: "settings-view" },
};
// A replacement dialog mounts in the same commit as the old one's cleanup.
// Transfer its history slot and focus target rather than asynchronously going
// back through the newly mounted dialog. Unrelated/nested dialogs still push.
let pendingHandoff = null;

/** Shell-owned focus/back lifecycle. Closing a view never cancels an admitted operation. */
export function Sheet({ label, close, children, anchor, initialFocus, variant = "dialog" }) {
	const surface = surfaces[variant] ?? surfaces.dialog;
	const [position, setPosition] = useState(undefined);
	useLayoutEffect(() => {
		if (!anchor) return;
		const place = () => {
			const rect = anchor.getBoundingClientRect(),
				width = Math.min(360, innerWidth - 24),
				height = Math.min(480, innerHeight - 24);
			const above = rect.top - 20;
			const bottom = above >= 200 ? innerHeight - rect.top + 8 : 12;
			setPosition({
				position: "fixed",
				width: width + "px",
				left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + "px",
				bottom: bottom + "px",
				maxHeight: Math.min(height, innerHeight - bottom - 12) + "px",
				margin: 0,
			});
		};
		place();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
	}, [anchor]);
	const panel = useRef(null),
		onClose = useRef(close);
	onClose.current = close;
	useLayoutEffect(() => {
		const handoff = pendingHandoff;
		const replacing = handoff && history.state?.pakkaSheet === handoff.id;
		const previous = replacing ? handoff.previous : document.activeElement,
			id = crypto.randomUUID();
		if (replacing) {
			pendingHandoff = null;
			history.replaceState({ pakkaSheet: id }, "", location.href);
		} else {
			history.pushState({ pakkaSheet: id }, "", location.href);
		}
		const back = () => {
			if (history.state?.pakkaSheet !== id) onClose.current();
		};
		window.addEventListener("popstate", back);
		(
			panel.current?.querySelector(
				initialFocus ?? "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
			) ?? panel.current
		)?.focus();
		return () => {
			window.removeEventListener("popstate", back);
			if (history.state?.pakkaSheet === id) {
				const release = { id, previous };
				pendingHandoff = release;
				queueMicrotask(() => {
					if (pendingHandoff !== release) return;
					pendingHandoff = null;
					if (history.state?.pakkaSheet === id) history.back();
				});
			}
			if (previous?.isConnected) previous.focus();
		};
	}, []);
	function keys(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
		if (variant === "palette" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
			const rows = [...panel.current.querySelectorAll("button.palette-row:not(:disabled)")].filter(
				(node) => node.getClientRects().length,
			);
			if (rows.length) {
				event.preventDefault();
				const index = rows.indexOf(document.activeElement),
					step = event.key === "ArrowDown" ? 1 : -1;
				rows[(index + step + rows.length) % rows.length].focus();
			}
		}
		if (event.key !== "Tab") return;
		const nodes = [
			...panel.current.querySelectorAll(
				'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
			),
		].filter((node) => node.tabIndex >= 0 && !node.hidden && node.getClientRects().length);
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
		class=${surface.layer}
		onClick=${(event) => {
			if (event.target === event.currentTarget) close();
		}}
	>
		<section
			ref=${panel}
			class=${surface.panel}
			style=${position}
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
