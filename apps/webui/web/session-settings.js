import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { SettingsPage } from "./settings-page.js";
const html = htm.bind(h);

/** Opening an original storage is not a replay of any Conversation request. */
export function useSessionRecovery(client, personId, refreshed, error) {
	const [, render] = useState(0);
	const context = useMemo(
		() => ({ alive: true, abort: new AbortController(), value: null }),
		[client, personId],
	);
	const latest = useRef(null);
	latest.current = { context, refreshed, error };
	const valid = () => context.alive && latest.current.context === context;
	const update = (value) => {
		if (!valid()) return;
		context.value = value;
		render((value) => value + 1);
	};
	useEffect(
		() => () => {
			context.alive = false;
			context.abort.abort();
		},
		[context],
	);
	const reportAuthority = (failure) => {
		if (valid() && ["UNAUTHORIZED", "FORBIDDEN"].includes(failure.code)) latest.current.error(failure);
	};
	async function readDirectory(value) {
		try {
			await latest.current.refreshed({ signal: context.abort.signal, canPublish: valid });
			if (!valid()) return;
			update({
				...value,
				pending: false,
				uncertain: false,
				needsRefresh: false,
				message: "Session status refreshed.",
			});
		} catch (failure) {
			if (!valid()) return;
			update({
				...value,
				pending: false,
				needsRefresh: true,
				message: "Session status could not be read. Read the current status before another opening attempt.",
			});
			reportAuthority(failure);
		}
	}
	return {
		value: context.value,
		open: async (sessionId) => {
			if (!personId || context.value?.pending || context.value?.uncertain || context.value?.needsRefresh)
				return;
			const value = {
				sessionId,
				requestId: crypto.randomUUID(),
				pending: true,
				uncertain: false,
				message: "Opening the original Session…",
			};
			update(value);
			let result;
			try {
				result = await client.request(
					{ op: "session.reopen", sessionId },
					{ requestId: value.requestId, signal: context.abort.signal },
				);
			} catch (failure) {
				if (!valid()) return;
				update({
					...value,
					pending: false,
					uncertain: failure.outcome !== "denied",
					message:
						failure.outcome === "denied"
							? "Opening was refused. Inspect Session status and permissions."
							: "Opening result unconfirmed. Read current Session status; do not resubmit the request.",
				});
				reportAuthority(failure);
				return;
			}
			if (!valid()) return;
			await readDirectory({ ...value, reportedStatus: result.session.status });
		},
		inspect: async () => {
			if (!personId || context.value?.pending) return;
			const value = { ...context.value, pending: true, message: "Reading current Session status…" };
			update(value);
			await readDirectory(value);
		},
	};
}
const guidance = (row) =>
	row.status === "unknown"
		? "Initialization was not confirmed. Inspect the original creation request; this view will not initialize or replace storage."
		: row.problem?.kind === "cleanup-unconfirmed"
			? "Writer cleanup is unconfirmed. Preserve the original storage and inspect ownership before restarting."
			: row.problem?.kind === "runtime-unavailable"
				? "This process retains the Runtime. Inspect its original requests and writer state; opening another writer is refused."
				: "The original storage could not be opened. Check its availability, integrity, permissions and writer ownership, then explicitly retry. No replacement storage will be created.";

export function SessionSettings({ control, sessions, close }) {
	const value = control.value;
	const locked = value?.pending || value?.uncertain || value?.needsRefresh;
	return html`<${SettingsPage} title="Sessions" category="Workspace" close=${close} description="Manage Session availability and reopen original storage.">
		<div class="pocket-session-recovery">
			<div class="settings-card settings-native-fields">
				<button type="button" class="pill-btn" data-session-refresh disabled=${value?.pending} onClick=${control.inspect}>Read current Session status</button>
				${value?.message && html`<p role="status">${value.message}</p>`}
				${
					value?.uncertain &&
					html`<section data-session-open-unknown role="alert">
						<p>Opening result unconfirmed</p>
						<code data-session-open-request translate="no">${value.requestId}</code>
						<p>Reading status does not resubmit this request or confirm who opened the Session.</p>
					</section>`
				}
				${value?.reportedStatus && html`<p>The opening response reported: ${value.reportedStatus}.</p>`}
			</div>
			${!sessions.length && html`<p>No managed Sessions yet. Use New Session to create one.</p>`}
			${sessions.map(
				(row) =>
					html`<section
						key=${row.id}
						class="settings-card settings-native-fields"
						aria-label=${row.name}
						data-session-recovery-row=${row.id}
					>
						<h2>${row.name}</h2>
						<p>
							Status:
							<span data-session-recovery-status
								>${row.status === "ready"
									? "Ready"
									: row.status === "unknown"
										? "Unconfirmed"
										: "Unavailable"}</span
							>
						</p>
						<p>Session: <code translate="no">${row.id}</code></p>
						${row.cwd && html`<p>Working directory: <code translate="no">${row.cwd}</code></p>`}
						${row.status !== "ready" && html`<p>${guidance(row)}</p>`}
						${row.problem?.canReopen &&
						html`<button
							type="button"
							class="pill-btn"
							data-session-reopen
							disabled=${locked}
							onClick=${() => control.open(row.id)}
						>
							${value?.pending &&
							value.sessionId === row.id &&
							html`<span class="pocket-session-opening"><${Icon} name="reset" /></span>`}Retry
							opening
						</button>`}
					</section>`,
			)}
		</div>
	</${SettingsPage}>`;
}
