import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { PrivateCredentials } from "./credentials.js";
const html = htm.bind(h);

/** Human configuration only. The server supplies public choices; this component never constructs provider configuration. */
export function Configuration({ target, client, busy, applied, close, error }) {
	const [value, setValue] = useState(null),
		[profile, choose] = useState(target.profile);
	const [pending, setPending] = useState(false),
		[uncertain, setUncertain] = useState(false),
		[message, setMessage] = useState("");
	const binding = useRef(null),
		panel = useRef(null);
	useEffect(() => {
		const instance = {};
		binding.current = instance;
		const previousFocus = document.activeElement;
		panel.current?.querySelector("button")?.focus();
		void client
			.request({ op: "configuration", target })
			.then((result) => {
				if (binding.current !== instance) return;
				setValue(result.configuration);
				choose(result.configuration.ref.profile);
			})
			.catch((failure) => {
				if (binding.current === instance) error(failure);
			});
		return () => {
			binding.current = null;
			if (previousFocus?.isConnected) previousFocus.focus();
		};
	}, [target.key, target.incarnation, target.profile]);
	async function save(event) {
		event.preventDefault();
		if (pending || uncertain || !value?.canConfigure || busy || profile === target.profile) return;
		const instance = binding.current;
		setPending(true);
		setMessage("");
		try {
			const result = await client.request({ op: "configure", target, profile });
			if (binding.current === instance) await applied(result.ref);
		} catch (failure) {
			if (binding.current !== instance) return;
			if (failure.outcome === "unknown") {
				setUncertain(true);
				setMessage(
					"Configuration result is unconfirmed. Reload the workspace to inspect its current state before another change.",
				);
			} else error(failure);
		} finally {
			if (binding.current === instance) setPending(false);
		}
	}
	async function reconcile() {
		const instance = binding.current;
		setPending(true);
		try {
			const list = await client.request({ op: "list" });
			if (binding.current !== instance) return;
			const current = list.conversations.find(
				(ref) => ref.key === target.key && ref.sessionId === target.sessionId,
			);
			if (!current) {
				close();
				return;
			}
			await applied(current);
		} catch (failure) {
			if (binding.current === instance) error(failure);
		} finally {
			if (binding.current === instance) setPending(false);
		}
	}
	function keydown(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			return;
		}
		if (event.key !== "Tab") return;
		const items = [
			...panel.current.querySelectorAll(
				'button:not([disabled]),select:not([disabled]),input:not([disabled]),[tabindex="0"]',
			),
		];
		const first = items[0],
			last = items.at(-1);
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
	}
	return html`<div
		class="pocket-scrim"
		onClick=${(event) => {
			if (event.target === event.currentTarget) close();
		}}
	>
		<section
			class="pocket-sheet pocket-configuration"
			role="dialog"
			aria-modal="true"
			aria-label="Conversation settings"
			ref=${panel}
			onKeyDown=${keydown}
		>
			<header>
				<h2>Conversation settings</h2>
				<button class="pocket-icon-button" aria-label="Close settings" onClick=${close}>
					<${Icon} name="close" />
				</button>
			</header>
			<div class="pocket-sheet-body">
				${!value
					? html`<p role="status">Loading settings…</p>`
					: html`
							<form onSubmit=${save}>
								<label
									>Model configuration<select
										data-model-choice
										aria-label="Model configuration"
										disabled=${!value.canConfigure || pending || uncertain || busy}
										value=${profile}
										onChange=${(event) => choose(event.currentTarget.value)}
									>
										${value.choices.map(
											(choice) =>
												html`<option key=${choice.id} value=${choice.id}>
													${choice.id} · ${choice.model}
												</option>`,
										)}
									</select></label
								>
								<p class="pocket-secondary">
									Changing configuration applies the approved model, instructions and tools to the next
									request.
								</p>
								${busy &&
								html`<p role="status">Wait for the current work to finish before changing configuration.</p>`}
								${value.canConfigure &&
								html`<button
									class="button primary"
									data-save-configuration
									type="submit"
									disabled=${pending || uncertain || busy || profile === target.profile}
								>
									Apply configuration
								</button>`}
							</form>
							<section aria-label="Conversation usage">
								<h3>Conversation usage</h3>
								<dl>
									<div>
										<dt>Input tokens</dt>
										<dd>${value.usage.input.toLocaleString()}</dd>
									</div>
									<div>
										<dt>Output tokens</dt>
										<dd>${value.usage.output.toLocaleString()}</dd>
									</div>
									<div>
										<dt>Cached tokens</dt>
										<dd>${value.usage.cacheRead.toLocaleString()}</dd>
									</div>
									<div>
										<dt>Total tokens</dt>
										<dd>${value.usage.totalTokens.toLocaleString()}</dd>
									</div>
									<div>
										<dt>Cost</dt>
										<dd data-cost>
											${value.usage.cost === null ? "Unknown" : "$" + value.usage.cost.toFixed(4)}
										</dd>
									</div>
								</dl>
							</section>
							${value.session &&
							html`<section data-session-budget aria-label="Session attempt limits">
								<h3>Session attempt limits</h3>
								<dl>
									<div>
										<dt>Primary attempts</dt>
										<dd>
											${value.session.budget.primaryAttempts} / ${value.session.limits.maxPrimaryAttempts}
										</dd>
									</div>
									<div>
										<dt>Auxiliary attempts</dt>
										<dd>
											${value.session.budget.auxiliaryAttempts} / ${value.session.limits.maxAuxiliaryAttempts}
										</dd>
									</div>
									<div>
										<dt>Conversation limit</dt>
										<dd>${value.session.limits.maxConversations}</dd>
									</div>
								</dl>
								<p class="pocket-secondary">
									Reserved attempts remain counted after cancellation or an unconfirmed result.
								</p>
							</section>`}
							${value.session && html`<${PrivateCredentials} client=${client} error=${error} />`}
						`}
				${message && html`<p role="status">${message}</p>`}
				${uncertain &&
				html`<button class="button" data-reload-configuration onClick=${reconcile} disabled=${pending}>
					Reload workspace
				</button>`}
			</div>
		</section>
	</div>`;
}
