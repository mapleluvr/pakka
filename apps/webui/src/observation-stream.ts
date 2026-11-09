import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ServerResponse } from "node:http";
import type { ConversationRef } from "@pakka/agent";
import type {
	PocketAuthority,
	PocketPeople,
	PocketWorkspace,
	PocketCollaboration,
} from "@pakka/server/pocket";
import { decodePocketEvent, type PocketSnapshot } from "@pakka/protocol/pocket";
import { createPocketSnapshotPatch } from "./conversation-patch.ts";

export interface PocketObservationStreamOptions {
	readonly response: ServerResponse;
	readonly signal: AbortSignal;
	readonly serverId: string;
	readonly people: PocketPeople;
	readonly actor: PocketAuthority;
	readonly workspace: PocketWorkspace;
	readonly collaboration?: PocketCollaboration;
	readonly refs: readonly ConversationRef[];
	readonly pollMs: number;
	readonly preview: boolean;
	readonly reconnected: boolean;
}

/** One bounded, backpressured multiplexed observer. It never starts/resumes execution. */
export async function streamPocketObservation(options: PocketObservationStreamOptions): Promise<void> {
	const { response: res, signal, people, actor } = options;
	const client = options.workspace.bind(actor);
	const states = options.refs.map((ref) => ({
		ref,
		previous: undefined as PocketSnapshot | undefined,
		sequence: 0,
		revision: undefined as number | undefined,
		human: "",
	}));
	const streamId = randomUUID();
	let sequence = 0,
		lastSent = Date.now();
	const check = () => {
		if (signal.aborted || res.destroyed || res.writableEnded) throw new Error("Observation ended");
		people.current(actor);
		for (const state of states) people.check(actor, "read", people.resourceId(state.ref));
	};
	const write = async (data: string) => {
		check();
		if (!res.write(data)) {
			await new Promise<void>((resolve, reject) => {
				const finish = (error?: Error) => {
					clearTimeout(timer);
					res.off("drain", drained);
					signal.removeEventListener("abort", aborted);
					if (error) reject(error);
					else resolve();
				};
				const drained = () => finish(),
					aborted = () => finish(new Error("Observation ended"));
				const timer = setTimeout(() => finish(new Error("Slow observer requires a fresh snapshot")), 1000);
				res.once("drain", drained);
				signal.addEventListener("abort", aborted, { once: true });
				if (signal.aborted || res.destroyed || res.writableEnded) aborted();
			});
			check();
		}
		lastSent = Date.now();
	};
	const emit = async (data: Record<string, unknown>) => {
		check();
		const current = sequence + 1;
		const value = decodePocketEvent({
			version: 2,
			serverId: options.serverId,
			streamId,
			sequence: current,
			...data,
		});
		await write(
			`id: ${options.serverId}:${streamId}:${current}\nevent: pocket\ndata: ${JSON.stringify(value)}\n\n`,
		);
		sequence = current;
		return current;
	};
	try {
		check();
		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.flushHeaders();
		if (options.reconnected) await emit({ kind: "resnapshot" });
		while (!signal.aborted) {
			check();
			for (const state of states) {
				const revision = client.observationRevision(state.ref);
				if (state.previous === undefined || state.revision !== revision) {
					const nativeSnapshot = options.preview
						? await client.preview(state.ref, { limit: 32, maxBytes: 128 * 1024 }, check)
						: await client.read(state.ref);
					check();
					// Crossing the native-to-wire boundary validates parts, payload budgets and ownership before caching/diffing.
					const projected = decodePocketEvent({
						version: 2,
						serverId: options.serverId,
						streamId,
						sequence: sequence + 1,
						kind: "conversation",
						snapshot: nativeSnapshot,
					});
					if (projected.kind !== "conversation") throw new Error("Invalid observation projection");
					const snapshot = projected.snapshot;
					if (!state.previous) state.sequence = await emit({ kind: "conversation", snapshot });
					else if (options.preview) {
						const patch = createPocketSnapshotPatch(state.previous, snapshot, state.sequence);
						if (patch) state.sequence = await emit({ kind: "conversation.patch", patch });
					} else if (JSON.stringify(state.previous) !== JSON.stringify(snapshot))
						state.sequence = await emit({ kind: "conversation", snapshot });
					state.previous = snapshot;
					// A commit during the read is not consumed: the next turn sees its newer marker.
					state.revision = revision;
				}
				if (options.collaboration) {
					const snapshot = await options.collaboration.bind(actor).snapshot(state.ref);
					check();
					const encoded = JSON.stringify(snapshot);
					if (encoded !== state.human) {
						await emit({ kind: "collaboration", snapshot });
						state.human = encoded;
					}
				}
			}
			if (Date.now() - lastSent >= 15000) await write(": heartbeat\n\n");
			await delay(options.pollMs, undefined, { signal });
		}
	} catch {
		// No payload is published after invalidated authority. A slow queue is discarded, not accumulated.
		if (res.writableNeedDrain) res.destroy();
		else if (!signal.aborted && !res.destroyed && !res.writableEnded) {
			try {
				await emit({ kind: "invalidated" });
			} catch {
				/* Authority ended; do not publish more bytes. */
			}
		}
	} finally {
		for (const state of states) {
			state.previous = undefined;
			state.human = "";
		}
		if (!res.destroyed && !res.writableEnded) res.end();
	}
}
