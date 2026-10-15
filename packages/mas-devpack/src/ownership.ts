import { createHash } from "node:crypto";
import type { ConversationRef } from "@pakka/agent";

/** Stable descriptive ownership principal; the string alone never grants authority. */
export function masAgentPrincipal(ref: ConversationRef): string {
	return (
		"worker-agent-" +
		createHash("sha256")
			.update(JSON.stringify([ref.sessionId, ref.conversationId]))
			.digest("hex")
			.slice(0, 48)
	);
}
