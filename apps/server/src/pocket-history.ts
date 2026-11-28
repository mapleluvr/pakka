import type { ConversationContentReference, ConversationSnapshot } from "@pakka/agent";

/** Projection only: the caller separately authorizes the addressed Conversation and checks its source. */
export function scopeContentReference(
	reference: ConversationContentReference,
	visible: (conversationId: string) => boolean,
): ConversationContentReference {
	if (!reference.sourceConversationId || visible(reference.sourceConversationId)) return reference;
	const { sourceConversationId: _source, ...scoped } = reference;
	return scoped;
}

/** Reuse the same fork-attribution policy for loaded previews and stored pages. */
export function scopeConversationEntries(
	entries: ConversationSnapshot["entries"],
	visible: (conversationId: string) => boolean,
): ConversationSnapshot["entries"] {
	const reference = (value: ConversationContentReference) => scopeContentReference(value, visible);
	return entries.map((entry) => {
		const { sourceConversationId, ...rest } = entry;
		return {
			...rest,
			...(sourceConversationId && visible(sourceConversationId) ? { sourceConversationId } : {}),
			messages: entry.messages.map((message) => ({
				...message,
				...(message.contentReference ? { contentReference: reference(message.contentReference) } : {}),
				...(message.errorReference ? { errorReference: reference(message.errorReference) } : {}),
				content:
					typeof message.content === "string"
						? message.content
						: message.content.map((part) => ({
								...part,
								...(part.contentReference ? { contentReference: reference(part.contentReference) } : {}),
							})),
			})),
			...(entry.display
				? {
						display: {
							...entry.display,
							...(entry.display.contentReference
								? { contentReference: reference(entry.display.contentReference) }
								: {}),
						},
					}
				: {}),
		};
	});
}
