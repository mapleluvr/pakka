// Adapts pi-pocket's hook setup, statistics and explicit rotation/removal to public extension slots.
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Button, Notice } from "@pakka/webui/components";
import { hooksCall } from "./client.js";
const html = htm.bind(h);
function savedRequest(key) {
	try {
		return sessionStorage.getItem(key) || null;
	} catch {
		return null;
	}
}
function Setup({ credentials, context, hide, disabled }) {
	const address =
		location.origin +
		"/pocket/ingress/workspace-hooks/hooks/" +
		credentials.id +
		(credentials.signed ? "" : "/" + credentials.secret);
	const copy = async (value, label) => {
		if (context.signal.aborted) return;
		try {
			await navigator.clipboard.writeText(value);
			if (!context.signal.aborted) context.notice(label + " copied.");
		} catch {
			if (!context.signal.aborted) context.notice("Copy failed. Select and copy the setup field.");
		}
	};
	return html`<div class="hook-setup" data-hook-private-setup>
		<label
			>Payload URL<input
				type="password"
				readonly
				value=${address}
				autocomplete="off"
				spellcheck="false"
				data-hook-address
		/></label>
		${credentials.signed &&
		html`<label
			>Signing secret<input
				type="password"
				readonly
				value=${credentials.secret}
				autocomplete="off"
				spellcheck="false"
				data-hook-secret
		/></label>`}
		<p class="hook-meta">
			${credentials.signed
				? "Set GitHub's Payload URL and Secret, choose application/json, then select events."
				: "Give the complete address to your sending service. The address authorizes input as you."}
		</p>
		<div class="hook-actions">
			<${Button} disabled=${disabled} onClick=${() => copy(address, "Address")}>Copy address<//>
			${credentials.signed &&
			html`<${Button} disabled=${disabled} onClick=${() => copy(credentials.secret, "Secret")}
				>Copy secret<//
			>`}
			<${Button} data-hook-hide-setup onClick=${hide}>Hide setup<//>
		</div>
	</div>`;
}
function HookRow({
	hook,
	canManage,
	disabled,
	setup,
	showSetup,
	hideSetup,
	showDeliveries,
	deliveries,
	confirm,
	context,
}) {
	return html`<article class="hook-row" data-hook-row=${hook.id} data-version=${hook.version}>
		<header>
			<strong>${hook.name}</strong
			><span class="hook-meta">${hook.signed ? "GitHub · signed" : "Another service · secret address"}</span>
		</header>
		${hook.instructions && html`<p class="hook-instructions">${hook.instructions}</p>`}
		<p class="hook-meta" data-hook-received>
			${`${hook.received} posts · Version ${hook.version}${hook.allowOutside ? " · Outside authors allowed" : ""}`}
		</p>
		${hook.lastReceivedAt &&
		html`<p class="hook-meta">${"Last post: " + new Date(hook.lastReceivedAt).toLocaleString()}</p>`}
		<div class="hook-actions">
			${canManage &&
			html`<${Button} data-hook-setup disabled=${disabled} onClick=${() => showSetup(hook.id)}>Show setup<//>
				<${Button}
					data-hook-rotate
					disabled=${disabled}
					onClick=${() =>
						confirm({ id: hook.id, expectedVersion: hook.version, action: "rotate", name: hook.name })}
					>New secret<//
				>
				<${Button}
					data-hook-remove
					disabled=${disabled}
					onClick=${() =>
						confirm({ id: hook.id, expectedVersion: hook.version, action: "remove", name: hook.name })}
					>Remove<//
				>`}
			<${Button} data-hook-deliveries disabled=${disabled} onClick=${() => showDeliveries(hook.id)}
				>Admission records<//
			>
			<${Button} disabled=${disabled} onClick=${() => context.navigate(context.target)}>Open conversation<//>
		</div>
		${setup?.id === hook.id &&
		html`<${Setup} credentials=${setup} context=${context} hide=${hideSetup} disabled=${disabled} />`}
		${deliveries?.id === hook.id &&
		html`<div class="hook-deliveries">
			<p class="hook-meta">
				These records report input admission. Follow the conversation for the work's current result.
			</p>
			${deliveries.rows.length === 0 && html`<p>No admission records yet.</p>`}
			${deliveries.rows.map(
				(row) =>
					html`<div class="hook-delivery" key=${row.id} data-hook-delivery=${row.id}>
						<strong>${row.result.state}</strong
						><span class="hook-meta">${new Date(row.receivedAt).toLocaleString()}</span>${row.result
							.receipt &&
						html`<code>${row.result.receipt.id}</code
							><span class="hook-meta">${"Admission: " + row.result.receipt.status}</span>`}
					</div>`,
			)}
		</div>`}
	</article>`;
}
export function Hooks({ context }) {
	const storageKey = "pakka.hooks.pending:" + context.person.id + ":" + JSON.stringify(context.target);
	const [data, setData] = useState(null),
		[name, setName] = useState(""),
		[instructions, setInstructions] = useState(""),
		[signed, setSigned] = useState(true),
		[allowOutside, setAllowOutside] = useState(false);
	const [setup, setSetup] = useState(null),
		[deliveries, setDeliveries] = useState(null),
		[confirmation, setConfirmation] = useState(null),
		[busy, setBusy] = useState(false),
		[problem, setProblem] = useState(""),
		[pending, setPending] = useState(() => savedRequest(storageKey));
	const acting = useRef(false);
	const remember = (id) => {
		try {
			if (id) sessionStorage.setItem(storageKey, id);
			else sessionStorage.removeItem(storageKey);
		} catch {}
		setPending(id);
	};
	const refresh = async () => {
		const value = await hooksCall(context, "read");
		if (!context.signal.aborted) setData(value);
	};
	useEffect(
		() =>
			context.subscribe(
				"read",
				{},
				(value) => {
					if (!context.signal.aborted) setData(value);
				},
				{ intervalMs: 400 },
			),
		[context],
	);
	useEffect(() => {
		if (setup && data && !data.hooks.some((row) => row.id === setup.id && row.version === setup.version))
			setSetup(null);
	}, [data, setup]);
	const change = async (action, input) => {
		if (acting.current || pending || context.signal.aborted) return;
		acting.current = true;
		setBusy(true);
		setProblem("");
		setSetup(null);
		setConfirmation(null);
		const requestId = crypto.randomUUID();
		remember(requestId);
		try {
			const result = await hooksCall(context, action, input, { requestId });
			if (context.signal.aborted) return;
			if (!result || !["done", "conflict"].includes(result.state))
				throw Error("The original webhook change remains unconfirmed.");
			remember(null);
			if (result.state === "conflict")
				setProblem("This webhook changed elsewhere. Read its current version before a new explicit change.");
			if (action === "create" && result.state === "done") {
				setName("");
				setInstructions("");
				setAllowOutside(false);
			}
			await refresh();
		} catch (error) {
			if (!context.signal.aborted) setProblem(error.message || "Webhook change unconfirmed");
		} finally {
			acting.current = false;
			if (!context.signal.aborted) setBusy(false);
		}
	};
	const read = async (action, input, accept) => {
		if (acting.current || context.signal.aborted) return;
		acting.current = true;
		setBusy(true);
		setProblem("");
		try {
			const value = await hooksCall(context, action, input);
			if (!context.signal.aborted) accept(value);
		} catch (error) {
			if (!context.signal.aborted) setProblem(error.message || "Webhook read unavailable");
		} finally {
			acting.current = false;
			if (!context.signal.aborted) setBusy(false);
		}
	};
	const reconcile = async () => {
		if (acting.current || !pending || context.signal.aborted) return;
		acting.current = true;
		setBusy(true);
		setProblem("");
		try {
			const operation = await context.operationByRequest(pending);
			if (context.signal.aborted) return;
			const value =
				operation.state === "done"
					? operation.value
					: await hooksCall(context, "operation", { requestId: operation.id });
			if (context.signal.aborted) return;
			if (!value || !["done", "conflict"].includes(value.state))
				throw Error("The original webhook change is still unconfirmed. It was not repeated.");
			remember(null);
			if (value.state === "conflict") setProblem("The original change conflicted with a newer version.");
			await refresh();
		} catch (error) {
			if (!context.signal.aborted) setProblem(error.message || "Original operation unavailable");
		} finally {
			acting.current = false;
			if (!context.signal.aborted) setBusy(false);
		}
	};
	const disabled = busy || !!pending;
	return html`<section class="workspace-hooks" data-workspace-hooks>
		<link rel="stylesheet" href=${new URL("./hooks.css", import.meta.url).href} />
		<h2>Webhooks</h2>
		<p>
			GitHub, a deploy or a monitor can post an event here. It becomes follow-up input in this conversation
			using the creator's current permissions.
		</p>
		${problem && html`<${Notice}>${problem}<//>`}
		${pending &&
		html`<${Notice}
			>A webhook change is awaiting confirmation. It will not be repeated.<${Button}
				data-hook-reconcile
				disabled=${busy}
				onClick=${reconcile}
				>Check original operation<//
			><//
		>`}
		${!data && html`<p>Loading webhooks…</p>`}
		${data &&
		!data.canManage &&
		html`<p class="hook-meta" data-hook-readonly>
			Read-only access. Hook setup requires the creator's current control permission.
		</p>`}
		${data?.canManage &&
		html`<div class="hook-compose">
			<label
				>Name<input
					data-hook-name
					maxlength="60"
					value=${name}
					disabled=${disabled}
					onInput=${(event) => setName(event.currentTarget.value)}
					placeholder="Deploys"
			/></label>
			<label
				>What to do with each post<textarea
					data-hook-instructions
					rows="3"
					maxlength="2000"
					value=${instructions}
					disabled=${disabled}
					onInput=${(event) => setInstructions(event.currentTarget.value)}
					placeholder="Describe a failure and suggest the next step."
				/>
			</label>
			<label class="hook-check"
				><input
					type="checkbox"
					data-hook-signed
					checked=${signed}
					disabled=${disabled}
					onChange=${(event) => setSigned(event.currentTarget.checked)}
				/>GitHub signed request</label
			>
			<p class="hook-meta">
				${signed
					? "GitHub gets an address and a separate signing key. The address alone cannot submit input."
					: "Another service gets a secret address. Anyone with it can submit input as the creator."}
			</p>
			${signed &&
			html`<label class="hook-check"
					><input
						type="checkbox"
						data-hook-outside
						checked=${allowOutside}
						disabled=${disabled}
						onChange=${(event) => setAllowOutside(event.currentTarget.checked)}
					/>Also accept issues, pull requests and comments from outside authors</label
				>
				<p class="hook-meta">
					${allowOutside
						? "Outside authors' text will reach the model as fenced data."
						: "Outside authors are filtered. Repository owners and the host-approved writer list are accepted."}
				</p>`}
			<${Button}
				data-hook-create
				disabled=${disabled || !name.trim()}
				onClick=${() =>
					change("create", { name, instructions, signed, allowOutside: signed && allowOutside })}
				>Make webhook<//
			>
		</div>`}
		${data &&
		html`<div class="hook-list">
			${data.hooks.length === 0 && html`<p>No webhooks visible in this conversation.</p>`}${data.hooks.map(
				(hook) =>
					html`<${HookRow}
						key=${hook.id}
						hook=${hook}
						canManage=${data.canManage}
						disabled=${disabled}
						setup=${setup}
						showSetup=${(id) => read("credentials", { id }, setSetup)}
						hideSetup=${() => setSetup(null)}
						showDeliveries=${(id) => read("deliveries", { id }, (rows) => setDeliveries({ id, rows }))}
						deliveries=${deliveries}
						confirm=${setConfirmation}
						context=${context}
					/>`,
			)}
		</div>`}
		${confirmation &&
		html`<div class="hook-confirm">
			<p>
				${confirmation.action === "rotate"
					? `Create a new secret for “${confirmation.name}”? The old key stops working. Update the sending service with the new setup.`
					: `Remove “${confirmation.name}”? New posts to its address stop reaching this conversation. Existing work and admission records are retained.`}
			</p>
			<div class="hook-actions">
				<${Button}
					data-hook-confirm
					disabled=${disabled}
					onClick=${() =>
						change(confirmation.action, {
							id: confirmation.id,
							expectedVersion: confirmation.expectedVersion,
						})}
					>${confirmation.action === "rotate" ? "Create new secret" : "Remove webhook"}<//
				><${Button} disabled=${disabled} onClick=${() => setConfirmation(null)}>Keep current setup<//>
			</div>
		</div>`}
		<p class="hook-meta">
			Up to 20 active hooks per person, 30 new posts per hook/hour and 5 MiB per post. Payload text is fitted
			to the conversation's input limit. Services must be able to reach this product's public address.
		</p>
	</section>`;
}
