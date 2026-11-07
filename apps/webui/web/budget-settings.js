import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { SettingsPage } from "./settings-page.js";
const html = htm.bind(h);
const fields = [
	{ key: "maxPrimaryAttempts", label: "Primary requests" },
	{ key: "maxAuxiliaryAttempts", label: "Auxiliary requests" },
	{ key: "maxConversations", label: "Conversation creations" },
];
const validLimit = (value) => /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
function matches(receipt, attempt) {
	return (
		receipt?.source === "management" &&
		receipt.requestId === attempt.requestId &&
		receipt.version === attempt.expectedVersion + 1 &&
		fields.every((field) => receipt.after?.[field.key] === attempt.limits[field.key])
	);
}

/** The original request outlives its settings page; visibility is not settlement. */
export function useBudgetSettings(client, error) {
	const [state, setState] = useState(null),
		binding = useRef(null);
	if (binding.current?.client !== client)
		binding.current = { client, pending: false, controller: new AbortController(), value: { client } };
	const context = binding.current;
	useEffect(() => () => context.controller.abort(), [client]);
	const live = () => binding.current === context && !context.controller.signal.aborted;
	function update(patch) {
		if (!live()) return;
		context.value = { ...context.value, ...patch };
		setState(context.value);
	}
	const request = (command, options = {}) =>
		client.request(command, { ...options, signal: context.controller.signal });
	async function run(work) {
		if (!client || context.pending || !live()) return;
		context.pending = true;
		update({ pending: true, message: "" });
		try {
			await work();
		} catch (failure) {
			update({ message: "The budget could not be confirmed. Read it again when the Session is available." });
			if (live() && ["UNAUTHORIZED", "FORBIDDEN"].includes(failure.code)) error(failure);
		} finally {
			context.pending = false;
			update({ pending: false });
		}
	}
	async function readState(sessionId) {
		const { policy } = await request({ op: "budget.read", sessionId });
		// Anchor the audit page to the policy read, even if another owner updates it meanwhile.
		const beforeVersion = policy.version < Number.MAX_SAFE_INTEGER ? policy.version + 1 : undefined;
		const { page } = await request({ op: "budget.history", sessionId, beforeVersion, limit: 20 });
		update({
			sessionId,
			policy,
			history: page.items,
			nextBeforeVersion: page.nextBeforeVersion,
			limits: { ...policy.limits },
			reason: "",
			denied: false,
			needsRefresh: false,
		});
	}
	async function confirmed(receipt, attempt) {
		if (!matches(receipt, attempt)) {
			update({
				uncertain: true,
				message: "No matching committed receipt is available. The original change remains unconfirmed.",
			});
			return;
		}
		update({ receipt, original: null, uncertain: false, denied: false, needsRefresh: true });
		// A later read failure must not undo a confirmed mutation receipt.
		await readState(attempt.sessionId);
	}
	return {
		value: state?.client === client ? state : null,
		load: (sessionId) =>
			run(async () => {
				if (context.value.uncertain) return;
				update({ sessionId, policy: null, receipt: null, original: null, history: [] });
				await readState(sessionId);
			}),
		refresh: () =>
			run(async () => {
				if (!context.value.sessionId || context.value.uncertain) return;
				await readState(context.value.sessionId);
			}),
		field: (name, input) => {
			if (context.pending || context.value.uncertain) return;
			if (name === "reason") update({ reason: input });
			else if (fields.some((field) => field.key === name))
				update({ limits: { ...context.value.limits, [name]: input } });
		},
		apply: () =>
			run(async () => {
				const value = context.value;
				if (!value.policy || value.uncertain || value.needsRefresh) return;
				const reason = value.reason?.trim();
				if (
					!fields.every((field) => validLimit(value.limits[field.key])) ||
					!reason ||
					reason.length > 512 ||
					/[\x00-\x1f\x7f]/.test(reason)
				) {
					update({ message: "Enter positive whole-number limits and a short reason." });
					return;
				}
				const attempt = {
					sessionId: value.sessionId,
					requestId: crypto.randomUUID(),
					expectedVersion: value.policy.version,
					limits: Object.fromEntries(fields.map((field) => [field.key, Number(value.limits[field.key])])),
					reason,
				};
				update({ original: attempt, receipt: null, denied: false });
				let result;
				try {
					const { requestId, ...command } = attempt;
					result = await request({ op: "budget.change", ...command }, { requestId });
				} catch (failure) {
					if (failure.outcome === "denied")
						update({
							original: null,
							denied: true,
							needsRefresh: true,
							message: "This change was refused. Read the current policy before submitting a new change.",
						});
					else
						update({
							uncertain: true,
							message: "The result is unconfirmed. Inspect the original request; it will not be resent.",
						});
					if (live() && ["UNAUTHORIZED", "FORBIDDEN"].includes(failure.code)) error(failure);
					return;
				}
				await confirmed(result.receipt, attempt);
			}),
		inspect: () =>
			run(async () => {
				const attempt = context.value.original;
				if (!attempt) return;
				const result = await request({
					op: "budget.receipt",
					sessionId: attempt.sessionId,
					originalRequestId: attempt.requestId,
				});
				await confirmed(result.receipt, attempt);
			}),
		more: () =>
			run(async () => {
				const value = context.value;
				if (value.nextBeforeVersion === undefined) return;
				const { page } = await request({
					op: "budget.history",
					sessionId: value.sessionId,
					beforeVersion: value.nextBeforeVersion,
					limit: 20,
				});
				update({ history: [...value.history, ...page.items], nextBeforeVersion: page.nextBeforeVersion });
			}),
	};
}
export function BudgetSettings({ control, sessions, workspaceSessionId, defaultSessionId, close }) {
	const value = control.value,
		policy = value?.policy;
	useEffect(() => {
		if (!value?.sessionId && defaultSessionId) void control.load(defaultSessionId);
	}, [defaultSessionId]);
	const locked = value?.pending || value?.uncertain,
		ready = sessions.filter((row) => row.status === "ready");
	// The control Session owns real policy even before it hosts a user Conversation.
	if (workspaceSessionId && !ready.some((row) => row.id === workspaceSessionId))
		ready.unshift({ id: workspaceSessionId, name: "Workspace Session" });
	return html`<${SettingsPage} title="Session Budget" category="Workspace" close=${close} description="Session-wide limits. Raising a limit preserves all consumed and reserved work.">
		<div class="settings-card settings-native-fields">
			<label>Session<select data-budget-session aria-label="Budget Session" value=${value?.sessionId ?? defaultSessionId} disabled=${locked} onChange=${(event) => control.load(event.currentTarget.value)}>
				${ready.map((row) => html`<option key=${row.id} value=${row.id}>${row.name}</option>`)}
			</select></label>
			<button type="button" class="pill-btn" data-budget-refresh disabled=${locked} onClick=${control.refresh}>Read current budget</button>
			${!policy && value?.pending && html`<p role="status">Reading budget…</p>`}
			${
				policy &&
				html`<section class="settings-data" aria-label="Consumed budget">
						<p>Policy version <span data-budget-version>${policy.version}</span></p>
						<dl>
							<div>
								<dt>Primary requests</dt>
								<dd>
									<span data-budget-primary-spent>${policy.budget.primaryAttempts}</span> /
									${policy.limits.maxPrimaryAttempts}
								</dd>
							</div>
							<div>
								<dt>Auxiliary requests</dt>
								<dd>${policy.budget.auxiliaryAttempts} / ${policy.limits.maxAuxiliaryAttempts}</dd>
							</div>
							<div>
								<dt>Conversation creations</dt>
								<dd>${policy.conversationCount} / ${policy.limits.maxConversations}</dd>
							</div>
						</dl>
					</section>
					<form
						class="pocket-form"
						onSubmit=${(event) => {
							event.preventDefault();
							void control.apply();
						}}
					>
						${fields.map(
							(field) =>
								html`<label key=${field.key}
									>${field.label}<input
										type="number"
										name=${field.key}
										inputmode="numeric"
										min="1"
										step="1"
										max=${Number.MAX_SAFE_INTEGER}
										required
										value=${value.limits[field.key]}
										disabled=${locked}
										onInput=${(event) => control.field(field.key, event.currentTarget.value)}
								/></label>`,
						)}
						<label
							>Reason<input
								name="budgetReason"
								maxlength="512"
								autocomplete="off"
								required
								value=${value.reason}
								disabled=${locked}
								onInput=${(event) => control.field("reason", event.currentTarget.value)}
						/></label>
						<button
							type="submit"
							class="button primary"
							data-budget-apply
							disabled=${locked || value.needsRefresh}
						>
							Save limits
						</button>
					</form>`
			}
			${value?.message && html`<p role="status">${value.message}</p>`}
			${value?.denied && html`<p data-budget-denied role="status">Not applied. Review the current policy.</p>`}
			${
				value?.uncertain &&
				html`<section data-budget-unconfirmed role="alert">
					<p>Change unconfirmed</p>
					<code data-budget-original-request>${value.original.requestId}</code>
					<p>
						<button
							type="button"
							class="pill-btn"
							data-budget-inspect
							disabled=${value.pending}
							onClick=${control.inspect}
						>
							Inspect original request
						</button>
					</p>
				</section>`
			}
			${value?.receipt && html`<p data-budget-saved role="status">Limits saved at policy version ${value.receipt.version}. Request <code>${value.receipt.requestId}</code>.</p>`}
			${
				policy &&
				html`<section aria-label="Budget history">
					<h2>Change history</h2>
					${!value.history?.length && html`<p>No policy changes.</p>`}
					${value.history?.map(
						(row) =>
							html`<details key=${row.version}>
								<summary class="pocket-disclosure">
									<${Icon} name="chevron" />Version ${row.version} · ${new Date(row.at).toLocaleString()}
								</summary>
								<p>${row.reason}</p>
								<p>Actor: <code>${row.actorId}</code> · Request: <code>${row.requestId}</code></p>
								<dl>
									${fields.map(
										(field) =>
											html`<div key=${field.key}>
												<dt>${field.label}</dt>
												<dd>${row.before[field.key]} to ${row.after[field.key]}</dd>
											</div>`,
									)}
								</dl>
							</details>`,
					)}
					${value.nextBeforeVersion !== undefined &&
					html`<button type="button" class="pill-btn" disabled=${value.pending} onClick=${control.more}>
						Earlier changes
					</button>`}
				</section>`
			}
		</div>
	</${SettingsPage}>`;
}
