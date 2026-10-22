import { h } from "preact";
import htm from "htm";
import { Glyph } from "./frontend.js";
import { Sheet } from "./sheet.js";
const html = htm.bind(h);

/** Reference Settings anatomy; children remain the real capability's fields and callbacks. */
export function SettingsPage({
	title,
	label = title,
	closeLabel,
	category = "Personal",
	icon = "settings",
	description,
	close,
	children,
}) {
	return html`<${Sheet} variant="settings" label=${label} close=${close}>
  <aside class="settings-rail">
   <button class="back-to-app" aria-label=${closeLabel ?? "Close " + title} onClick=${close}><${Glyph} name="chevron-left" /><span>Back to app</span></button>
   <nav class="settings-nav" aria-label="Settings"><div class="settings-group-label">${category}</div><button class="settings-nav-row active" aria-current="page"><${Glyph} name=${icon} /><span>${title}</span></button></nav>
  </aside>
  <div class="settings-content"><div class="settings-content-head">Settings</div><div class="settings-page">
   <h1>${title}</h1>${description && html`<p class="settings-sub">${description}</p>`}${children}
  </div></div>
 </${Sheet}>`;
}
