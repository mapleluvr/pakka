import { h } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { Sheet } from "./sheet.js";
const html = htm.bind(h);

export function useConversationConfiguration(target, person, client, error) {
	const [value, setValue] = useState(null);
	useEffect(() => {
		let live = true;
		setValue(null);
		if (target && person)
			void client
				.request({ op: "configuration", target })
				.then((result) => {
					if (live) setValue({ ...result.configuration, serverId: result.serverId });
				})
				.catch((failure) => {
					if (live) error(failure);
				});
		return () => {
			live = false;
		};
	}, [target?.incarnation, target?.key, person?.id]);
	return value?.ref.key === target?.key && value?.ref.incarnation === target?.incarnation ? value : null;
}
function useChange({ target, client, applied, error }, onSuccess) {
	const [pending, setPending] = useState(false),
		[uncertain, setUncertain] = useState(false),
		live = useRef(true);
	useEffect(
		() => () => {
			live.current = false;
		},
		[],
	);
	async function apply(change) {
		if (pending || uncertain) return;
		setPending(true);
		try {
			const result = await client.request({ op: "configure.agent", target, change });
			if (!live.current) return;
			onSuccess?.();
			await applied(result.ref);
		} catch (failure) {
			if (!live.current) return;
			if (failure.outcome === "unknown") setUncertain(true);
			else error(failure);
		} finally {
			if (live.current) setPending(false);
		}
	}
	async function inspect() {
		setPending(true);
		try {
			const result = await client.request({ op: "list" });
			if (!live.current) return;
			const ref = result.conversations.find(
				(row) => row.key === target.key && row.sessionId === target.sessionId,
			);
			if (ref) await applied(ref);
		} catch (failure) {
			if (live.current) error(failure);
		} finally {
			if (live.current) setPending(false);
		}
	}
	return {
		pending,
		uncertain,
		apply,
		status: uncertain
			? html`<p role="status">
						The result is unconfirmed. Inspect the current configuration before another change; nothing will
						be retried automatically.
					</p>
					<button type="button" data-reload-configuration onClick=${inspect} disabled=${pending}>
						Inspect current configuration
					</button>`
			: null,
	};
}
function Heading({ title, label, close }) {
	return html`<header>
		<h2>${title}</h2>
		<button type="button" class="pocket-icon-button" aria-label=${label} onClick=${close}>
			<${Icon} name="close" />
		</button>
	</header>`;
}
// Search only the approved catalog, with ordered characters and independent tokens.
function modelMatches(choices, query) {
	const tokens = query
		.toLowerCase()
		.split(/[\s/]+/)
		.filter(Boolean);
	if (!tokens.length) return choices;
	function score(token, text) {
		const contiguous = text.indexOf(token);
		if (contiguous >= 0) return contiguous + (text.length - token.length) / 100;
		let previous = -1,
			gaps = 0;
		for (const character of token) {
			const next = text.indexOf(character, previous + 1);
			if (next < 0) return Infinity;
			gaps += next - previous - 1;
			previous = next;
		}
		return 20 + gaps + text.length / 100;
	}
	return choices
		.map((row) => ({
			row,
			score: tokens.reduce(
				(total, token) =>
					total + Math.min(score(token, row.model.toLowerCase()), score(token, row.id.toLowerCase())),
				0,
			),
		}))
		.filter((match) => Number.isFinite(match.score))
		.sort((a, b) => a.score - b.score)
		.map((match) => match.row);
}
export function ModelPicker(props) {
	const { value, busy, close } = props,
		[query, setQuery] = useState(""),
		[index, setIndex] = useState(0),
		input = useRef(null),
		list = useRef(null),
		listId = useId(),
		change = useChange(props);
	const current = value.current?.model ?? value.choices.find((row) => row.id === value.ref.profile)?.model;
	const choices = [...new Map(value.choices.map((row) => [row.model, row])).values()].sort(
		(a, b) => Number(b.model === current) - Number(a.model === current),
	);
	const filtered = modelMatches(choices, query),
		selected = Math.min(index, filtered.length - 1),
		blocked = busy || change.pending || change.uncertain || !value.canConfigure;
	useLayoutEffect(() => {
		const row = list.current?.children[selected];
		if (!row) return;
		const bounds = list.current.getBoundingClientRect(),
			rect = row.getBoundingClientRect();
		if (rect.top < bounds.top) list.current.scrollTop -= bounds.top - rect.top;
		else if (rect.bottom > bounds.bottom) list.current.scrollTop += rect.bottom - bounds.bottom;
	}, [query, selected]);
	function choose(row) {
		if (!row || blocked) return;
		if (row.model === current) close();
		else void change.apply({ model: row.model });
	}
	function keys(event) {
		if (event.isComposing || event.keyCode === 229) {
			event.stopPropagation();
			return;
		}
		if (event.key === "Enter" && event.target === input.current) {
			event.preventDefault();
			choose(filtered[selected]);
			return;
		}
		if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
		event.preventDefault();
		if (filtered.length)
			setIndex((selected + (event.key === "ArrowDown" ? 1 : filtered.length - 1)) % filtered.length);
		input.current?.focus({ preventScroll: true });
	}
	return html`<${Sheet} label="Select Model" close=${close} anchor=${document.querySelector("[data-action=model]")} initialFocus="[data-model-search]"><${Heading} title="Model Selection" label="Close model picker" close=${close}/><div class="pocket-sheet-body pocket-model-picker" onKeyDown=${keys}>
  <label class="pocket-model-search">Search Models<input ref=${input} data-model-search type="search" role="combobox" aria-label="Search models" placeholder="Search by model or profile" aria-autocomplete="list" aria-expanded="true" aria-controls=${listId} aria-activedescendant=${selected >= 0 ? listId + "-" + selected : undefined} autocomplete="off" spellcheck="false" value=${query} onInput=${(
		event,
	) => {
		setQuery(event.currentTarget.value);
		setIndex(0);
	}} /></label>
  <div class="pocket-model-index pocket-secondary"><span>Approved Models</span><span data-model-position role="status" aria-label="Model position">${selected + 1} / ${filtered.length}</span></div>
  <div ref=${list} id=${listId} role="listbox" aria-label="Approved models">${filtered.map(
		(row, position) =>
			html`<button
				type="button"
				role="option"
				id=${listId + "-" + position}
				class="pocket-choice-row"
				key=${row.model}
				data-pick-model=${row.model}
				data-current-model=${row.model === current ? "" : undefined}
				aria-selected=${position === selected}
				tabindex=${position === selected ? 0 : -1}
				disabled=${blocked}
				onFocus=${() => setIndex(position)}
				onClick=${() => choose(row)}
			>
				<span
					><strong>${row.model}</strong><small>${row.id}</small>${row.model === current &&
					html`<span class="sr-only">Current model</span>`}</span
				>${row.model === current && html`<${Icon} name="check" />`}
			</button>`,
	)}</div>
  ${!filtered.length && html`<p role="status">No matching approved models.</p>`}
  <div class="pocket-model-keys pocket-secondary" aria-hidden="true"><span><${Icon} name="up"/><${Icon} name="down"/> Navigate</span><span><${Icon} name="enter"/> Select</span><span><kbd>Esc</kbd> Close</span></div>
  <p class="pocket-secondary">Changes only the model for this conversation. Directory, instructions and tools stay unchanged.</p>${busy && html`<p role="status">Wait for current work and queued inputs to finish.</p>`}${change.status}
 </div></${Sheet}>`;
}
const placeKey = (person, server) => "pakka.directories." + server + "." + person.id;
function readPlaces(key) {
	try {
		const value = JSON.parse(localStorage.getItem(key));
		if (
			value?.version === 1 &&
			[value.recent, value.favorites].every(
				(rows) =>
					Array.isArray(rows) &&
					rows.length <= 16 &&
					rows.every((row) => typeof row === "string" && row.length <= 8192 && !/[\x00-\x1f\x7f]/.test(row)),
			)
		)
			return value;
	} catch {}
	return { version: 1, recent: [], favorites: [] };
}
export function clearDirectoryPreferences(person) {
	if (!person) return;
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const key = localStorage.key(i);
			if (key?.startsWith("pakka.directories.") && key.endsWith("." + person.id))
				localStorage.removeItem(key);
		}
	} catch {}
}
function directoryCrumbs(view) {
	if (!view) return [];
	const root = [...view.roots]
		.sort((a, b) => b.length - a.length)
		.find(
			(root) =>
				view.path === root ||
				view.path.startsWith(root.endsWith("/") ? root : root + "/") ||
				view.path.startsWith(root.endsWith("\\") ? root : root + "\\"),
		);
	if (!root) return [];
	const crumbs = [{ name: root, path: root }],
		separator = root.includes("\\") ? "\\" : "/";
	let current = root;
	for (const name of view.path
		.slice(root.length)
		.split(/[\\/]+/)
		.filter(Boolean)) {
		current = current.replace(/[\\/]$/, "") + separator + name;
		crumbs.push({ name, path: current });
	}
	return crumbs;
}
export function DirectoryPicker(props) {
	const { target, value, person, client, busy, close, error } = props,
		key = placeKey(person, value.serverId),
		[places, setPlaces] = useState(() => readPlaces(key)),
		[view, setView] = useState(null),
		[path, setPath] = useState(value.current?.cwd ?? ""),
		[loading, setLoading] = useState(false),
		[storageMessage, setStorageMessage] = useState("");
	const live = useRef(true),
		generation = useRef(0),
		known = useRef(places);
	useEffect(
		() => () => {
			live.current = false;
			generation.current++;
		},
		[],
	);
	function save(next) {
		known.current = next;
		setPlaces(next);
		try {
			localStorage.setItem(key, JSON.stringify(next));
		} catch {
			setStorageMessage("Browser storage is unavailable; these shortcuts will not persist.");
		}
	}
	const change = useChange(props, () =>
		save({
			...known.current,
			recent: [view.path, ...known.current.recent.filter((row) => row !== view.path)].slice(0, 16),
		}),
	);
	async function browse(next) {
		const operation = ++generation.current;
		setLoading(true);
		try {
			const result = await client.request({
				op: "directory.list",
				target,
				...(next ? { path: next } : {}),
				places: [...new Set([...known.current.favorites, ...known.current.recent])].slice(0, 32),
			});
			if (!live.current || operation !== generation.current) return;
			setView(result.view);
			setPath(result.view.path);
		} catch (failure) {
			if (live.current && operation === generation.current) error(failure);
		} finally {
			if (live.current && operation === generation.current) setLoading(false);
		}
	}
	useEffect(() => {
		void browse();
	}, []);
	const blocked = loading || change.pending || change.uncertain || busy;
	const authorized = new Set(view ? [view.path, ...view.places] : []);
	const favorite = view && places.favorites.includes(view.path);
	const links = (label, rows) =>
		html`<section aria-label=${label}>
			<h3>${label}</h3>
			${rows
				.filter((row) => authorized.has(row))
				.map(
					(row) =>
						html`<button
							type="button"
							class="pocket-path-row"
							key=${row}
							disabled=${blocked}
							onClick=${() => void browse(row)}
							title=${row}
						>
							<${Icon} name="folder" /><span>${row}</span>
						</button>`,
				)}
		</section>`;
	return html`<${Sheet} label="Working Directory" close=${close}><${Heading} title="Working Directory" label="Close directory picker" close=${close}/><div class="pocket-sheet-body pocket-directory-picker">
  <p class="pocket-secondary">Folders on the server, not this phone or browser. Browsing does not change configuration or grant file/tool access. Shortcuts are saved in this browser and cleared on sign out.</p>
  <form class="pocket-directory-location" onSubmit=${(event) => {
		event.preventDefault();
		void browse(path);
	}}><label>Server path<input data-directory-path aria-label="Server directory path" value=${path} onInput=${(event) => setPath(event.currentTarget.value)} disabled=${change.pending || change.uncertain}/></label><button type="submit" disabled=${blocked}>Go</button></form>
  ${loading && html`<p role="status">Loading directories…</p>`}
  ${
		view &&
		html`<nav aria-label="Directory path">
				<ol class="pocket-breadcrumbs">
					${directoryCrumbs(view).map(
						(crumb) =>
							html`<li key=${crumb.path}>
								<button
									type="button"
									title=${crumb.path}
									aria-current=${crumb.path === view.path ? "location" : undefined}
									disabled=${blocked || crumb.path === view.path}
									onClick=${() => void browse(crumb.path)}
								>
									${crumb.name}
								</button>
							</li>`,
					)}
				</ol>
			</nav>
			<div class="pocket-directory-browser">
				<nav aria-label="Approved locations">
					<h3>Locations</h3>
					${view.roots.map(
						(root) =>
							html`<button
								type="button"
								class="pocket-path-row"
								key=${root}
								disabled=${blocked}
								onClick=${() => void browse(root)}
								title=${root}
							>
								<${Icon} name="folder" /><span>${root}</span>
							</button>`,
					)}
				</nav>
				${links("Favorite directories", places.favorites)}${links("Recent directories", places.recent)}
				<section aria-label="Folders">
					<div class="pocket-directory-current">
						<strong title=${view.path}>${view.path}</strong
						><button
							type="button"
							class="pocket-icon-button"
							data-favorite-directory
							aria-label=${favorite ? "Remove directory from favorites" : "Favorite this directory"}
							aria-pressed=${!!favorite}
							disabled=${blocked}
							onClick=${() =>
								save({
									...places,
									favorites: favorite
										? places.favorites.filter((row) => row !== view.path)
										: [view.path, ...places.favorites].slice(0, 16),
								})}
						>
							<${Icon} name="star" />
						</button>
					</div>
					${view.parent &&
					html`<button
						type="button"
						class="pocket-path-row"
						aria-label="Parent directory"
						disabled=${blocked}
						onClick=${() => void browse(view.parent)}
					>
						<${Icon} name="up" /><span>Parent directory</span>
					</button>`}
					${view.directories.map(
						(directory) =>
							html`<button
								type="button"
								class="pocket-path-row"
								data-directory=${directory}
								key=${directory}
								disabled=${blocked}
								title=${directory}
								onClick=${() => void browse(directory)}
							>
								<${Icon} name="folder" /><span
									>${directory.slice(view.path.length).replace(/^[\\/]/, "") || directory}</span
								>
							</button>`,
					)}
					${!view.directories.length && html`<p>No subdirectories.</p>`}${view.truncated &&
					html`<p role="status">Listing limited. Use the path field to open a known directory.</p>`}
				</section>
			</div>`
	}
  ${busy && html`<p role="status">Wait for current work and queued inputs to finish.</p>`}${storageMessage && html`<p role="status">${storageMessage}</p>`}${change.status}
 </div><footer class="pocket-directory-footer"><p class="pocket-cwd">${view?.path ?? "Choose a directory"}</p><button type="button" class="button primary" data-use-directory disabled=${!view || blocked || view.path === value.current?.cwd || !value.canConfigure} onClick=${() => void change.apply({ cwd: view.path })}>Use this directory</button></footer></${Sheet}>`;
}
