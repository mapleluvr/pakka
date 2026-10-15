import { h } from "preact";
import { useState } from "preact/hooks";
import { Button, Stack, Notice } from "@pakka/webui/components";
export function Home({ context }) {
	const [count, setCount] = useState(0);
	return h(
		Stack,
		null,
		h("h2", null, "A GUI-only extension"),
		h("p", null, "No Conversation or model is required."),
		h("output", { "data-hello-count": "" }, count),
		h(Button, { "data-increment": "", onClick: () => setCount((value) => value + 1) }, "Increment"),
		h(Button, { "data-open-about": "", onClick: () => context.open("about") }, "About"),
	);
}
export function About() {
	return h(Notice, null, "Public interface in a host-owned Sheet.");
}
