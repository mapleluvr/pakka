// Pure part-description helpers for the transcript (no preact/htm import: node-testable).
// P0-2 contract: every part that passes protocol validation must reach a visible DOM
// result. The protocol accepts any `image/*` mimeType while only these render inline;
// everything else gets an explicit placeholder instead of a silent null.

const RENDERABLE_IMAGE = /^image\/(png|jpeg|webp|gif)$/i;

export function isRenderableImage(mimeType) {
	return typeof mimeType === "string" && RENDERABLE_IMAGE.test(mimeType);
}

// describePart(part) -> { kind, text?, mime?, name?, arguments?, type? }
// kind: "text" | "thinking" | "toolCall" | "image" | "unrenderable"
export function describePart(part) {
	if (!part || typeof part !== "object") return { kind: "unrenderable", type: "unknown" };
	switch (part.type) {
		case "text":
			return { kind: "text", text: typeof part.text === "string" ? part.text : "" };
		case "thinking":
			return { kind: "thinking", text: typeof part.thinking === "string" ? part.thinking : "" };
		case "toolCall":
			return {
				kind: "toolCall",
				name: typeof part.name === "string" ? part.name : "tool",
				arguments: part.arguments,
				...(typeof part.id === "string" ? { callId: part.id } : {}),
			};
		case "image":
			return isRenderableImage(part.mimeType)
				? { kind: "image", mime: part.mimeType, data: part.data }
				: {
						kind: "unrenderable",
						type: "image",
						mime: typeof part.mimeType === "string" ? part.mimeType : "unknown",
					};
		default:
			return {
				kind: "unrenderable",
				type: typeof part.type === "string" ? part.type : "unknown",
			};
	}
}
