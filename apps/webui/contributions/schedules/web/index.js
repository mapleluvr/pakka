import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import { Button, Notice } from "@pakka/webui/components";
import { scheduleCall } from "./client.js";
const html = htm.bind(h);
function savedRequest(key) {
	try {
		return sessionStorage.getItem(key) || null;
	} catch {
		return null;
	}
}

export function Schedules({ context }) {
	const storageKey = "pakka.schedule.pending:" + context.person.id + ":" + JSON.stringify(context.target);
	const [rows, setRows] = useState([]),
		[text, setText] = useState(""),
		[delay, setDelay] = useState("30"),
		[runs, setRuns] = useState("1"),
		[interval, setInterval] = useState("60"),
		[busy, setBusy] = useState(false),
		[problem, setProblem] = useState(""),
		[pending, setPending] = useState(() => savedRequest(storageKey));
	const writable = ["admin", "driver"].includes(context.person.role);
	const remember = (id) => {
		try {
			if (id) sessionStorage.setItem(storageKey, id);
			else sessionStorage.removeItem(storageKey);
		} catch {}
		setPending(id);
	};
	const refresh = async () => {
		const value = await scheduleCall(context, "list");
		if (!context.signal.aborted) setRows(value.schedules);
	};
	useEffect(
		() => context.subscribe("list", {}, (value) => setRows(value.schedules), { intervalMs: 400 }),
		[context],
	);
	const change = async (action, input) => {
		if (busy || pending || context.signal.aborted) return;
		const requestId = crypto.randomUUID();
		remember(requestId);
		setBusy(true);
		setProblem("");
		try {
			const value = await scheduleCall(context, action, input, { requestId });
			if (context.signal.aborted) return;
			if (value.state === "unknown")
				throw Error(
					"The native schedule outcome is unknown. Read the original operation; no input will be replayed.",
				);
			remember(null);
			if (action === "add") setText("");
			await refresh();
		} catch (error) {
			if (!context.signal.aborted) setProblem(error.message || "Schedule result unknown");
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	const add = () => {
		const seconds = Number(delay),
			count = Number(runs),
			every = Number(interval);
		if (
			!text.trim() ||
			text.length > 8192 ||
			!Number.isSafeInteger(seconds) ||
			seconds < 1 ||
			seconds > 366 * 86400 ||
			!Number.isSafeInteger(count) ||
			count < 1 ||
			count > 32 ||
			(count > 1 && (!Number.isSafeInteger(every) || every < 1 || every > 366 * 86400))
		) {
			setProblem("Use bounded text, a positive whole-second delay, and 1–32 runs.");
			return;
		}
		void change("add", {
			text,
			dueAt: Date.now() + seconds * 1000,
			...(count > 1 ? { intervalMs: every * 1000, maxRuns: count } : {}),
		});
	};
	const reconcile = async () => {
		if (!pending || busy || context.signal.aborted) return;
		setBusy(true);
		setProblem("");
		try {
			const value = await context.operationByRequest(pending);
			if (context.signal.aborted) return;
			if (value.state !== "done" || !value.value || value.value.state === "unknown")
				throw Error("The original native schedule is still unknown. No work was replayed.");
			remember(null);
			await refresh();
		} catch (error) {
			if (!context.signal.aborted) setProblem(error.message || "Original operation unavailable");
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	return html`<section data-workspace-schedules class="workspace-schedules">
		<link rel="stylesheet" href=${new URL("./schedules.css", import.meta.url).href} />
		<header>
			<h2>Scheduled Inputs</h2>
			<p>
				Native durable work, not a page timer. Each occurrence rechecks the creator and current driver before
				native follow-up admission.
			</p>
		</header>
		${problem && html`<${Notice}>${problem}<//>`}
		${pending &&
		html`<${Notice}
			>An operation is awaiting confirmation. It will not be replayed.<${Button}
				data-schedule-reconcile
				disabled=${busy}
				onClick=${reconcile}
				>Check original operation<//
			><//
		>`}
		${writable &&
		html`<div class="schedule-compose">
			<label
				>Input<textarea
					data-schedule-text
					value=${text}
					maxlength="8192"
					disabled=${busy || !!pending}
					onInput=${(event) => setText(event.currentTarget.value)}
				/>
			</label>
			<div class="schedule-fields">
				<label
					>Delay (seconds)<input
						data-schedule-delay
						type="number"
						min="1"
						max="31622400"
						value=${delay}
						onInput=${(event) => setDelay(event.currentTarget.value)}
				/></label>
				<label
					>Runs<input
						data-schedule-runs
						type="number"
						min="1"
						max="32"
						value=${runs}
						onInput=${(event) => setRuns(event.currentTarget.value)}
				/></label>
				${Number(runs) > 1 &&
				html`<label
					>Interval (seconds)<input
						data-schedule-interval
						type="number"
						min="1"
						value=${interval}
						onInput=${(event) => setInterval(event.currentTarget.value)}
				/></label>`}
			</div>
			<${Button} data-schedule-add disabled=${busy || !!pending || !text.trim()} onClick=${add}
				>Schedule input<//
			>
		</div>`}
		<p class="schedule-hint">
			Done means this job admitted its planned input(s), not that the model finished answering. Inspect the
			Conversation for the model result. Cancelling cannot roll back an already admitted input.
		</p>
		${rows.length === 0 && html`<p>No scheduled inputs in this Conversation.</p>`}
		${rows.map(
			(row) =>
				html`<article key=${row.id} data-schedule=${row.id} class="schedule-row">
					<header><strong>${row.actorName}</strong><output data-schedule-state>${row.state}</output></header>
					<pre>${row.text}</pre>
					<p>
						${`Due ${new Date(row.dueAt).toLocaleString()} · ${row.completed}/${row.maxRuns} admitted${row.intervalMs ? " · every " + row.intervalMs / 1000 + "s" : ""}`}
					</p>
					${row.deliveryId && html`<small>Native admission: ${row.deliveryId}</small>`}
					${row.nativeTerminal && html`<small>Native terminal: ${row.nativeTerminal}</small>`}
					${row.state === "unknown" &&
					html`<${Notice}
						>The execution result is not confirmed. Reading this row does not resume or repeat its handler.<//
					>`}
					${writable &&
					["waiting", "running", "unknown"].includes(row.state) &&
					html`<${Button}
						data-schedule-cancel
						disabled=${busy || !!pending}
						onClick=${() => change("cancel", { id: row.id })}
						>Cancel native job<//
					>`}
				</article>`,
		)}
	</section>`;
}
