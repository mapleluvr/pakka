import { h, Component } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { createExtensionClient } from "@pakka/webui/client";
import { decodeValue } from "@pakka/webui/extension";

const html = htm.bind(h);
class ContentBoundary extends Component {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render(props, state) {
		return state.failed
			? html`<p role="alert">This extension interface failed. Close it and check its registration.</p>`
			: props.children;
	}
}
const currentKey = (target) =>
	target
		? JSON.stringify([
				target.sessionId,
				target.conversationId,
				target.key,
				target.incarnation,
				target.profile,
			])
		: "app";

/** The application owns auth/navigation; all extension surfaces use this ordinary public registry. */
export function useExtensions({ person, target, csrf, notice, error, navigate, opened }) {
	const [registrations, setRegistrations] = useState([]),
		[surface, setSurface] = useState(null),
		[overlay, setOverlay] = useState(null),
		[palette, setPalette] = useState(false),
		[query, setQuery] = useState("");
	const latest = useRef({});
	latest.current = { person, target, notice, error, navigate, opened };
	const pending = useRef(new Map());
	const client = useMemo(
		() =>
			createExtensionClient({
				endpoint: new URL("/pocket/extensions/rpc", location.href).href,
				csrf,
				personId: () => latest.current.person?.id,
			}),
		[person?.id],
	);
	const registry = useRef([]);
	registry.current = registrations;
	const activeInstances = useRef([]);
	activeInstances.current = [surface, overlay].filter(Boolean);
	useEffect(() => {
		setRegistrations([]);
		setSurface(null);
		setOverlay(null);
		setPalette(false);
		if (!person) return;
		let active = true,
			timer;
		const controller = new AbortController();
		const refresh = async () => {
			try {
				const rows = await client.list(target, { signal: controller.signal });
				const scopes = new Map([[currentKey(target), rows]]);
				for (const instance of activeInstances.current) {
					const key = currentKey(instance.target);
					if (scopes.has(key)) continue;
					try {
						scopes.set(key, await client.list(instance.target, { signal: controller.signal }));
					} catch (failure) {
						if (failure.code === "UNAUTHORIZED") throw failure;
						scopes.set(key, []);
					}
				}
				if (!active) return;
				setRegistrations(rows);
				const keep = (instance) => {
					if (!instance) return false;
					const scoped = scopes.get(currentKey(instance.target));
					// A newly opened instance was just authorized by its own discovery; check it on the next refresh.
					if (!scoped) return true;
					return scoped.some(
						(row) =>
							row.manifest.id === instance.registration.manifest.id &&
							row.generation === instance.registration.generation &&
							row.phase === "ready" &&
							row.manifest.interfaces.some((view) => view.id === instance.view.id),
					);
				};
				setSurface((old) => (keep(old) ? old : null));
				setOverlay((old) => (keep(old) ? old : null));
			} catch (failure) {
				if (active) {
					setRegistrations([]);
					setSurface(null);
					setOverlay(null);
					if (["UNAUTHORIZED", "FORBIDDEN"].includes(failure.code)) latest.current.error(failure);
				}
			} finally {
				if (active) timer = setTimeout(refresh, 1000);
			}
		};
		void refresh();
		return () => {
			active = false;
			clearTimeout(timer);
			controller.abort();
		};
	}, [client, person?.role, currentKey(target)]);
	const open = (registration, id, resource = latest.current.target) => {
		const accepted = registry.current.find(
				(row) =>
					row.manifest.id === registration.manifest.id &&
					row.generation === registration.generation &&
					row.phase === "ready",
			),
			view = accepted && registration.manifest.interfaces.find((row) => row.id === id);
		if (!view || (view.scope === "conversation" && !resource)) return;
		const instance = {
			registration,
			view,
			id: crypto.randomUUID(),
			target: resource,
			person: latest.current.person,
			trigger: document.activeElement,
		};
		setPalette(false);
		latest.current.opened();
		if (["sheet", "settings"].includes(view.slot)) setOverlay(instance);
		else {
			setSurface(instance);
			setOverlay(null);
		}
	};
	const close = (id) => {
		setSurface((old) => (old?.id === id ? null : old));
		setOverlay((old) => (old?.id === id ? null : old));
	};
	const execute = async (
		registration,
		actionId,
		input,
		{ signal, requestId } = {},
		resource = latest.current.target,
	) => {
		const action = registration.manifest.actions.find((row) => row.id === actionId);
		if (!action) throw new Error("Action is unavailable");
		const payload = decodeValue(action.input, input),
			target = action.scope === "conversation" ? resource : undefined;
		if (action.scope === "conversation" && !target) throw new Error("Select a conversation first");
		const key = JSON.stringify([
			latest.current.person?.id,
			registration.manifest.id,
			registration.generation,
			actionId,
			target,
			payload,
		]);
		let operation = pending.current.get(key);
		if (action.effect === "read")
			return client.call(
				{
					extension: registration.manifest.id,
					generation: registration.generation,
					action: actionId,
					requestId: requestId ?? crypto.randomUUID(),
					input: payload,
					...(target ? { target } : {}),
				},
				{ signal },
			);
		if (operation?.promise) return operation.promise;
		const stable = operation?.requestId ?? requestId ?? crypto.randomUUID();
		operation = { requestId: stable };
		pending.current.set(key, operation);
		operation.promise = client.call(
			{
				extension: registration.manifest.id,
				generation: registration.generation,
				action: actionId,
				requestId: stable,
				input: payload,
				...(target ? { target } : {}),
			},
			{ signal },
		);
		try {
			const result = await operation.promise;
			if (result.state === "done") pending.current.delete(key);
			return result;
		} finally {
			delete operation.promise;
		}
	};
	const commands = registrations
		.filter((row) => row.phase === "ready")
		.flatMap((registration) => registration.manifest.commands.map((command) => ({ registration, command })));
	const dispatch = async (registration, command, input = {}) => {
		setPalette(false);
		const personId = latest.current.person?.id,
			resource = currentKey(latest.current.target);
		const live = () =>
			personId === latest.current.person?.id &&
			resource === currentKey(latest.current.target) &&
			registry.current.some(
				(row) =>
					row.manifest.id === registration.manifest.id &&
					row.generation === registration.generation &&
					row.phase === "ready",
			);
		try {
			if (command.interface) {
				open(registration, command.interface);
				return true;
			}
			const action = registration.manifest.actions.find((row) => row.id === command.action);
			if (action) {
				try {
					decodeValue(action.input, input);
				} catch {
					const required = action.input.required ?? [];
					latest.current.notice(
						"Enter /" +
							command.slash +
							" followed by valid JSON arguments." +
							(required.length ? " Required fields: " + required.join(", ") + "." : ""),
					);
					return false;
				}
			}
			const result = await execute(registration, command.action, input);
			if (!live()) return false;
			latest.current.notice(
				result.state === "unknown"
					? "Operation unconfirmed: " + result.id
					: typeof result.value === "string"
						? result.value
						: JSON.stringify(result.value),
			);
			return true;
		} catch (failure) {
			if (live()) latest.current.error(failure);
			return false;
		}
	};
	const slash = async (text) => {
		const match = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(text.trim()),
			found = match && commands.find((row) => row.command.slash === match[1]);
		if (!found) {
			latest.current.notice("This command is unavailable. Slash commands do not send model input.");
			return;
		}
		let input = {};
		if (match[2]?.trim()) {
			try {
				input = JSON.parse(match[2]);
			} catch {
				latest.current.notice("Command arguments must match its JSON schema.");
				return;
			}
		}
		return dispatch(found.registration, found.command, input);
	};
	const controls = registrations.map(
		(registration) =>
			html`<section key=${registration.manifest.id} class="pocket-extension-registration">
				<strong>${registration.manifest.title}</strong><span>${registration.phase}</span>${person?.role ===
					"admin" &&
				html`<button
						onClick=${async () => {
							try {
								await client.control(
									registration.manifest.id,
									registration.phase === "ready" ? "disable" : "enable",
								);
							} catch (failure) {
								latest.current.error(failure);
							}
						}}
					>
						${registration.phase === "ready" ? "Disable" : "Enable"}</button
					><button
						onClick=${async () => {
							try {
								await client.control(registration.manifest.id, "reload");
							} catch (failure) {
								latest.current.error(failure);
							}
						}}
					>
						Reload
					</button>`}
			</section>`,
	);
	const props = {
		client,
		execute,
		open,
		close,
		notice: (text) => latest.current.notice(text),
		navigate: (ref) => latest.current.navigate(ref),
	};
	return {
		page: surface?.view.slot === "page",
		suggestions: (draft, complete) =>
			html`<div class="pocket-command-suggestions">
				${commands
					.filter((row) => ("/" + row.command.slash).startsWith(draft.trim().split(/\s/)[0]))
					.map(
						({ registration, command }) =>
							html`<button
								type="button"
								data-suggestion=${registration.manifest.id + "-" + command.id}
								onClick=${async () => {
									const args = draft
										.trim()
										.slice(command.slash.length + 1)
										.trim();
									const accepted = args ? await slash(draft) : await dispatch(registration, command);
									if (accepted) complete();
								}}
							>
								/${command.slash} · ${command.title}
							</button>`,
					)}
			</div>`,
		slash,
		clear: () => {
			setSurface(null);
			setOverlay(null);
			setPalette(false);
		},
		leave: () => {
			setSurface(null);
			setOverlay(null);
		},
		navigation: registrations
			.filter((row) => row.phase === "ready")
			.flatMap((registration) =>
				registration.manifest.interfaces
					.filter((view) => view.navigation)
					.map(
						(view) =>
							html`<button
								key=${registration.manifest.id + view.id}
								data-interface=${registration.manifest.id + "-" + view.id}
								onClick=${() => open(registration, view.id)}
							>
								${view.title}
							</button>`,
					),
			),
		button: html`<button
			data-action="commands"
			onClick=${() => {
				setQuery("");
				setPalette(true);
			}}
		>
			Commands & extensions
		</button>`,
		surface: surface ? html`<${HostInterface} key=${surface.id} instance=${surface} ...${props} />` : null,
		overlay: overlay
			? html`<${HostInterface} key=${overlay.id} instance=${overlay} ...${props} />`
			: palette
				? html`<${Container} title="Commands & extensions" modal=${true} close=${() => setPalette(false)}><input aria-label="Find command" value=${query} onInput=${(event) => setQuery(event.currentTarget.value)} placeholder="Find a command" />${commands.filter((row) => (row.command.title + row.command.slash).toLowerCase().includes(query.toLowerCase())).map(({ registration, command }) => html`<button class="pocket-command" data-command=${registration.manifest.id + "-" + command.id} onClick=${() => dispatch(registration, command)}><strong>/${command.slash}</strong><span>${command.title}</span></button>`)}${controls}</${Container}>`
				: null,
	};
}

function Container({ title, modal, close, children, trigger }) {
	const root = useRef(null);
	useEffect(() => {
		if (!modal) return;
		const previous = trigger ?? document.activeElement;
		root.current?.focus();
		return () => {
			if (previous?.isConnected) previous.focus();
		};
	}, []);
	const keydown = (event) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			close();
		}
		if (modal && event.key === "Tab") {
			const items = [
					...root.current.querySelectorAll(
						'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
					),
				],
				first = items[0],
				last = items.at(-1);
			if (!first) {
				event.preventDefault();
				return;
			}
			if (event.shiftKey && [first, root.current].includes(document.activeElement)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && [last, root.current].includes(document.activeElement)) {
				event.preventDefault();
				first.focus();
			}
		}
	};
	const content = html`<section
		class=${modal ? "pocket-sheet" : "pocket-extension-surface"}
		role=${modal ? "dialog" : "region"}
		aria-modal=${modal ? "true" : undefined}
		aria-label=${title}
		tabIndex=${-1}
		ref=${root}
		onKeyDown=${keydown}
	>
		<header>
			<h2>${title}</h2>
			<button class="pocket-icon-button" aria-label=${"Close " + title} onClick=${close}>
				<${Icon} name="close" />
			</button>
		</header>
		<div class="pocket-sheet-body">${children}</div>
	</section>`;
	return modal
		? html`<div
				class="pocket-scrim"
				onClick=${(event) => {
					if (event.target === event.currentTarget) close();
				}}
			>
				${content}
			</div>`
		: content;
}

function HostInterface({ instance, client, execute, open, close, notice, navigate }) {
	const [component, setComponent] = useState(null),
		[failed, setFailed] = useState(false);
	const controller = useMemo(() => new AbortController(), [instance.id]);
	const context = useMemo(() => {
		const check = () => {
			if (controller.signal.aborted) throw new Error("Interface is closed");
		};
		return Object.freeze({
			extension: instance.registration.manifest.id,
			generation: instance.registration.generation,
			instanceId: instance.id,
			person: instance.person,
			...(instance.target ? { target: instance.target } : {}),
			signal: controller.signal,
			call: async (action, input, options = {}) => {
				check();
				const resource = options.target ?? instance.target;
				const registration = options.target
					? (await client.list(resource, { signal: controller.signal })).find(
							(row) =>
								row.manifest.id === instance.registration.manifest.id &&
								row.generation === instance.registration.generation &&
								row.phase === "ready",
						)
					: instance.registration;
				check();
				if (!registration) throw new Error("Interface resource is unavailable");
				const result = await execute(
					registration,
					action,
					input,
					{ ...options, signal: controller.signal },
					resource,
				);
				check();
				return result;
			},
			operation: async (id) => {
				check();
				const result = await client.operation(id, { signal: controller.signal });
				check();
				return result;
			},
			operationByRequest: async (requestId) => {
				check();
				const result = await client.operationByRequest(
					{
						extension: instance.registration.manifest.id,
						requestId,
						...(instance.target ? { target: instance.target } : {}),
					},
					{ signal: controller.signal },
				);
				check();
				return result;
			},
			subscribe: (action, input, receive, { intervalMs = 1000 } = {}) => {
				check();
				const declaration = instance.registration.manifest.actions.find((row) => row.id === action);
				if (
					declaration?.effect !== "read" ||
					!Number.isSafeInteger(intervalMs) ||
					intervalMs < 100 ||
					intervalMs > 5000
				)
					throw new Error("Finite read subscription required");
				let active = true,
					timer;
				const read = async () => {
					try {
						const result = await execute(
							instance.registration,
							action,
							input,
							{ signal: controller.signal },
							instance.target,
						);
						if (active && !controller.signal.aborted && result.state === "done") receive(result.value);
					} catch {
						/* Failed observation publishes no stale data. */
					} finally {
						if (active && !controller.signal.aborted) timer = setTimeout(read, intervalMs);
					}
				};
				void read();
				return () => {
					active = false;
					clearTimeout(timer);
				};
			},
			notice: (text) => {
				if (!controller.signal.aborted && typeof text === "string" && text.length <= 4096) notice(text);
			},
			open: (id, options = {}) => {
				if (controller.signal.aborted) return;
				if (!options.target) {
					open(instance.registration, id, instance.target);
					return;
				}
				void client
					.list(options.target, { signal: controller.signal })
					.then((rows) => {
						check();
						const registration = rows.find(
							(row) =>
								row.manifest.id === instance.registration.manifest.id &&
								row.generation === instance.registration.generation &&
								row.phase === "ready",
						);
						if (!registration) throw new Error("Interface resource is unavailable");
						open(registration, id, options.target);
					})
					.catch(() => {
						if (!controller.signal.aborted) notice("This extension resource is unavailable.");
					});
			},
			navigate: (target) => {
				if (!controller.signal.aborted) navigate(target);
			},
			close: () => {
				if (!controller.signal.aborted) close(instance.id);
			},
		});
	}, [instance.id]);
	useEffect(() => {
		const registration = instance.registration;
		const url =
			"/pocket/extensions/assets/" +
			registration.manifest.id +
			"/" +
			registration.generation +
			"/" +
			registration.manifest.facets.webui.entry +
			(instance.target ? "?conversationId=" + encodeURIComponent(instance.target.conversationId) : "");
		void import(url)
			.then((module) => {
				if (controller.signal.aborted) return;
				const content = module[instance.view.export];
				if (typeof content !== "function") throw new Error("Missing public content export");
				setComponent(() => content);
			})
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => controller.abort();
	}, [instance.id]);
	return html`<${Container} title=${instance.view.title} modal=${["sheet", "settings"].includes(instance.view.slot)} trigger=${instance.trigger} close=${() => close(instance.id)}>${failed ? html`<p role="alert">Extension content is unavailable. Reload its registration and reopen.</p>` : component ? html`<${ContentBoundary}><${component} context=${context} /></${ContentBoundary}>` : html`<p role="status">Loading extension…</p>`}</${Container}>`;
}
