import { createContext, h } from "preact";
import { useContext } from "preact/hooks";
import htm from "htm";
import { Glyph } from "./frontend.js";
import { Sheet } from "./sheet.js";
const html = htm.bind(h);
export const SettingsNavigation = createContext([]);

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
	const entries = useContext(SettingsNavigation);
	const pages = entries.length ? entries : [{ id: title, title, category, icon }];
	return html`<${Sheet} variant="settings" label=${label} close=${close}>
  <aside class="settings-rail">
   <button class="back-to-app" aria-label=${closeLabel ?? "Close " + title} onClick=${close}><${Glyph} name="chevron-left" /><span>Back to app</span></button>
   <nav class="settings-nav" aria-label="Settings">${[...new Set(pages.map((page) => page.category))].map(
			(group) =>
				html`<div class="settings-group-label">${group}</div>
					${pages
						.filter((page) => page.category === group)
						.map(
							(page) =>
								html`<button
									class=${"settings-nav-row" + (page.title === title ? " active" : "")}
									data-settings-page=${page.id}
									aria-current=${page.title === title ? "page" : undefined}
									disabled=${page.disabled}
									title=${page.disabled ? "Select a Conversation first" : undefined}
									onClick=${page.open}
								>
									<${Glyph} name=${page.icon} /><span>${page.title}</span>
								</button>`,
						)}`,
		)}</nav>
  </aside>
  <div class="settings-content"><div class="settings-content-head">Settings</div><div class="settings-page">
   <h1>${title}</h1>${description && html`<p class="settings-sub">${description}</p>`}${children}
  </div></div>
 </${Sheet}>`;
}
