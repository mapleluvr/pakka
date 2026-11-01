import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Field, Stack } from "@pakka/webui/components";
import { readPreference } from "./client.js";
export function Settings({ context }) {
	const [draft, setDraft] = useState(""),
		[saved, setSaved] = useState(""),
		[busy, setBusy] = useState(false),
		[message, setMessage] = useState("");
	const changes = useRef({ context, edited: false, saved: false });
	if (changes.current.context !== context) changes.current = { context, edited: false, saved: false };
	const current = changes.current;
	useEffect(() => {
		let active = true;
		readPreference(context)
			.then((value) => {
				if (active) {
					if (!current.edited) setDraft(value.text);
					if (!current.saved) setSaved(value.text);
				}
			})
			.catch(() => {
				if (active) setMessage("Setting is unavailable");
			});
		return () => {
			active = false;
		};
	}, [context]);
	const save = async () => {
		setBusy(true);
		try {
			const result = await context.call("save", { text: draft });
			if (result.state === "done") {
				current.saved = true;
				setSaved(result.value.text);
				setMessage("Saved");
			} else setMessage("Unconfirmed; check the operation before retrying.");
		} catch {
			setMessage("Setting was refused");
		} finally {
			if (!context.signal.aborted) setBusy(false);
		}
	};
	return h(
		Stack,
		null,
		h("p", null, "Scope: your private preference"),
		h(
			Field,
			{ label: "Example label" },
			h("input", {
				name: "exampleLabel",
				value: draft,
				onInput: (event) => {
					current.edited = true;
					setDraft(event.currentTarget.value);
				},
			}),
		),
		h(Button, { "data-save-label": "", disabled: busy, onClick: save }, "Save"),
		h("output", { "data-current-label": "" }, saved),
		h("p", { role: "status" }, message),
	);
}
