import { h } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { Sheet } from "./sheet.js";

const html = htm.bind(h);
const defaults = { mode: "dark", font: "inter", size: 14 };
const fonts = {
	inter: {
		label: "Inter",
		family: '"Inter", system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
	},
	mono: { label: "Pocket Mono", family: "var(--mono)" },
	system: {
		label: "System sans-serif",
		family: 'system-ui, -apple-system, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
	},
	serif: { label: "Serif", family: 'ui-serif, "Noto Serif CJK SC", "Songti SC", SimSun, serif' },
};
const sizes = [14, 16, 18, 20, 22, 24];
let currentAppearance;

export function readAppearance() {
	if (currentAppearance) return currentAppearance;
	let mode = defaults.mode,
		typography;
	try {
		mode = localStorage.getItem("pakka-appearance") === "light" ? "light" : "dark";
	} catch {
		/* Keep a usable default without browser storage. */
	}
	try {
		typography = JSON.parse(localStorage.getItem("pakka-typography") ?? "null");
	} catch {
		/* Invalid saved values fall back to defaults. */
	}
	return (currentAppearance = {
		mode,
		font: Object.keys(fonts).includes(typography?.font) ? typography.font : defaults.font,
		size: sizes.includes(typography?.size) ? typography.size : defaults.size,
	});
}

export function applyAppearance(preferences) {
	currentAppearance = preferences;
	const root = document.documentElement;
	root.dataset.mode = preferences.mode;
	root
		.querySelector('meta[name="theme-color"]')
		?.setAttribute("content", preferences.mode === "light" ? "#fcfcfc" : "#141414");
	root.style.setProperty("--pocket-font-family", fonts[preferences.font].family);
	root.style.setProperty("--text-size", preferences.size + "px");
}

export function Appearance({ close }) {
	const [preferences, setPreferences] = useState(readAppearance),
		[saved, setSaved] = useState(true);
	function change(patch) {
		const next = { ...preferences, ...patch };
		setPreferences(next);
		applyAppearance(next);
		try {
			localStorage.setItem("pakka-appearance", next.mode);
			localStorage.setItem("pakka-typography", JSON.stringify({ font: next.font, size: next.size }));
			setSaved(true);
		} catch {
			setSaved(false);
		}
	}
	return html`<${Sheet} label="Appearance" close=${close}>
		<header>
			<h2>Appearance</h2>
			<button type="button" class="pocket-icon-button" aria-label="Close appearance" onClick=${close}>
				<${Icon} name="close" />
			</button>
		</header>
		<div class="pocket-sheet-body pocket-appearance">
			<p role="status">
				${
					saved
						? "Changes apply immediately and are saved in this browser."
						: "Changes apply to this tab only; browser storage is unavailable."
				}
			</p>
			<label>Theme
				<select aria-label="Theme" value=${preferences.mode} onChange=${(event) => change({ mode: event.currentTarget.value })}>
					<option value="dark">Dark</option>
					<option value="light">Light</option>
				</select>
			</label>
			<label>Font
				<select aria-label="Font" value=${preferences.font} onChange=${(event) => change({ font: event.currentTarget.value })}>
					${Object.entries(fonts).map(([value, font]) => html`<option key=${value} value=${value}>${font.label}</option>`)}
				</select>
			</label>
			<label>Text size
				<select aria-label="Text size" value=${String(preferences.size)} onChange=${(event) => change({ size: Number(event.currentTarget.value) })}>
					${sizes.map((size) => html`<option key=${size} value=${String(size)}>${size} px</option>`)}
				</select>
			</label>
			<div class="pocket-font-preview">
				<p>Aa 中文预览 · Read comfortably · 0123456789</p>
				<p><code>Code stays monospace.</code></p>
			</div>
			<button type="button" class="button" data-action="reset-appearance" onClick=${() => change(defaults)}>
				Reset to defaults
			</button>
		</div>
	</${Sheet}>`;
}
