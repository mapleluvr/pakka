import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Glyph, Menu } from "./frontend.js";
import { MicButton } from "./voice.js";
const html = htm.bind(h);

// A disabled send button must say why. Four independent conditions collapse into one
// boolean in the shell; keep the boolean exactly as it was and add the reason channel.
export function submitState({ mode, canInput, slash, working, view }) {
	const readOnly = mode !== "chat" && !canInput && !slash;
	const busyPrompt = Boolean(view && mode === "prompt" && view.live.busy && !slash);
	const disabled = readOnly || Boolean(working) || !view || busyPrompt;
	const reason = !view
		? "no-view"
		: working
			? "working"
			: readOnly
				? "read-only"
				: busyPrompt
					? "busy-prompt"
					: null;
	return { disabled, reason };
}

const SUBMIT_HINTS = {
	"read-only": "View only: switch to Team chat to send a message.",
	working: "The previous message is still being submitted.",
	"busy-prompt": "This turn is generating: steer it, or wait for it to finish.",
	"no-view": "Connecting to the conversation…",
};

// Native semantics do not come from the visual Agent/Ask prototype.
export function NativeComposer({
	inputRef,
	draft,
	setDraft,
	mode,
	setMode,
	canSend,
	canDrive,
	canInput,
	working,
	view,
	send,
	abort,
	model,
	configureModel,
	canConfigure,
	dictation,
	suggestions,
	children,
}) {
	const [trigger, setTrigger] = useState(null);
	const [stopping, setStopping] = useState(false);
	const [stopRetry, setStopRetry] = useState(false);
	const stopRef = useRef(null);
	const latched = useRef(false);
	const latchedKeyboard = useRef(false);
	const slash = draft.trimStart().startsWith("/");
	const { disabled, reason } = submitState({ mode, canInput, slash, working, view });
	const busy = Boolean(view?.live.busy);
	const stopAvailable = Boolean(canDrive && busy);
	// Stopping is a UI latch, not an admission release: it clears only when the host reports
	// the turn is no longer busy, never because the abort request returned. A healthy abort
	// ends the turn in well under a frame, so this state is usually invisible — it exists for
	// the pathological case where the host keeps reporting busy. The bounded re-arm below is
	// what gives that case an exit; it is unreachable in the healthy path by design.
	useEffect(() => {
		if (!busy || !stopping || stopRetry) return;
		const timer = setTimeout(() => setStopRetry(true), 8000);
		return () => clearTimeout(timer);
	}, [busy, stopping, stopRetry]);
	useEffect(() => {
		if (busy) return;
		setStopping(false);
		setStopRetry(false);
		// Keyboard users must not lose their place when the Stop control disappears. A mouse
		// click must not steal focus into the textarea (that would pop the mobile keyboard).
		if (latched.current) {
			latched.current = false;
			if (latchedKeyboard.current && document.activeElement === document.body) inputRef?.current?.focus?.();
			latchedKeyboard.current = false;
		}
	}, [busy, inputRef]);
	const requestStop = () => {
		if (stopping && !stopRetry) return;
		latched.current = true;
		latchedKeyboard.current = Boolean(stopRef.current?.matches?.(":focus-visible"));
		setStopRetry(false);
		setStopping(true);
		abort();
	};
	const stopLabel = stopRetry ? "Stop again" : stopping ? "Stopping…" : "Stop";
	const stopState = stopping ? (stopRetry ? "retry" : "true") : "false";
	const stopButton = (className) =>
		html`<button
			ref=${stopRef}
			class=${className}
			data-action="stop"
			data-stopping=${stopState}
			type="button"
			aria-busy=${stopping ? "true" : "false"}
			disabled=${stopping && !stopRetry}
			onClick=${requestStop}
		>
			${stopLabel}
		</button>`;
	const modes = [
		{ value: "prompt", label: "Prompt", allowed: canSend },
		{ value: "steer", label: "Steer", allowed: canDrive },
		{ value: "followUp", label: "Follow up", allowed: canDrive },
		{ value: "chat", label: "Team chat", allowed: true },
	];
	return html`<div class="conversation-composer">
		${disabled &&
		reason &&
		html`<p
			id="submitHint"
			class="composer-annotation submit-hint"
			role="status"
			data-submit-hint
			data-reason=${reason}
		>
			${SUBMIT_HINTS[reason]}
		</p>`}
		<form class="composer-card compact" onSubmit=${send}>
			<div class="composer-surface">
				<div class="composer-body">
					<label class="sr-only" for="replyInput">Message</label>
					<div class="composer-editor">
						<textarea
							id="replyInput"
							ref=${inputRef}
							name="message"
							maxlength="8192"
							aria-label="Message"
							aria-describedby=${disabled && reason ? "submitHint" : undefined}
							rows="1"
							value=${draft}
							placeholder=${canSend ? "Reply to Pakka…" : "Read-only commands…"}
							onInput=${(e) => setDraft(e.currentTarget.value)}
						></textarea>
					</div>
					${slash && suggestions}
					<div class="composer-toolbar">
						<div class="toolbar-left">
							<span class="native-mode-label">${modes.find((row) => row.value === mode)?.label}</span>
							${stopAvailable && mode === "chat" && stopButton("pill-btn")}
						</div>
						<div class="toolbar-right">
							<button
								class="model-chip native-model-picker"
								type="button"
								aria-label=${"Model: " + (model ?? "Loading")}
								data-action="model"
								aria-haspopup="dialog"
								disabled=${!canConfigure}
								onClick=${configureModel}
							>
								<span class="native-model-name">${model ?? "Loading model…"}</span
								><span class="native-model-arrow"><${Glyph} name="chevron-down" /></span
								><span class="model-compact-icon"><${Glyph} name="gauge" /></span>
							</button>
							<${MicButton} dictation=${dictation} />
							<div class="send-group" data-empty=${!stopAvailable && (disabled || !draft.trim())}>
								${stopAvailable && mode !== "chat" && stopButton("stop-btn")}
								<button
									class="send-btn"
									data-action="send"
									type="submit"
									aria-label="Send"
									aria-describedby=${disabled && reason ? "submitHint" : undefined}
									disabled=${disabled}
								>
									<${Glyph} name="arrow-up" /></button
								><button
									class="send-caret"
									type="button"
									aria-label="Input mode"
									aria-haspopup="menu"
									aria-expanded=${Boolean(trigger)}
									onClick=${(e) => setTrigger(trigger ? null : e.currentTarget)}
								>
									<${Glyph} name="chevron-down" />
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</form>
		${dictation.available &&
		html`<p id="pocket-dictation-help" class="composer-annotation" data-dictation-help>
			Browser speech recognition is provided by this browser. Review the draft before sending.
		</p>`}
		${children}
		${trigger &&
		html`<${Menu} name="mode" trigger=${trigger} close=${() => setTrigger(null)}>${modes
			.filter((row) => row.allowed)
			.map(
				(row) =>
					html`<button
						class="menu-row"
						role="menuitemradio"
						aria-checked=${mode === row.value}
						data-input-mode=${row.value}
						onClick=${() => {
							setMode(row.value);
							setTrigger(null);
						}}
					>
						<span>${row.label}</span>${mode === row.value && html`<${Glyph} name="check" />`}
					</button>`,
			)}</${Menu}>`}
	</div>`;
}
