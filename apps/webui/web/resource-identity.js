/** Navigation identity is stable across reopen, but never crosses a native Session boundary. */
export const resourceKey = (ref) => JSON.stringify([ref.sessionId, ref.conversationId]);
