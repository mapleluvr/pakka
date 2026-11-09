import type { EntryHeader } from "@earendil-works/pi-durable";
import { hash } from "./artifact-journal.ts";
import type { EntryJsonIndex, EntryContentSpan } from "./entry-preview.ts";
import type {
	ConversationContentReference,
	ConversationRef,
	ConversationSnapshot,
	JsonObject,
	JsonValue,
	TranscriptMessage,
} from "./types.ts";

export type PreviewContent = {
	readonly reference: ConversationContentReference;
	readonly span: EntryContentSpan;
};
export type IndexedConversationEntry = {
	readonly header: EntryHeader;
	readonly entry: ConversationSnapshot["entries"][number];
	readonly contents: ReadonlyMap<string, PreviewContent>;
};
const object = (value: unknown): value is JsonObject =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";

/** Traverse a bounded live prefix; never stringify the complete in-flight argument object. */
export function previewLiveArguments<T extends JsonObject>(value: T): T | { readonly preview: string } {
	const parts: string[] = [];
	let remaining = 1920,
		nodes = 0,
		clipped = false,
		stopped = false;
	const emit = (part: string) => {
		if (stopped) return;
		const size = Buffer.byteLength(part, "utf8");
		if (size > remaining) {
			clipped = true;
			stopped = true;
			return;
		}
		parts.push(part);
		remaining -= size;
	};
	const quote = (input: string) => {
		if (input.length <= 256) return JSON.stringify(input);
		clipped = true;
		return JSON.stringify(input.slice(0, 128) + "\n… [live preview] …\n" + input.slice(-128));
	};
	const visit = (current: JsonValue, depth: number) => {
		if (stopped) return;
		if (++nodes > 64 || depth > 6) {
			clipped = true;
			emit('"[preview]"');
			return;
		}
		if (current === null) {
			emit("null");
			return;
		}
		if (typeof current === "string") {
			emit(quote(current));
			return;
		}
		if (typeof current === "number" || typeof current === "boolean") {
			emit(String(current));
			return;
		}
		if (Array.isArray(current)) {
			emit("[");
			for (let at = 0; at < current.length && !stopped; at++) {
				if (nodes >= 64) {
					clipped = true;
					break;
				}
				if (at) emit(",");
				visit(current[at]!, depth + 1);
			}
			emit("]");
			return;
		}
		if (object(current)) {
			emit("{");
			let count = 0;
			for (const key in current) {
				if (!Object.hasOwn(current, key)) continue;
				if (stopped || nodes >= 64) {
					clipped = true;
					break;
				}
				if (count++) emit(",");
				emit(quote(key));
				emit(":");
				if (!stopped) visit(current[key]!, depth + 1);
			}
			emit("}");
			return;
		}
		throw new Error("Invalid live argument value");
	};
	visit(value, 0);
	return clipped
		? { preview: parts.join("") + "\n[Live arguments preview; original references appear after publication]" }
		: value;
}

/** Only user-facing model parts produce references. Native data/configuration never becomes a content endpoint. */
export function projectConversationEntry(
	index: EntryJsonIndex,
	header: EntryHeader,
	ref: ConversationRef,
): IndexedConversationEntry {
	const raw = index.value;
	if (
		!object(raw) ||
		raw.id !== Number(header.id) ||
		raw.conversationId !== Number(header.conversationId) ||
		!text(raw.kind)
	)
		throw new Error("Entry preview identity does not match the original header");
	const spans = new Map(index.spans.map((span) => [span.path, span]));
	const contents = new Map<string, PreviewContent>();
	const reference = (
		path: string,
		encoding: ConversationContentReference["encoding"],
	): ConversationContentReference => {
		const span = spans.get(path);
		if (!span) throw new Error("Entry preview original content span is missing");
		const body = {
			source: "entry" as const,
			entryId: String(header.id),
			revision: String(header.commitSeq),
			path,
			encoding,
			byteLength: span.byteLength,
			previewComplete:
				encoding !== "base64" &&
				!index.truncated.some((value) => value === path || value.startsWith(path + "/")),
		};
		// Owner attribution may be redacted by the product without exposing it through a guessable hash.
		const value = { id: hash(body), ...body, sourceConversationId: String(header.conversationId) };
		contents.set(value.id, { reference: value, span });
		return value;
	};
	const message = (value: JsonValue | undefined, at: number): TranscriptMessage | undefined => {
		if (!object(value) || !["user", "assistant", "toolResult"].includes(String(value.role))) return undefined;
		const base = "/model/" + at;
		let content: TranscriptMessage["content"];
		let contentReference: ConversationContentReference | undefined;
		if (text(value.content)) {
			content = value.content;
			if (index.truncated.includes(base + "/content") || value.role === "toolResult")
				contentReference = reference(base + "/content", "text");
		} else if (Array.isArray(value.content)) {
			content = value.content.map((part, partAt) => {
				if (!object(part)) throw new Error("Invalid native entry content part");
				const location = base + "/content/" + partAt;
				switch (part.type) {
					case "text":
						if (!text(part.text)) throw new Error("Invalid entry text part");
						return {
							type: "text",
							text: part.text,
							...(value.role === "toolResult" || index.truncated.includes(location + "/text")
								? { contentReference: reference(location + "/text", "text") }
								: {}),
						};
					case "thinking":
						if (!text(part.thinking)) throw new Error("Invalid entry thinking part");
						return {
							type: "thinking",
							thinking: part.thinking,
							contentReference: reference(location + "/thinking", "text"),
						};
					case "image":
						if (!text(part.data) || !text(part.mimeType)) throw new Error("Invalid entry image part");
						return {
							type: "image",
							data: "",
							mimeType: part.mimeType,
							contentReference: reference(location + "/data", "base64"),
						};
					case "toolCall":
						if (!text(part.id) || !text(part.name) || !object(part.arguments))
							throw new Error("Invalid entry tool call part");
						return {
							type: "toolCall",
							id: part.id,
							name: part.name,
							arguments: part.arguments,
							contentReference: reference(location + "/arguments", "json"),
						};
					default:
						throw new Error("Unsupported native preview content part");
				}
			});
		} else throw new Error("Invalid native entry message content");
		const role = value.role;
		if (
			role === "toolResult" &&
			(!text(value.toolCallId) || !text(value.toolName) || typeof value.isError !== "boolean")
		)
			throw new Error("Invalid native tool result identity");
		if (role !== "user" && role !== "assistant" && role !== "toolResult") return undefined;
		const assistant = role === "assistant";
		const result: TranscriptMessage = {
			role,
			content,
			...(contentReference ? { contentReference } : {}),
			...(assistant && text(value.stopReason) && value.stopReason !== "pending"
				? { stopReason: value.stopReason }
				: {}),
			...(assistant && text(value.errorMessage)
				? {
						errorMessage: value.errorMessage,
						...(index.truncated.includes(base + "/errorMessage")
							? { errorReference: reference(base + "/errorMessage", "text") }
							: {}),
					}
				: {}),
			...(role === "toolResult"
				? {
						toolCallId: String(value.toolCallId),
						toolName: String(value.toolName),
						isError: value.isError === true,
					}
				: {}),
		};
		return result;
	};
	const messages = Array.isArray(raw.model)
		? raw.model.flatMap((item, at) => {
				const value = message(item, at);
				return value ? [value] : [];
			})
		: [];
	const display = raw.kind === "pakka.display" && object(raw.data) ? raw.data : undefined;
	const entry: ConversationSnapshot["entries"][number] = {
		id: String(header.id),
		conversationId: ref.conversationId,
		...(String(header.conversationId) !== ref.conversationId
			? { sourceConversationId: String(header.conversationId) }
			: {}),
		kind: raw.kind,
		...(raw.byTaskId === undefined ? {} : { taskId: String(raw.byTaskId) }),
		messages,
		...(display &&
		text(display.namespace) &&
		text(display.actorId) &&
		text(display.requestId) &&
		(display.kind === "chat" || display.kind === "card") &&
		text(display.text)
			? {
					display: {
						namespace: display.namespace,
						actorId: display.actorId,
						requestId: display.requestId,
						kind: display.kind,
						text: display.text,
						...(index.truncated.includes("/data/text")
							? { contentReference: reference("/data/text", "text") }
							: {}),
					},
				}
			: {}),
	};
	return { header, entry, contents };
}
