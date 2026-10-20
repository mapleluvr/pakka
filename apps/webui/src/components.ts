import { h, type ComponentChildren, type ButtonHTMLAttributes } from "preact";

const iconPaths = {
	menu: ["M4 6h16M4 12h16M4 18h16"],
	search: ["M21 21l-5-5", "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"],
	panel: ["M4 4h16v16H4Z", "M9 4v16"],
	check: ["M5 12l4 4L19 6"],
	star: ["m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"],
	up: ["M12 20V4M5 11l7-7 7 7"],
	chevron: ["m7 10 5 5 5-5"],
	close: ["M6 6l12 12M18 6 6 18"],
	plus: ["M12 4v16M4 12h16"],
	reset: ["M3 10a9 9 0 1 1 2.4 8", "M3 4v6h6"],
	move: ["M12 3v18M3 12h18M9 6l3-3 3 3M18 9l3 3-3 3M15 18l-3 3-3-3M6 15l-3-3 3-3"],
	minus: ["M4 12h16"],
	conversation: ["M20 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z"],
	folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"],
	file: ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z", "M14 3v6h6"],
	thumbsUp: ["M7 10H3v11h4Z", "M7 10l4-8a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2.4l-1.5 7A3 3 0 0 1 16.6 21H7"],
	board: ["M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z"],
} as const;
export type IconName = keyof typeof iconPaths;

/** Decorative SVG; the containing control supplies its accessible name. */
export function Icon({ name }: { readonly name: IconName }) {
	return h(
		"svg",
		{
			class: "pocket-icon",
			viewBox: "0 0 24 24",
			width: 24,
			height: 24,
			fill: "none",
			stroke: "currentColor",
			"stroke-width": 2,
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
			"aria-hidden": "true",
			focusable: "false",
		},
		iconPaths[name].map((d) => h("path", { key: d, d })),
	);
}

/** Public content primitives. The product owns containers, focus, navigation and errors. */
export function Button({
	children,
	class: className,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	readonly children?: ComponentChildren;
	readonly [attribute: `data-${string}`]: string | number | boolean | undefined;
}) {
	return h(
		"button",
		{ type: "button", ...props, class: ["button", className].filter(Boolean).join(" ") },
		children,
	);
}
export function Field({
	label,
	children,
}: {
	readonly label: string;
	readonly children?: ComponentChildren;
}) {
	return h("label", { class: "pocket-extension-field" }, h("span", null, label), children);
}
export function Notice({ children }: { readonly children?: ComponentChildren }) {
	return h("p", { role: "status", class: "pocket-extension-status" }, children);
}
export function Stack({ children }: { readonly children?: ComponentChildren }) {
	return h("div", { class: "pocket-extension-stack" }, children);
}
