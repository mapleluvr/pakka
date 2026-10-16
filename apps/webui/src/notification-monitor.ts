import { createHash } from "node:crypto";
import type { Runtime } from "@pakka/agent";
import type { PocketNotifications } from "@pakka/server/pocket";

/** Passive native completion observation. A stable committed entry supplies the event identity; no input replay. */
export async function observeNotifications(runtime: Runtime, notifications: PocketNotifications) {
	let closed = false;
	const seen = new Set<string>();
	const check = () => {
		if (closed || runtime.view().phase !== "ready") throw Error("Notification observation ended");
	};
	async function scan(seed: boolean) {
		for (const ref of runtime.view().conversations) {
			if (closed) return;
			try {
				const snapshot = await runtime.readConversation(ref, check, { limit: 32 });
				for (const entry of snapshot.entries) {
					const identity = createHash("sha256")
						.update(JSON.stringify([ref.sessionId, ref.conversationId, entry.id]))
						.digest("hex");
					if (seen.has(identity)) continue;
					seen.add(identity);
					if (seen.size > 2048) seen.delete(seen.values().next().value!);
					if (
						seed ||
						!entry.messages.some((message) => message.role === "assistant" && message.stopReason === "stop")
					)
						continue;
					await notifications.publish({
						requestId: "completion." + identity,
						target: ref,
						kind: "done",
						preview: "The agent finished this conversation.",
					});
				}
			} catch {
				// An obsolete incarnation or unknown store publication never grants another resource or replays work.
			}
		}
	}
	await scan(true);
	let task: Promise<void> | undefined;
	const timer = setInterval(() => {
		if (!closed && !task) {
			task = scan(false);
			void task.finally(() => {
				task = undefined;
			});
		}
	}, 100);
	timer.unref();
	return Object.freeze({
		close: async () => {
			if (closed) return;
			closed = true;
			clearInterval(timer);
			await task;
		},
	});
}
