import type { ContextFrame, JsonObject, MessageDTO, ProjectionPlan } from "./types.ts";
import { copy, hash, json } from "./artifact-journal.ts";

function blocks(message: MessageDTO): readonly JsonObject[] {
	return Array.isArray(message.content) ? (message.content as readonly JsonObject[]) : [];
}
function nativeCall(block: JsonObject): JsonObject {
	const { thoughtSignature: _thought, ...rest } = block;
	return rest;
}
function protocol(messages: readonly MessageDTO[]): Map<string, [number, number]> {
	const pending = new Map<string, { index: number; name: string }>();
	const pairs = new Map<string, [number, number]>();
	for (const [index, message] of messages.entries()) {
		if (message.role === "assistant") {
			if (pending.size) throw new Error("Unanswered native tool call");
			for (const block of blocks(message).filter((b) => b.type === "toolCall")) {
				if (
					typeof block.id !== "string" ||
					!block.id ||
					typeof block.name !== "string" ||
					!block.arguments ||
					typeof block.arguments !== "object" ||
					Array.isArray(block.arguments) ||
					pending.has(block.id) ||
					pairs.has(block.id)
				)
					throw new Error("Invalid/duplicate native tool call");
				pending.set(block.id, { index, name: block.name });
			}
		} else if (message.role === "toolResult") {
			const call = pending.get(message.toolCallId as string);
			if (!call || call.name !== message.toolName) throw new Error("Dangling or forged native tool result");
			pairs.set(message.toolCallId as string, [call.index, index]);
			pending.delete(message.toolCallId as string);
		} else if (pending.size && message.role !== "system")
			throw new Error("Native call/result association split by a conversation message");
	}
	if (pending.size) throw new Error("Unanswered native tool call");
	return pairs;
}

/** Pure DTO application. The adapter, not a strategy, converts this checked output to Pi messages. */
export function applyProjection(frame: ContextFrame, plan: ProjectionPlan): readonly MessageDTO[] {
	if (!plan || !["disabled", "apply"].includes(plan.status)) throw new Error("Invalid projection status");
	const allowed =
		plan.status === "disabled" ? ["status", "basis"] : ["status", "basis", "patches", "replacements"];
	if (Object.keys(plan).some((key) => !allowed.includes(key)))
		throw new Error("Unknown projection plan field");
	const original = frame.projection.flatMap((entry) => entry.messages);
	const pairs = protocol(original.filter((m) => !(m.role === "bashExecution" && m.excludeFromContext)));
	if (plan.status === "disabled") return original;
	const entries = frame.projection.map((e) => ({
		...e,
		messages: structuredClone(e.messages) as MessageDTO[],
	}));
	const byId = new Map(entries.map((entry) => [entry.sourceEntryId, entry]));
	const patched = new Set<string>();
	for (const patch of plan.patches ?? []) {
		if (Object.keys(patch).sort().join() !== "content,messageIndex,sourceEntryId")
			throw new Error("Invalid message patch fields");
		const entry = byId.get(patch.sourceEntryId);
		if (
			!entry ||
			entry.boundary ||
			entry.excluded ||
			!Number.isInteger(patch.messageIndex) ||
			!entry.messages[patch.messageIndex]
		)
			throw new Error("Invalid/protected projection patch target");
		const key = patch.sourceEntryId + ":" + patch.messageIndex;
		if (patched.has(key)) throw new Error("Duplicate message patch");
		patched.add(key);
		const before = entry.messages[patch.messageIndex];
		if (!["user", "assistant", "toolResult", "custom"].includes(before.role))
			throw new Error("Unsupported patch role");
		json(patch.content);
		if (
			typeof patch.content !== "string" &&
			(!Array.isArray(patch.content) || patch.content.some((b) => !b || typeof b.type !== "string"))
		)
			throw new Error("Invalid content blocks");
		if ((before.role === "assistant" || before.role === "toolResult") && !Array.isArray(patch.content))
			throw new Error("Structured role requires content blocks");
		const after = { ...before, content: structuredClone(patch.content) };
		const protectedBlocks = (message: MessageDTO) =>
			blocks(message)
				.filter((b) => !["text", "thinking"].includes(b.type as string))
				.map((b) => (b.type === "toolCall" ? nativeCall(b) : b));
		if (hash(protectedBlocks(before)) !== hash(protectedBlocks(after)))
			throw new Error("Native call identity/arguments or non-text payload changed");
		entry.messages[patch.messageIndex] = after;
	}
	const visible = entries.filter((entry) => entry.messages.length && !entry.excluded);
	const selected = new Set<string>();
	const replacements = new Map<string, MessageDTO>();
	let lastEnd = -1;
	for (const range of plan.replacements ?? []) {
		if (
			Object.keys(range).some((key) => !["sourceEntryIds", "summary", "jobScope"].includes(key)) ||
			!Array.isArray(range.sourceEntryIds) ||
			!range.sourceEntryIds.length ||
			(range.summary !== null && (typeof range.summary !== "string" || !range.summary.trim()))
		)
			throw new Error("Invalid summary range");
		const start = visible.findIndex((entry) => entry.sourceEntryId === range.sourceEntryIds[0]);
		const segment = visible.slice(start, start + range.sourceEntryIds.length);
		if (
			start < 0 ||
			start <= lastEnd ||
			segment.length !== range.sourceEntryIds.length ||
			segment.some(
				(entry, i) =>
					entry.sourceEntryId !== range.sourceEntryIds[i] ||
					entry.boundary ||
					patched.has(entry.sourceEntryId + ":0"),
			)
		)
			throw new Error("Unordered/noncontiguous/protected summary range");
		lastEnd = start + segment.length - 1;
		const membership = new Set(segment.flatMap((e) => e.messages));
		const visibleOriginal = original.filter((m) => !(m.role === "bashExecution" && m.excludeFromContext));
		// Compare original source identities; patches cannot change native calls.
		const sourceIndexes = new Set<number>();
		for (const e of frame.projection.filter((e) => range.sourceEntryIds.includes(e.sourceEntryId)))
			for (const m of e.messages) sourceIndexes.add(visibleOriginal.indexOf(m));
		for (const [call, result] of pairs.values())
			if (sourceIndexes.has(call) !== sourceIndexes.has(result))
				throw new Error("Summary splits native call/result pair");
		if (!membership.size) throw new Error("Empty summary range");
		for (const entry of segment) selected.add(entry.sourceEntryId);
		if (range.summary !== null)
			replacements.set(segment[0].sourceEntryId, {
				role: "user",
				content: [{ type: "text", text: "[Host strategy summary]\n" + range.summary }],
				timestamp: 0,
			});
	}
	const output = entries.flatMap((entry) =>
		replacements.has(entry.sourceEntryId)
			? [replacements.get(entry.sourceEntryId)!]
			: selected.has(entry.sourceEntryId)
				? []
				: entry.messages,
	);
	protocol(output.filter((m) => !(m.role === "bashExecution" && m.excludeFromContext)));
	return copy(output);
}
