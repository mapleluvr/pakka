import type { DeliveryReceipt } from "@pakka/agent";
import { createMas } from "./index.ts";
import type { MasOptions } from "./types.ts";
import type { RelayEnvelope, SessionEndpoint, SessionPlacement } from "./broker-types.ts";
import { digest, immutable, validIdentity } from "./broker-codec.ts";

/** Existing trusted runtime placement; opening it never allocates a new storage or authority. */
export function inProcessPlacement(options: MasOptions): SessionPlacement {
	let endpoint: Promise<SessionEndpoint> | undefined;
	return Object.freeze({
		open: async (expectedSessionId?: string) => {
			const runtime = options.runtime.view();
			if (runtime.phase !== "ready") throw new Error("Placement runtime unavailable");
			if (expectedSessionId && runtime.sessionId !== expectedSessionId)
				throw new Error("Placement Session identity changed");
			return (endpoint ??= (async () => {
				const mas = await createMas(options),
					catalog = options.runtime.catalog(options);
				const check = (envelope: RelayEnvelope, signal?: AbortSignal) => {
					if (signal?.aborted) throw new Error("Relay authority revoked");
					if (!validIdentity(envelope.id) || !validIdentity(envelope.principal))
						throw new Error("Invalid relay identity");
					const current = options.runtime.view();
					if (
						current.phase !== "ready" ||
						current.sessionId !== envelope.target.sessionId ||
						envelope.target.conversation.sessionId !== current.sessionId
					)
						throw new Error("Relay Session identity unavailable");
				};
				const principal = (envelope: RelayEnvelope) =>
					"relay." + digest([options.namespace, envelope.principal, envelope.source]);
				const verifyReceipt = (envelope: RelayEnvelope, receipt: DeliveryReceipt) => {
					if (
						receipt.principal !== principal(envelope) ||
						digest(receipt.target) !== digest(envelope.target.conversation)
					)
						throw new Error("Foreign relay receipt");
					return receipt;
				};
				return Object.freeze({
					view: async () => {
						const current = options.runtime.view();
						if (current.phase !== "ready") throw new Error("Placement runtime unavailable");
						return immutable({
							sessionId: current.sessionId,
							isolation: "in-process" as const,
							mas: await mas.view(),
						});
					},
					prepare: (members) => mas.bootstrap(members),
					activate: () => mas.activate(),
					deliver: async (envelope, signal) => {
						check(envelope, signal);
						return catalog.deliver(
							{
								requestId: "relay." + envelope.id,
								principal: principal(envelope),
								source: null,
								target: envelope.target.conversation,
								text: envelope.input.text,
								mode: envelope.input.mode ?? "prompt",
							},
							() => check(envelope, signal),
						);
					},
					receipt: async (envelope, nativeId) => {
						check(envelope);
						return verifyReceipt(envelope, await catalog.receipt(nativeId, () => check(envelope)));
					},
					wait: async (envelope, nativeId) => {
						check(envelope);
						const receipt = await catalog.receipt(nativeId, () => check(envelope));
						verifyReceipt(envelope, receipt);
						return verifyReceipt(envelope, await catalog.wait(nativeId, () => check(envelope)));
					},
				} satisfies SessionEndpoint);
			})());
		},
	});
}
