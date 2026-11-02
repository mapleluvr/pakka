/** Plain scan policy; Pi objects and branded IDs remain inside the adapter. */
export interface HistoryScanState {
	readonly conversationId: string;
	readonly cachedConversationId?: string;
	readonly lastEntryId?: number;
}

export function planHistoryScan(
	state: HistoryScanState,
): Readonly<{ reset: boolean; pageSize: 256; minEntryId?: number }> {
	if (!/^(0|[1-9][0-9]*)$/.test(state.conversationId))
		throw new Error("Invalid history Conversation identity");
	const reset = state.cachedConversationId !== state.conversationId;
	if (reset || state.lastEntryId === undefined) return Object.freeze({ reset, pageSize: 256 });
	if (
		!Number.isSafeInteger(state.lastEntryId) ||
		state.lastEntryId < 0 ||
		state.lastEntryId >= Number.MAX_SAFE_INTEGER
	)
		throw new Error("Unsafe history entry ID bound");
	return Object.freeze({ reset, pageSize: 256, minEntryId: state.lastEntryId + 1 });
}
