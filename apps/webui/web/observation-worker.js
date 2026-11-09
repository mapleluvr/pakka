import { ObservationHub } from "./observation-hub.js";
import { decodePocketEvent, decodePocketRequest } from "/protocol/pocket.js";
import { identity } from "/protocol/index.js";

let scheduled;
const hub = new ObservationHub({
	schedule: () => {
		if (!scheduled)
			scheduled = setTimeout(() => {
				scheduled = undefined;
				hub.flush();
			}, 50);
	},
	create: (query, handlers) => {
		const source = new EventSource("/pocket/events?" + query);
		source.addEventListener("pocket", (event) => {
			try {
				handlers.event(decodePocketEvent(JSON.parse(event.data)));
			} catch {
				source.close();
				handlers.error();
			}
		});
		source.onerror = handlers.error;
		return { close: () => source.close() };
	},
});
setInterval(() => hub.sweep(), 10000);
self.onconnect = (event) => {
	const port = event.ports[0],
		id = crypto.randomUUID();
	const send = (message) => {
		try {
			port.postMessage(message);
		} catch {
			hub.unsubscribe(id);
		}
	};
	port.onmessage = (event) => {
		const message = event.data;
		try {
			if (!message || typeof message !== "object") throw new Error("Invalid observation binding");
			if (message.kind === "subscribe") {
				if (!message.scope || !identity(message.scope.serverId) || !identity(message.scope.personId))
					throw new Error("Invalid public observation scope");
				const decoded = decodePocketRequest({
					version: 2,
					requestId: "observer-binding",
					command: { op: "preview", target: message.target },
				});
				if (decoded.command.op !== "preview") throw new Error("Invalid observation resource");
				hub.subscribe(
					id,
					decoded.command.target,
					{ serverId: message.scope.serverId, personId: message.scope.personId },
					send,
				);
			} else if (message.kind === "ping") hub.ping(id);
			else if (message.kind === "unsubscribe") {
				hub.unsubscribe(id);
				port.close();
			} else throw new Error("Unsupported observation binding");
		} catch {
			send({ kind: "connection-error" });
			hub.unsubscribe(id);
		}
	};
	port.onmessageerror = () => hub.unsubscribe(id);
	port.start();
};
