import { createHash } from "node:crypto";
import type { Runtime } from "@pakka/agent";
import type { PocketNotifications } from "@pakka/server/pocket";

/** Passive native completion observation. A stable committed entry supplies the event identity; no input replay. */
export async function observeNotifications(runtime: Runtime, notifications: PocketNotifications) {
	let closed = false;
	const seen = new Set<string>();
	const revisions = new Map<string, number>();
	const check = () => {
		if (closed || runtime.view().phase !== "ready") throw Error("Notification observation ended");
	};
	async function scan(seed: boolean) {
		const refs = runtime.view().conversations;
		const active = new Set(refs.map((ref) => JSON.stringify([ref.conversationId, ref.incarnation])));
		for (const key of revisions.keys()) if (!active.has(key)) revisions.delete(key);
		for (const ref of refs) {
			if (closed) return;
			try {
				const key = JSON.stringify([ref.conversationId, ref.incarnation]);
				const revision = runtime.observationRevision(ref, check);
				if (!seed && revisions.get(key) === revision) continue;
				const snapshot = await runtime.previewConversation(ref, check, { limit: 32, maxBytes: 128 * 1024 });
				revisions.set(key, revision);
				for (const entry of snapshot.entries) {
					const identity = createHash("sha256")
						.update(JSON.stringify([ref.sessionId, ref.conversationId, entry.id]))
						.digest("hex");
					if (seen.has(identity)) continue;
					seen.add(identity);
					if (seen.size > 2048) seen.delete(seen.values().next().value!);
					if (
						seed ||
						entry.sourceConversationId !== undefined ||
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
			task = (async () => {
				if (runtime.view().phase !== "ready") {
					closed = true;
					clearInterval(timer);
					return;
				}
				await scan(false);
			})()
				.catch(() => {
					closed = true;
					clearInterval(timer);
				})
				.finally(() => {
					task = undefined;
				});
		}
	}, 333);
	timer.unref();
	return Object.freeze({
		close: async () => {
			closed = true;
			clearInterval(timer);
			await task;
			revisions.clear();
			seen.clear();
		},
	});
}
