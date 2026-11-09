import { decodePocketEvent } from "@pakka/protocol/pocket";

/** Aggregate pages through one origin worker when supported; fallback still uses one read stream per page. */
export function subscribeObservation({ target, scope, event, reset, error }) {
	let active = true,
		port,
		source,
		heartbeat;
	const current = (message) => {
		if (!active) return;
		if (message.kind === "event") event(decodePocketEvent(message.event));
		else if (message.kind === "reset") reset();
		else error(message.kind);
	};
	try {
		if (typeof SharedWorker !== "function") throw new Error("Shared observer unavailable");
		const worker = new SharedWorker("/observation-worker.js", {
			type: "module",
			name: "pakka-bounded-observer",
		});
		port = worker.port;
		port.onmessage = (message) => {
			try {
				current(message.data);
			} catch {
				error("invalidated");
			}
		};
		port.onmessageerror = () => error("connection-error");
		worker.onerror = () => {
			if (active) error("worker-error");
		};
		port.start();
		port.postMessage({ kind: "subscribe", target, scope });
		heartbeat = setInterval(() => port.postMessage({ kind: "ping" }), 10000);
	} catch {
		const query = new URLSearchParams({
			mode: "preview",
			sessionId: target.sessionId,
			conversationId: target.conversationId,
			expectedServerId: scope.serverId,
			expectedPersonId: scope.personId,
		});
		source = new EventSource("/pocket/events?" + query);
		source.addEventListener("pocket", (message) => {
			if (!active) return;
			try {
				event(decodePocketEvent(JSON.parse(message.data)));
			} catch {
				source.close();
				error("invalidated");
			}
		});
		source.onerror = () => {
			if (active) error("connection-error");
		};
	}
	const close = () => {
		if (!active) return;
		active = false;
		clearInterval(heartbeat);
		if (port) {
			try {
				port.postMessage({ kind: "unsubscribe" });
			} finally {
				port.close();
			}
		}
		source?.close();
		window.removeEventListener("pagehide", close);
	};
	window.addEventListener("pagehide", close, { once: true });
	return { close };
}
