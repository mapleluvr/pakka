// Adapted from the pinned pi-pocket web/voice.js (MIT; see NOTICE.md).
// Recognition belongs to the browser. This module only edits a scoped, human-submitted draft.
import { h } from "preact";
import htm from "htm";
import { Icon } from "@pakka/webui/components";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

const html = htm.bind(h);
const Recognizer = () => globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
const ERRORS = {
	"not-allowed": "The microphone is blocked. Allow it for this site in the browser's settings.",
	"service-not-allowed": "This browser does not allow dictation here.",
	"no-speech": "No speech heard. Start dictation to try again.",
	"audio-capture": "No microphone found.",
	network: "Dictation needs a connection to the browser's speech provider.",
	"language-not-supported": "This browser cannot recognise your language.",
};
let current = null;

function common(a, b) {
	let head = 0,
		tail = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	while (tail < a.length && tail < b.length && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
	return { head, tail };
}
function join(before, words, after) {
	if (words === "") return { value: before + after, at: before.length };
	const start = /\S$/.test(before) ? " " : "",
		end = /^[^\s.,;:!?)\]]/.test(after) ? " " : "";
	const capital = before.trim() === "" || /[.!?]\s*$/.test(before);
	const said = capital ? words[0].toUpperCase() + words.slice(1) : words;
	const head = before + start + said;
	return { value: head + end + after, at: head.length };
}

export function useDictation(box, onText, { scope, enabled, notice }) {
	const [listening, setListening] = useState(false);
	const callbacks = useRef({ onText, notice }),
		live = useRef({ scope, enabled }),
		self = useRef(null);
	callbacks.current = { onText, notice };
	live.current = { scope, enabled };
	if (self.current === null) {
		self.current = {
			recognition: null,
			stop(drop = true) {
				const recognition = this.recognition;
				if (!recognition) return;
				this.recognition = null;
				if (current === this) current = null;
				setListening(false);
				recognition.onresult = null;
				recognition.onerror = null;
				recognition.onend = null;
				try {
					if (drop) recognition.abort();
					else recognition.stop();
				} catch {
					/* Already ended. */
				}
			},
			start() {
				const element = box.current,
					Recognition = Recognizer(),
					binding = live.current.scope;
				if (
					!live.current.enabled ||
					!element?.isConnected ||
					document.hidden ||
					globalThis.isSecureContext === false ||
					typeof Recognition !== "function"
				)
					return;
				current?.stop(true);
				current = this;
				let recognition;
				try {
					recognition = new Recognition();
				} catch {
					callbacks.current.notice("Dictation is unavailable in this browser.");
					current = null;
					return;
				}
				this.recognition = recognition;
				recognition.lang = navigator.language || "en-US";
				recognition.continuous = true;
				recognition.interimResults = true;
				const valid = () =>
					this.recognition === recognition &&
					live.current.scope === binding &&
					live.current.enabled &&
					element.isConnected &&
					!document.hidden;
				let base = null,
					from = 0,
					seen = 0,
					written = "",
					selection = [0, 0],
					pending = 0,
					span = [0, 0],
					moving = false;
				const focused = () => document.activeElement === element;
				const selected = () => [element.selectionStart, element.selectionEnd];
				const rebase = () => {
					const at = focused() ? element.selectionStart : element.value.length;
					const end = focused() ? element.selectionEnd : at;
					base = { before: element.value.slice(0, at), after: element.value.slice(end) };
					from = seen;
					moving = false;
				};
				rebase();
				written = element.value;
				selection = selected();
				const changed = () => {
					const value = element.value,
						[s, e] = span,
						{ head, tail } = common(written, value);
					const after = value === written || head >= e;
					const before = !after && written.length - tail <= s;
					if (pending >= seen || !(after || before)) {
						rebase();
						return;
					}
					const shift = before ? value.length - written.length : 0;
					base = { before: value.slice(0, s + shift), after: value.slice(e + shift) };
					from = pending;
					moving = true;
				};
				recognition.onresult = (event) => {
					if (!valid()) return;
					const results = event.results;
					if (
						element.value !== written ||
						(focused() && selected().some((at, index) => at !== selection[index]))
					)
						changed();
					let first = from;
					while (first < results.length && results[first].isFinal) first++;
					const said = (start, end) => {
						const words = [];
						for (let index = start; index < end; index++) words.push(results[index][0].transcript.trim());
						return words.filter(Boolean).join(" ");
					};
					const settled = said(from, first),
						coming = said(first, results.length),
						all = [settled, coming].filter(Boolean).join(" ");
					const { value, at } = join(base.before, all, base.after);
					if (value.length > 8192) {
						this.stop(true);
						callbacks.current.notice("Dictation reached the message limit. Review or shorten the draft.");
						return;
					}
					const start =
						settled === ""
							? base.before.length + (all !== "" && /\S$/.test(base.before) ? 1 : 0)
							: join(base.before, settled, base.after).at + (coming === "" ? 0 : 1);
					const was = element.value.length - base.after.length,
						now = value.length - base.after.length,
						person = selected();
					seen = results.length;
					pending = first;
					span = [start, at];
					written = value;
					element.value = value;
					if (focused()) {
						const place = (point) => (point >= was ? point + now - was : Math.min(point, now));
						if (moving) element.setSelectionRange(place(person[0]), place(person[1]));
						else element.setSelectionRange(at, at);
					}
					selection = selected();
					callbacks.current.onText(value);
					if (moving && first === results.length) rebase();
				};
				recognition.onerror = (event) => {
					if (!valid()) return;
					this.stop(true);
					if (event.error !== "aborted")
						callbacks.current.notice(
							ERRORS[event.error] ?? "Dictation stopped. Start it again to try once more.",
						);
				};
				recognition.onend = () => {
					if (this.recognition === recognition) this.stop(false);
				};
				try {
					recognition.start();
					if (this.recognition === recognition) setListening(true);
				} catch {
					this.stop(true);
					callbacks.current.notice("Dictation did not start. Check this site's microphone permission.");
				}
			},
			toggle() {
				if (this.recognition) this.stop(false);
				else this.start();
			},
		};
	}
	const dictation = self.current;
	useLayoutEffect(() => {
		if (!enabled) dictation.stop(true);
		return () => dictation.stop(true);
	}, [scope, enabled]);
	useEffect(() => {
		const hidden = () => {
			if (document.hidden) dictation.stop(true);
		};
		const shortcut = (event) => {
			if (
				!event.defaultPrevented &&
				!event.repeat &&
				event.altKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.shiftKey &&
				event.code === "KeyV" &&
				live.current.enabled &&
				box.current?.isConnected
			) {
				event.preventDefault();
				dictation.toggle();
			}
		};
		document.addEventListener("visibilitychange", hidden);
		window.addEventListener("keydown", shortcut);
		return () => {
			document.removeEventListener("visibilitychange", hidden);
			window.removeEventListener("keydown", shortcut);
			dictation.stop(true);
		};
	}, []);
	return {
		available: enabled && globalThis.isSecureContext !== false && typeof Recognizer() === "function",
		listening,
		toggle: () => dictation.toggle(),
		stop: () => dictation.stop(true),
	};
}

export function MicButton({ dictation }) {
	if (!dictation.available) return null;
	return html`<button
		type="button"
		class="pocket-dictate"
		data-dictate
		aria-label=${dictation.listening ? "Stop dictation" : "Dictate"}
		aria-pressed=${dictation.listening ? "true" : "false"}
		aria-describedby="pocket-dictation-help"
		title=${dictation.listening
			? "Stop dictation (Alt+V)"
			: "Dictate with your browser's speech service (Alt+V)"}
		onMouseDown=${(event) => event.preventDefault()}
		onClick=${dictation.toggle}
	>
		<${Icon} name=${dictation.listening ? "stop" : "microphone"} />
	</button>`;
}
