import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { SettingsPage } from "./settings-page.js";
const html = htm.bind(h);
const active = (flow) => flow && ["prepared", "running", "waiting"].includes(flow.phase);

/** Kept at the workbench root so navigating settings does not lose an auth identity. */
export function useProductModelSettings(client, error) {
	const [state, setState] = useState(null),
		binding = useRef(null);
	if (binding.current?.client !== client)
		binding.current = { client, pending: false, generation: 0, controller: new AbortController() };
	const context = binding.current;
	const value = state?.client === client ? state : null;
	useEffect(
		() => () => {
			context.controller.abort();
		},
		[client],
	);
	function update(patch) {
		if (binding.current !== context || context.controller.signal.aborted) return;
		setState((previous) => {
			if (binding.current !== context) return previous;
			const before = previous?.client === client ? previous : { client };
			return { ...before, ...patch };
		});
	}
	const request = (command) => client.request(command, { signal: context.controller.signal });
	function failed(failure, mutation) {
		if (binding.current !== context || context.controller.signal.aborted) return;
		update({
			message: mutation
				? "Authentication is unconfirmed. Inspect this original interaction; do not submit it again."
				: "Configuration could not be read. Try an explicit refresh.",
			...(mutation ? { uncertain: true } : {}),
		});
		if (["UNAUTHORIZED", "FORBIDDEN"].includes(failure.code)) error(failure);
	}
	async function run(mutation, work) {
		if (!client || context.pending) return;
		context.pending = true;
		context.generation++;
		update({ pending: true, message: "" });
		try {
			await work();
		} catch (failure) {
			failed(failure, mutation);
		} finally {
			context.pending = false;
			update({ pending: false });
		}
	}
	async function status(refresh = false) {
		const result = await request({ op: refresh ? "refresh" : "status" });
		update({ status: result.status, providers: result.providers });
	}
	async function inspectFlow(id) {
		const result = await request({ op: "auth.state", id });
		update({ flow: result.flow, uncertain: false, message: "" });
		if (result.flow.phase === "complete") await status();
	}
	useEffect(() => {
		const flow = value?.flow;
		if (!client || !flow || !["running", "waiting"].includes(flow.phase) || value.uncertain) return;
		let stopped = false,
			timer;
		async function poll() {
			if (stopped) return;
			if (!context.pending) {
				const generation = context.generation;
				try {
					const result = await request({ op: "auth.state", id: flow.id });
					if (!stopped && generation === context.generation && !context.pending) {
						update({ flow: result.flow });
						if (result.flow.phase === "complete") await status();
					}
				} catch (failure) {
					if (!stopped && generation === context.generation) failed(failure, true);
				}
			}
			if (!stopped) timer = setTimeout(() => void poll(), 400);
		}
		timer = setTimeout(() => void poll(), 400);
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, [client, value?.flow?.id, value?.flow?.phase, value?.uncertain]);
	return {
		value,
		load: () => run(false, () => status()),
		refresh: () => run(false, () => status(true)),
		begin: (provider, type) =>
			run(true, async () => {
				if (active(value?.flow) || value?.uncertain) return;
				const prepared = await request({ op: "auth.prepare", provider, type });
				update({ flow: prepared.flow, uncertain: false });
				const started = await request({ op: "auth.start", id: prepared.flow.id });
				update({ flow: started.flow });
			}),
		start: () =>
			run(true, async () => {
				if (value?.flow?.phase !== "prepared" || value.uncertain) return;
				const result = await request({ op: "auth.start", id: value.flow.id });
				update({ flow: result.flow });
			}),
		answer: (answer) =>
			run(true, async () => {
				if (!value?.flow?.prompt || value.uncertain) return;
				const { flow } = value;
				await request({ op: "auth.answer", id: flow.id, promptId: flow.prompt.id, value: answer });
				await inspectFlow(flow.id);
			}),
		inspect: () =>
			run(true, async () => {
				if (value?.flow) await inspectFlow(value.flow.id);
			}),
		cancel: () =>
			run(true, async () => {
				if (!value?.flow) return;
				const result = await request({ op: "auth.cancel", id: value.flow.id });
				update({ flow: result.flow, uncertain: false });
			}),
	};
}
function externalLink(value, label) {
	try {
		const url = new URL(value);
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
		return html`<a href=${url.href} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"
			>${label ?? "Open authentication page"}</a
		>`;
	} catch {
		return null;
	}
}
function PromptField({ prompt, busy }) {
	if (prompt.type === "select")
		return html`<select name="answer" data-native-auth-answer disabled=${busy}>
			${prompt.options.map(
				(option) =>
					html`<option key=${option.id} value=${option.id}>
						${option.label}${option.description ? " — " + option.description : ""}
					</option>`,
			)}
		</select>`;
	return html`<input
		name="answer"
		data-native-auth-answer
		type=${prompt.type === "secret" ? "password" : "text"}
		placeholder=${prompt.placeholder}
		autocomplete="off"
		spellcheck="false"
		maxlength="16384"
		required
		disabled=${busy}
	/>`;
}
function Authentication({ control }) {
	const { value } = control,
		flow = value?.flow;
	if (!flow) return null;
	const prompt = flow.prompt,
		busy = value.pending || value.uncertain;
	return html`<section class="pocket-native-auth" aria-label="Native provider authentication">
		<h2>Authenticate ${flow.provider}</h2>
		<p data-native-auth-phase=${flow.phase} role="status">
			${flow.phase === "complete" ? "Authentication saved by Pi." : flow.phase}
		</p>
		<p class="pocket-secondary">
			Interaction ${flow.id}. Cancelling does not prove that a credential was not saved.
		</p>
		${flow.events.map(
			(event, index) =>
				html`<div key=${index}>
					${event.message && html`<p>${event.message}</p>`}
					${event.type === "auth_url" && html`<p>${event.instructions} ${externalLink(event.url)}</p>`}
					${event.type === "device_code" &&
					html`<p>Device code: <code>${event.userCode}</code> ${externalLink(event.verificationUri)}</p>`}
					${event.links?.map((link) => externalLink(link.url, link.label))}
				</div>`,
		)}
		${prompt &&
		!value.uncertain &&
		html`<form
			class="pocket-form"
			key=${prompt.id}
			autocomplete="off"
			onSubmit=${(event) => {
				event.preventDefault();
				const field = event.currentTarget.elements.namedItem("answer");
				const answer = field.value;
				field.value = "";
				void control.answer(answer);
			}}
		>
			<label>${prompt.message}<${PromptField} prompt=${prompt} busy=${busy} /></label
			><button type="submit" class="pill-btn primary" data-native-auth-submit disabled=${busy}>
				Continue
			</button>
		</form>`}
		${value.uncertain &&
		html`<p data-native-auth-unconfirmed role="alert">
			The last result is unconfirmed. No authentication request will be replayed.
		</p>`}
		<div class="pocket-form-actions">
			${flow.phase === "prepared" &&
			!value.uncertain &&
			html`<button type="button" class="pill-btn" disabled=${busy} onClick=${control.start}>
				Start prepared sign-in
			</button>`}
			<button
				type="button"
				class="pill-btn"
				data-native-auth-inspect
				disabled=${value.pending}
				onClick=${control.inspect}
			>
				Inspect authentication
			</button>
			${active(flow) &&
			html`<button type="button" class="pill-btn" disabled=${value.pending} onClick=${control.cancel}>
				Cancel authentication
			</button>`}
		</div>
	</section>`;
}
export function ProductModelSettings({ control, close }) {
	const [query, setQuery] = useState("");
	const { value } = control;
	useEffect(() => {
		void control.load();
	}, []);
	const status = value?.status,
		busy = value?.pending,
		pendingAuth = active(value?.flow) || value?.uncertain;
	const providers =
		value?.providers?.filter((row) =>
			(row.name + " " + row.id).toLowerCase().includes(query.toLowerCase().trim()),
		) ?? [];
	return html`<${SettingsPage} title="Models & Providers" category="Workspace" close=${close} description="Pi native configuration and authentication. No separate Pakka provider file."><div class="settings-card settings-native-fields pocket-native-model-settings">
		${
			status &&
			html`<section aria-label="Native configuration sources">
				<h2>Configuration sources</h2>
				<dl class="pocket-model-sources">
					<dt>Models</dt>
					<dd><code data-models-path>${status.sources.models}</code></dd>
					<dt>Authentication</dt>
					<dd><code>${status.sources.auth}</code></dd>
					<dt>Defaults</dt>
					<dd><code>${status.sources.settings}</code></dd>
				</dl>
				<p>
					Use your Pi configuration tools to edit providers and models, then refresh here. Existing
					Conversations keep their own model selection.
				</p>
				<p>
					Default model: ${status.defaults.model ?? "Not selected"} · Reasoning:
					${status.defaults.thinkingLevel ?? "Native default"}
				</p>
				${status.issues.map(
					(issue) =>
						html`<p role="alert">
							${issue.source} configuration is unavailable. Correct the native file and refresh; its contents
							are not shown here.
						</p>`,
				)}
			</section>`
		}
		<button type="button" class="pill-btn" data-models-refresh disabled=${busy} onClick=${control.refresh}>Refresh configuration</button>
		${!status && !value?.message && html`<p role="status">Reading native configuration…</p>`}
		${value?.message && html`<p role="status">${value.message}</p>`}
		<${Authentication} control=${control} />
		<section aria-label="Providers"><h2>Providers</h2><label>Search providers<input type="search" data-provider-search value=${query} onInput=${(event) => setQuery(event.currentTarget.value)} /></label>
			<div class="pocket-provider-list">${providers.map(
				(row) =>
					html`<section key=${row.id} data-provider=${row.id} class="pocket-provider-row">
						<h3>${row.name}</h3>
						<code>${row.id}</code>
						<p data-auth-configured=${String(row.configured)}>
							${row.configured ? "Configured" : "Authentication needed"}${row.source
								? " · " + row.source
								: ""}
						</p>
						<div class="pocket-form-actions">
							${row.methods.map(
								(method) =>
									html`<button
										type="button"
										class="pill-btn"
										key=${method.type}
										data-provider-login=${row.id + ":" + method.type}
										disabled=${busy || pendingAuth}
										onClick=${() => control.begin(row.id, method.type)}
									>
										${method.name}
									</button>`,
							)}
						</div>
						${!row.methods.length &&
						html`<p class="pocket-secondary">
							This provider uses ambient or externally managed authentication.
						</p>`}
					</section>`,
			)}</div>
			${status && !providers.length && html`<p>No matching providers.</p>`}
		</section>
	</div></${SettingsPage}>`;
}
