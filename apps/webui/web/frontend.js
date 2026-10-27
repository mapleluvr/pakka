// Frontend structure follows devin-ui-comparison@ed20cec/clean-room/current.
// WebUI state/actions are supplied by app.js; this module never grants authority.
import { h } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { resourceKey } from "./resource-identity.js";
import { ConversationGroups } from "./conversation-groups.js";
const html = htm.bind(h);
export const Glyph = ({ name, className = "icon" }) =>
	html`<svg class=${className} aria-hidden="true"><use href=${"#i-" + name} /></svg>`;

export function Menu({
	name,
	trigger,
	close,
	children,
	initialFocus = "button:not(:disabled),input",
	closeOnTab = false,
}) {
	const node = useRef(null),
		[position, setPosition] = useState({ visibility: "hidden" });
	useLayoutEffect(() => {
		if (position.visibility !== "hidden") node.current.querySelector(initialFocus)?.focus();
	}, [position.visibility, initialFocus]);
	useLayoutEffect(() => {
		let returnFocus = true;
		const place = () => {
			const r = trigger.getBoundingClientRect(),
				box = node.current.getBoundingClientRect();
			setPosition({
				left: Math.max(8, Math.min(r.left, innerWidth - box.width - 8)) + "px",
				top: Math.max(8, Math.min(r.bottom + 6, innerHeight - box.height - 8)) + "px",
			});
		};
		place();
		const outside = (e) => {
			if (!node.current.contains(e.target) && !trigger.contains(e.target)) close();
		};
		const escape = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				close();
			} else if (closeOnTab && e.key === "Tab") {
				returnFocus = false;
				trigger.focus();
				close();
			}
		};
		window.addEventListener("pointerdown", outside, true);
		window.addEventListener("keydown", escape, true);
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("pointerdown", outside, true);
			window.removeEventListener("keydown", escape, true);
			window.removeEventListener("resize", place);
			if (returnFocus && trigger.isConnected) trigger.focus();
		};
	}, []);
	return html`<div class=${"menu " + name + "-menu"} role="menu" style=${position} ref=${node}>
		${children}
	</div>`;
}

export function Frontend({
	person,
	refs,
	titles,
	states,
	selected,
	view,
	extensions,
	drawer,
	collapsed,
	drawerToggle,
	dismissDrawer,
	newSession,
	newConversation,
	sessions,
	canCreate,
	workspaceSessionId,
	resourceIds,
	client,
	error,
	stopInput,
	choose,
	search,
	historyFind,
	setHistoryFind,
	openSheet,
	showPeople,
	showCollaboration,
	refresh,
	signOut,
	configuration,
	children,
	transcript,
	composer,
	recovery,
	notice,
}) {
	const [menu, setMenu] = useState(null);
	const openMenu = (name, event) =>
		setMenu(menu?.name === name ? null : { name, trigger: event.currentTarget });
	const action = (fn) => () => {
		setMenu(null);
		fn();
	};
	const title = (ref) => titles[resourceKey(ref)] ?? ref.profile + " · " + ref.conversationId.slice(0, 8);
	useLayoutEffect(() => {
		document.body.dataset.view = extensions.page ? "workspace" : selected ? "conversation" : "home";
		document.body.dataset.mode = "agent";
		document.body.classList.toggle("drawer-open", drawer);
		document.body.classList.toggle("sidebar-collapsed", collapsed);
		return () => {
			document.body.classList.remove("drawer-open", "sidebar-collapsed");
		};
	}, [drawer, collapsed, selected?.key, extensions.page]);
	const sessionRows = refs.filter((ref) => !states[resourceKey(ref)]?.archived);
	return html`<div
		class="app-shell"
		onKeyDown=${(e) => {
			if (drawer && e.key === "Escape" && !e.defaultPrevented) {
				e.preventDefault();
				dismissDrawer();
			}
		}}
	>
		<aside class="sidebar" id="sidebar" aria-label="Primary navigation">
			<div class="sidebar-header">
				<button
					class="org-trigger"
					aria-haspopup="menu"
					aria-expanded=${menu?.name === "org"}
					onClick=${(e) => openMenu("org", e)}
				>
					<span class="avatar"><${Glyph} name="user" /></span><span class="org-name">${person.name}</span
					><${Glyph} name="chevron-down" className="icon chev" />
				</button>
				<div class="sidebar-header-actions">
					<button
						class="icon-btn"
						data-action="search-conversations"
						aria-label="Search conversations"
						title="Search and commands (Ctrl K)"
						onClick=${search}
					>
						<${Glyph} name="search" />
					</button>
					<button
						class="icon-btn"
						aria-label="Notifications"
						disabled=${!selected}
						onClick=${() => openSheet("notifications")}
					>
						<${Glyph} name="bell" />
					</button>
					<button
						class="icon-btn"
						data-action="collapse-sidebar"
						aria-label="Collapse sidebar"
						onClick=${() => openSheet("collapse-sidebar")}
					>
						<${Glyph} name="panel" />
					</button>
				</div>
			</div>
			<nav class="primary-nav" aria-label="Workspace">
				<button
					class="nav-row new-session"
					data-action="new-session"
					disabled=${!canCreate}
					onClick=${newSession}
				>
					<${Glyph} name="plus" /><span>New Session</span>
				</button>
				<button
					class="nav-row"
					data-action="new-conversation"
					disabled=${!canCreate}
					onClick=${() => newConversation()}
				>
					<${Glyph} name="message" /><span>New Conversation</span
					><kbd class="row-kbd" aria-label="Control Shift O">Ctrl <${Icon} name="shift" /> O</kbd>
				</button>
				${extensions.workspaceNavigation}${extensions.navigation}
				<button class="nav-row" data-action="commands" onClick=${() => extensions.openCommands()}>
					<${Glyph} name="commands" /><span>Commands & Extensions</span>
				</button>
			</nav>
			<div class="sessions-area">
				<div class="sessions-heading">
					<span>Conversations</span>
					<div class="sessions-actions">
						<button class="icon-btn small touch-only" aria-label="Search conversations" onClick=${search}>
							<${Glyph} name="search" />
						</button>
						<button
							class="icon-btn small"
							aria-label="New Conversation"
							disabled=${!canCreate}
							onClick=${() => newConversation()}
						>
							<${Glyph} name="plus" />
						</button>
						<button
							class="icon-btn small"
							aria-label="Conversation list options"
							aria-haspopup="menu"
							aria-expanded=${menu?.name === "sessions"}
							onClick=${(e) => openMenu("sessions", e)}
						>
							<${Glyph} name="more" />
						</button>
					</div>
				</div>
				<${ConversationGroups}
					key=${JSON.stringify([person.id, workspaceSessionId])}
					person=${person}
					workspaceSessionId=${workspaceSessionId}
					refs=${sessionRows}
					resourceIds=${resourceIds}
					sessions=${sessions}
					selected=${selected}
					title=${title}
					choose=${choose}
					newConversation=${newConversation}
					canCreate=${canCreate}
					client=${client}
					error=${error}
					stopInput=${stopInput}
				/>
				<button class="nav-row recent-row" onClick=${search}>
					<${Glyph} name="clock" /><span>Recent</span><${Glyph} name="chevron-right" className="icon chev" />
				</button>
			</div>
			<div class="sidebar-footer">
				<span class="prototype-tag">${person.role}</span>
				<div class="footer-actions">
					<button
						class="icon-btn"
						data-action="open-settings"
						aria-label="Settings"
						onClick=${() => openSheet("appearance")}
					>
						<${Glyph} name="settings" />
					</button>
				</div>
			</div>
		</aside>
		<div
			class="scrim"
			role="button"
			aria-label="Close conversations"
			tabindex="0"
			hidden=${!drawer}
			onClick=${dismissDrawer}
			onKeyDown=${(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					dismissDrawer();
				}
			}}
		></div>
		<main class="main" id="main">
			<button
				class="icon-btn expand-sidebar"
				hidden=${!collapsed}
				data-action="expand-sidebar"
				aria-label="Expand sidebar"
				onClick=${() => openSheet("expand-sidebar")}
			>
				<${Glyph} name="panel" />
			</button>
			${(!selected || extensions.page) &&
			html`<header class="mobile-topbar">
				<button
					class="icon-btn"
					aria-label="Toggle conversations"
					aria-controls="sidebar"
					aria-expanded=${drawer}
					ref=${drawerToggle}
					onClick=${() => openSheet("toggle-drawer")}
				>
					<${Glyph} name="panel" />
				</button>
			</header>`}
			${extensions.page
				? extensions.surface
				: selected
					? html`<section class="conversation-view" aria-label="Conversation">
							<header class="conversation-head">
								<div class="conversation-title-wrap">
									<button
										class="icon-btn mobile-only"
										aria-label="Toggle conversations"
										aria-expanded=${drawer}
										ref=${drawerToggle}
										onClick=${() => openSheet("toggle-drawer")}
									>
										<${Glyph} name="panel" />
									</button>
									<div>
										<div class="conversation-title pocket-title">${title(selected)}</div>
										<div class="conversation-meta">
											<button
												class="cwd-chip"
												data-action="cwd"
												aria-label=${"Working directory: " + (configuration?.current?.cwd ?? "Loading")}
												title=${configuration?.current?.cwd ?? ""}
												disabled=${!configuration?.canConfigure}
												onClick=${() => openSheet("directory")}
											>
												<${Glyph} name="folder" /><span
													>${configuration?.current?.cwd ?? "Loading directory…"}</span
												>
											</button>
											<span class="meta-sep">·</span
											><span class="pocket-status"
												>${view?.live.busy ? "Working" : view ? "Ready" : "Connecting…"}</span
											>
										</div>
									</div>
								</div>
								<div class="conversation-actions">
									${extensions.back}<button
										class="icon-btn"
										aria-label="Find in conversation"
										aria-haspopup="dialog"
										onClick=${(e) => openMenu("history", e)}
									>
										<${Glyph} name="search" /></button
									><button
										class="icon-btn"
										aria-label="Conversation options"
										aria-haspopup="menu"
										aria-expanded=${menu?.name === "conversation"}
										onClick=${(e) => openMenu("conversation", e)}
									>
										<${Glyph} name="more" />
									</button>
								</div>
							</header>
							${transcript}${!extensions.page && extensions.surface}${composer}
						</section>`
					: html`<section class="home-view" aria-label="Workspace Home">
							<div class="hero-block">
								<div class="hero-head">
									<div class="wordmark" aria-label="Pakka">
										<${Glyph} name="logo" className="logo-mark" /><span class="wordmark-text">Pakka</span>
									</div>
									<div class="segmented" role="tablist" aria-label="Conversation Mode">
										<button role="tab" aria-selected="true">Agent</button>
									</div>
								</div>
								<section class="home-create-card" aria-label="Create Conversation">
									<h1>Start a Conversation</h1>
									${!canCreate && html`<p>Select a Conversation from the sidebar to view its history.</p>`}
									<div class="creation-actions">
										${canCreate &&
										html`<div class="home-creation-pair">
											<button
												type="button"
												class="creation-entry-button"
												data-action="new-conversation"
												onClick=${() => newConversation()}
											>
												<${Glyph} name="message" />New Conversation</button
											><span class="creation-divider" data-creation-divider aria-hidden="true"></span
											><button
												type="button"
												class="creation-entry-button"
												data-action="new-session"
												onClick=${newSession}
											>
												<${Glyph} name="plus" />New Session
											</button>
										</div>`}<button
											type="button"
											class="pocket-icon-button"
											aria-label="Commands & Extensions"
											onClick=${() => extensions.openCommands()}
										>
											<${Glyph} name="commands" />
										</button>
									</div>
								</section>
							</div>
						</section>`}
			${recovery}${notice}
		</main>
		${menu &&
		html`<${Menu} key=${menu.name} name=${menu.name} trigger=${menu.trigger} close=${() => setMenu(null)}>
   ${
			menu.name === "org" &&
			html`<div class="org-menu-head">
					<span class="avatar large"><${Glyph} name="user" /></span>
					<div><strong>${person.name}</strong><span>${person.role}</span></div>
				</div>
				${person.role === "admin" &&
				html`<button class="menu-row" role="menuitem" data-action="people" onClick=${action(showPeople)}>
					People & Invitations
				</button>`}<button class="menu-row" role="menuitem" data-action="logout" onClick=${action(signOut)}>
					Sign out
				</button>`
		}
   ${
			menu.name === "history" &&
			html`<div class="palette-search">
					<${Glyph} name="search" /><input
						type="search"
						aria-label="Find loaded history"
						placeholder="Find loaded history…"
						value=${historyFind}
						onInput=${(event) => setHistoryFind(event.currentTarget.value)}
					/>
				</div>
				<div class="menu-caption">Filters loaded messages only</div>`
		}
   ${menu.name === "sessions" && html`<button class="menu-row" role="menuitem" onClick=${action(search)}><${Glyph} name="search" />Search / Archived Conversations</button><button class="menu-row" role="menuitem" onClick=${action(refresh)}><${Glyph} name="clock" />Refresh Conversations</button>`}

   ${menu.name === "conversation" && html`<button class="menu-row" role="menuitem" data-action="conversation" onClick=${action(() => openSheet("conversation"))}>Conversation</button><button class="menu-row" role="menuitem" data-action="settings" onClick=${action(() => openSheet("configuration"))}>Settings</button><button class="menu-row" role="menuitem" data-action="notifications" onClick=${action(() => openSheet("notifications"))}>Notifications</button><button class="menu-row" role="menuitem" data-action="collaboration" onClick=${action(showCollaboration)}>People Chat</button>`}
  </${Menu}>`}
		${children}
	</div>`;
}
