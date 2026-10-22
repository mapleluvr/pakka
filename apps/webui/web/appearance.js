import { h } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import { Glyph } from "./frontend.js";
import { Sheet } from "./sheet.js";

const html = htm.bind(h);
const defaults = { mode: "dark", font: "inter", size: 14 };
const fonts = {
	inter: {
		label: "Inter",
		family: '"Inter", system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
	},
	mono: { label: "JetBrains Mono", family: "var(--mono)" },
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
	root.dataset.theme = preferences.mode;
	root
		.querySelector('meta[name="theme-color"]')
		?.setAttribute("content", preferences.mode === "light" ? "#fcfcfc" : "#141414");
	root.style.setProperty("--pocket-font-family", fonts[preferences.font].family);
	root.style.setProperty("--font", fonts[preferences.font].family);
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
	return html`<${Sheet} variant="settings" label="Appearance" close=${close}>
		<aside class="settings-rail"><button class="back-to-app" aria-label="Close appearance" onClick=${close}><${Glyph} name="chevron-left" /><span>Back to app</span></button><nav class="settings-nav" aria-label="Settings"><div class="settings-group-label">Personal</div><button class="settings-nav-row active"><${Glyph} name="system" /><span>Appearance</span></button></nav></aside>
		<div class="settings-content"><div class="settings-content-head">Settings</div><div class="settings-page">
			<h1>Appearance</h1><p class="settings-sub" role="status">${saved ? "Changes apply immediately and are saved in this browser." : "Changes apply to this tab only; browser storage is unavailable."}</p>
			<div class="settings-card appearance-fields">
				<label class="settings-card-row"><span class="card-row-label">Theme</span><select aria-label="Theme" value=${preferences.mode} onChange=${(event) => change({ mode: event.currentTarget.value })}><option value="dark">Dark</option><option value="light">Light</option></select></label>
				<label class="settings-card-row"><span class="card-row-label">Font</span><select aria-label="Font" value=${preferences.font} onChange=${(event) => change({ font: event.currentTarget.value })}>${Object.entries(fonts).map(([value, font]) => html`<option key=${value} value=${value}>${font.label}</option>`)}</select></label>
				<label class="settings-card-row"><span class="card-row-label">Text size</span><select aria-label="Text size" value=${String(preferences.size)} onChange=${(event) => change({ size: Number(event.currentTarget.value) })}>${sizes.map((size) => html`<option key=${size} value=${String(size)}>${size} px</option>`)}</select></label>
				<button class="settings-card-row" data-action="reset-appearance" onClick=${() => change(defaults)}><span class="card-row-label">Reset to defaults</span><${Glyph} name="chevron-right" className="icon chev-right" /></button>
			</div><h2>Preview</h2><div class="pocket-font-preview"><p>Aa 中文预览 · Read comfortably · 0123456789</p><p><code>Code stays monospace.</code></p></div>
		</div></div>
	</${Sheet}>`;
}
