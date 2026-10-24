import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import { PrivateCredentials } from "./credentials.js";
import { SettingsPage } from "./settings-page.js";
const html = htm.bind(h);

/** Settings contains usage and private credentials; model/cwd controls live in the conversation. */
export function Configuration({ target, client, close, error }) {
	const [value, setValue] = useState(null);
	useEffect(() => {
		let live = true;
		void client
			.request({ op: "configuration", target })
			.then((result) => {
				if (live) setValue(result.configuration);
			})
			.catch((failure) => {
				if (live) error(failure);
			});
		return () => {
			live = false;
		};
	}, [target.key, target.incarnation]);
	return html`<${SettingsPage} title="Conversation Settings" category="Workspace" closeLabel="Close settings" close=${close} description="Usage, session limits and your private credentials. Model and directory choices stay in the conversation."><div class="pocket-configuration settings-native">
 ${
		!value
			? html`<p role="status">Loading settings…</p>`
			: html`<p data-settings-model>
						${value.current?.model ?? value.choices.find((row) => row.id === value.ref.profile)?.model}
					</p>
					<section class="settings-card settings-data" aria-label="Conversation Usage">
						<h3>Conversation Usage</h3>
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
					html`<section
						class="settings-card settings-data"
						data-session-budget
						aria-label="Session Attempt Limits"
					>
						<h3>Session Attempt Limits</h3>
						<dl>
							<div>
								<dt>Primary attempts</dt>
								<dd>${value.session.budget.primaryAttempts} / ${value.session.limits.maxPrimaryAttempts}</dd>
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
					${value.session && html`<${PrivateCredentials} client=${client} error=${error} />`}`
 }
 </div></${SettingsPage}>`;
}
