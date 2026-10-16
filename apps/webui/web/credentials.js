import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);

/** Dedicated human input: saved keys are never read, cached in browser storage or submitted as extension commands. */
export function PrivateCredentials({ client, error }) {
	const [value, setValue] = useState(null),
		[secret, setSecret] = useState("");
	const [pending, setPending] = useState(true),
		[uncertain, setUncertain] = useState(false),
		[message, setMessage] = useState("");
	const binding = useRef(null);
	useEffect(() => {
		const instance = { controller: new AbortController() };
		binding.current = instance;
		void load(instance);
		return () => {
			binding.current = null;
			instance.controller.abort();
		};
	}, [client]);
	async function load(instance) {
		setPending(true);
		try {
			const result = await client.request(
				{ op: "credential.status" },
				{ signal: instance.controller.signal },
			);
			if (binding.current !== instance) return;
			setValue(result.status);
			setUncertain(false);
			setMessage("");
		} catch (failure) {
			if (binding.current !== instance) return;
			if (failure.outcome === "unknown") {
				setUncertain(true);
				setMessage(
					"Provider configuration could not be confirmed. Read its current state before another change.",
				);
			} else error(failure);
		} finally {
			if (binding.current === instance) setPending(false);
		}
	}
	async function change(kind) {
		if (pending || uncertain || !value || (kind === "replace" && !secret)) return;
		const instance = binding.current;
		const input = {
			requestId: crypto.randomUUID(),
			expectedVersion: value.version,
			...(kind === "replace" ? { secret } : {}),
		};
		setSecret("");
		setPending(true);
		setMessage("");
		try {
			const result = await client.request(
				{ op: "credential." + kind, input },
				{ signal: instance.controller.signal },
			);
			if (binding.current !== instance) return;
			setValue(result.status);
			setMessage(
				kind === "replace"
					? "Provider key replaced."
					: "Provider key cleared. New model requests are blocked until a replacement is saved.",
			);
		} catch (failure) {
			if (binding.current !== instance) return;
			if (failure.outcome === "unknown" || failure.code === "CONFLICT") {
				setUncertain(true);
				setMessage(
					"Provider configuration result is unconfirmed or has changed. Read its current state before another explicit change.",
				);
			} else error(failure);
		} finally {
			if (binding.current === instance) setPending(false);
		}
	}
	return html`<section aria-label="Private provider configuration">
		<h3>Private provider key</h3>
		<p class="pocket-secondary">
			The key applies to new model requests in this Session. Saved keys are never displayed. Only global
			administrators can replace or clear it.
		</p>
		${value &&
		html`<p
			role="status"
			data-credential-status
			data-version=${value.version}
			data-configured=${String(value.configured)}
		>
			${value.configured ? "Configured" : "Not configured"} · revision ${value.version}
		</p>`}
		<form
			onSubmit=${(event) => {
				event.preventDefault();
				void change("replace");
			}}
		>
			<label
				>Replacement key<input
					data-credential-input
					aria-label="Replacement provider key"
					type="password"
					autocomplete="new-password"
					autocapitalize="none"
					spellcheck=${false}
					maxlength="4096"
					disabled=${pending || uncertain || !value}
					value=${secret}
					onInput=${(event) => setSecret(event.currentTarget.value)}
			/></label>
			<button
				class="button"
				data-credential-replace
				type="submit"
				disabled=${pending || uncertain || !value || !secret}
			>
				Replace provider key
			</button>
			<button
				class="button"
				data-credential-clear
				type="button"
				disabled=${pending || uncertain || !value?.configured}
				onClick=${() => void change("clear")}
			>
				Clear provider key
			</button>
		</form>
		${message && html`<p role="status">${message}</p>`}
		${uncertain &&
		html`<button
			class="button"
			data-credential-reload
			disabled=${pending}
			onClick=${() => void load(binding.current)}
		>
			Read current configuration
		</button>`}
	</section>`;
}
