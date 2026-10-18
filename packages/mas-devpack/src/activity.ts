import type { ConversationSnapshot } from "@pakka/agent";

export type ActivityState = "waiting" | "thinking" | "tool" | "reply" | "error" | "crashed" | "idle";
export interface ActivityProjection {
	readonly state: ActivityState;
	readonly preview: string;
	readonly tool?: string;
	readonly code?: number;
	readonly detail?: string;
}
export interface ActivityReadiness {
	readonly phase: "ready" | "failed" | "ended";
	readonly reason?: string;
}
const PREVIEW_LIMIT = 240;
function preview(value: string): string {
	let result = "";
	for (const point of value) {
		if (result.length + point.length > PREVIEW_LIMIT) return `${result}…`;
		result += point;
	}
	return result;
}
function content(
	message:
		| ConversationSnapshot["live"]["message"]
		| ConversationSnapshot["entries"][number]["messages"][number],
) {
	return Array.isArray(message?.content) ? message.content : [];
}
function toolArguments(value: unknown): string {
	if (value === undefined) return "";
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}
function assistantText(
	messages: readonly {
		readonly role: string;
		readonly content: unknown;
		readonly errorMessage?: string;
		readonly isError?: boolean;
		readonly stopReason?: string;
	}[],
) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		if (message.role !== "assistant") continue;
		if (message.isError || message.stopReason === "error" || message.errorMessage) {
			const detail = message.errorMessage?.trim() || "The model request failed.";
			return { state: "error" as const, preview: preview(detail), detail: preview(detail) };
		}
		if (typeof message.content === "string") {
			if (message.content.trim()) return { state: "reply" as const, preview: preview(message.content) };
			continue;
		}
		const text = (Array.isArray(message.content) ? message.content : [])
			.filter((part): part is { type: "text"; text: string } =>
				Boolean(part && typeof part === "object" && part.type === "text" && typeof part.text === "string"),
			)
			.map((part) => part.text)
			.join("");
		if (text.trim()) return { state: "reply" as const, preview: preview(text) };
	}
	return null;
}

/** Projects native transcript/runtime facts; it never calls a model or infers status from reply prose. */
export function projectActivity(
	snapshot: ConversationSnapshot,
	readiness?: ActivityReadiness,
): ActivityProjection {
	if (readiness?.phase === "failed") {
		const failure = assistantText([
			...snapshot.entries.flatMap((entry) => entry.messages),
			...(snapshot.live.message ? [snapshot.live.message] : []),
		]);
		if (failure?.state === "error") return failure;
		return {
			state: "crashed",
			preview: "Conversation crashed",
			...(readiness.reason ? { detail: preview(readiness.reason) } : {}),
		};
	}

	if (snapshot.live.busy) {
		const activeTool =
			snapshot.live.tools.find((tool) => tool.status === "running") ??
			snapshot.live.tools.find((tool) => tool.status === "pending");
		if (activeTool) {
			const call = content(snapshot.live.message).find(
				(part) => part.type === "toolCall" && part.id === activeTool.callId,
			);
			const args = call && call.type === "toolCall" ? toolArguments(call.arguments) : "";
			return {
				state: "tool",
				preview: preview(`${activeTool.name}${args ? ` ${args}` : ""}`),
				tool: activeTool.name,
			};
		}
		const message = snapshot.live.message;
		const failure = assistantText(message ? [message] : []);
		if (failure?.state === "error") return failure;
		const parts = content(message);
		// Pi retains earlier reasoning while appending text; project the latest active part.
		for (let index = parts.length - 1; index >= 0; index--) {
			const part = parts[index]!;
			if (part.type === "text" && part.text.trim()) return { state: "reply", preview: preview(part.text) };
			if (part.type === "thinking" && part.thinking.trim())
				return { state: "thinking", preview: preview(part.thinking) };
		}
		return { state: "waiting", preview: "" };
	}

	const messages = snapshot.entries.flatMap((entry) => entry.messages);
	const latest = assistantText(messages);
	if (latest) return latest;
	if (readiness?.phase === "ended") return { state: "idle", preview: "Conversation ended" };
	return { state: "idle", preview: "" };
}

export { preview as activityPreview };
export function toolArgumentsPreview(value: unknown): string {
	return preview(toolArguments(value));
}
export function liveThinkingPreview(snapshot: ConversationSnapshot): string {
	const parts = content(snapshot.live.message);
	return preview(
		parts
			.filter((part) => part.type === "thinking" && typeof part.thinking === "string")
			.map((part) => (part.type === "thinking" ? part.thinking : ""))
			.join(""),
	);
}
export function liveToolCall(snapshot: ConversationSnapshot) {
	const activeTool =
		snapshot.live.tools.find((tool) => tool.status === "running") ??
		snapshot.live.tools.find((tool) => tool.status === "pending");
	if (!activeTool) return null;
	const call = content(snapshot.live.message).find(
		(part) => part.type === "toolCall" && part.id === activeTool.callId,
	);
	return Object.freeze({
		name: activeTool.name,
		arguments: call && call.type === "toolCall" ? call.arguments : undefined,
	});
}
export function latestAssistantActivity(snapshot: ConversationSnapshot) {
	return assistantText(snapshot.entries.flatMap((entry) => entry.messages));
}
