import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import { Button, Notice } from "@pakka/webui/components";
import { approvalCall } from "./client.js";
const html = htm.bind(h);

export function Approvals({ context }) {
	const [rows, setRows] = useState([]),
		[problem, setProblem] = useState(""),
		[busy, setBusy] = useState(null);
	useEffect(
		() =>
			context.subscribe(
				"list",
				{},
				(value) => {
					setRows(value.approvals);
					setProblem("");
				},
				{ intervalMs: 500 },
			),
		[context],
	);
	const decide = async (row, allow) => {
		if (busy || context.signal.aborted) return;
		setBusy(row.id);
		setProblem("");
		try {
			await approvalCall(context, "decide", { id: row.id, allow });
			const value = await approvalCall(context, "list");
			if (!context.signal.aborted) setRows(value.approvals);
		} catch (error) {
			if (!context.signal.aborted) setProblem(error.message);
		} finally {
			if (!context.signal.aborted) setBusy(null);
		}
	};
	return html`<section
		data-workspace-approvals
		style="padding:1rem;max-width:60rem;margin:auto;overflow-wrap:anywhere"
	>
		<header>
			<h2>Tool Approvals</h2>
			<p>Each decision applies to the exact pending tool and arguments below.</p>
		</header>
		${problem && html`<${Notice}>${problem}<//>`}
		${rows.length === 0 && html`<p>No approvals in this Conversation.</p>`}
		${rows.map(
			(row) =>
				html`<article
					key=${row.id}
					data-approval=${row.id}
					style="border:1px solid var(--border-color,#555);border-radius:.75rem;padding:1rem;margin:1rem 0"
				>
					<h3>${row.tool}</h3>
					<output data-approval-state>${row.state}</output>
					<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${row.argumentsText}</pre>
					<p>
						Requested ${new Date(row.createdAt).toLocaleTimeString()} · expires
						${new Date(row.expiresAt).toLocaleTimeString()}
					</p>
					${row.decidedBy && html`<small>Decision by ${row.decidedBy}</small>`}
					${row.state === "unknown" &&
					html`<${Notice}>Execution was not confirmed. A saved decision will not replay the tool.<//>`}
					${row.state === "pending" &&
					context.person.role === "admin" &&
					html`<div style="display:flex;gap:.5rem;margin-top:.75rem">
						<${Button}
							data-approval-allow
							disabled=${!!busy || Date.now() >= row.expiresAt}
							onClick=${() => decide(row, true)}
							>Allow once<//
						>
						<${Button}
							data-approval-deny
							disabled=${!!busy || Date.now() >= row.expiresAt}
							onClick=${() => decide(row, false)}
							>Deny<//
						>
					</div>`}
				</article>`,
		)}
	</section>`;
}
