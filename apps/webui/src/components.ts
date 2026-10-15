import { h, type ComponentChildren, type ButtonHTMLAttributes } from "preact";
/** Public content primitives. The product owns containers, focus, navigation and errors. */
export function Button({
	children,
	class: className,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly children?: ComponentChildren }) {
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
