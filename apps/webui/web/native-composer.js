import { h } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import { Glyph, Menu } from "./frontend.js";
import { MicButton } from "./voice.js";
const html = htm.bind(h);

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
	const slash = draft.trimStart().startsWith("/");
	const disabled =
		(mode !== "chat" && !canInput && !slash) ||
		working ||
		!view ||
		(mode === "prompt" && view?.live.busy && !slash);
	const modes = [
		{ value: "prompt", label: "Prompt", allowed: canSend },
		{ value: "steer", label: "Steer", allowed: canDrive },
		{ value: "followUp", label: "Follow up", allowed: canDrive },
		{ value: "chat", label: "Team chat", allowed: true },
	];
	return html`<div class="conversation-composer">
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
							${canDrive &&
							view?.live.busy &&
							html`<button class="pill-btn" type="button" onClick=${abort}>Stop</button>`}
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
							<div class="send-group" data-empty=${disabled || !draft.trim()}>
								<button
									class="send-btn"
									data-action="send"
									type="submit"
									aria-label="Send"
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
