/**
 * @typedef {import('@pakka/protocol/pocket').AgentRef} Target
 * @typedef {{serverId:string,personId:string}} Scope
 * @typedef {{target:Target,scope:Scope,send:(value:object)=>void,seen:number,ready:boolean}} PageBinding
 * @typedef {{snapshot?:{ref?:Target,sessionId?:string,conversationId?:string},patch?:{ref:Target},kind?:string}} RoutedEvent
 * @typedef {{create:(query:URLSearchParams,handlers:{event:(value:RoutedEvent)=>void,error:()=>void})=>{close:()=>void},schedule:()=>void,now?:()=>number}} Options
 */
const sameTarget = (a, b) =>
	a &&
	b &&
	["sessionId", "conversationId", "key", "incarnation", "profile"].every((key) => a[key] === b[key]);

/** One origin-owned read connection; no payload cache, secrets, mutations or model authority. */
export class ObservationHub {
	/** @type {Map<string,PageBinding>} */
	#pages = new Map();
	/** @type {{close:()=>void}|null} */
	#connection = null;
	#scope = "";
	#generation = {};
	#dirty = false;
	/** @param {Options} options */
	constructor(options) {
		this.options = options;
		this.now = options.now ?? (() => Date.now());
	}
	/** @param {string} id @param {Target} target @param {Scope} scope @param {(value:object)=>void} send */
	subscribe(id, target, scope, send) {
		const identity = JSON.stringify([scope.serverId, scope.personId]);
		if (this.#scope && this.#scope !== identity) {
			this.#connection?.close();
			this.#connection = null;
			this.#generation = {};
			for (const page of this.#pages.values()) page.send({ kind: "scope-changed" });
			this.#pages.clear();
		}
		this.#scope = identity;
		const targets = new Set(
			[...this.#pages.values()].map((page) =>
				JSON.stringify([page.target.sessionId, page.target.conversationId]),
			),
		);
		targets.add(JSON.stringify([target.sessionId, target.conversationId]));
		if (targets.size > 16 || (!this.#pages.has(id) && this.#pages.size >= 64))
			throw new Error("Too many active observed pages");
		this.#pages.set(id, {
			target: structuredClone(target),
			scope: { ...scope },
			send,
			seen: this.now(),
			ready: false,
		});
		this.#dirty = true;
		this.options.schedule();
	}
	/** @param {string} id */
	ping(id) {
		const page = this.#pages.get(id);
		if (page) page.seen = this.now();
	}
	/** @param {string} id */
	unsubscribe(id) {
		if (!this.#pages.delete(id)) return;
		this.#dirty = true;
		if (!this.#pages.size) {
			this.#generation = {};
			this.#connection?.close();
			this.#connection = null;
			this.#dirty = false;
		} else this.options.schedule();
	}
	flush() {
		if (!this.#dirty) return;
		this.#dirty = false;
		this.#connection?.close();
		this.#connection = null;
		const generation = (this.#generation = {});
		const first = this.#pages.values().next().value;
		if (!first) return;
		const targets = new Map(
			[...this.#pages.values()].map((page) => [
				JSON.stringify([page.target.sessionId, page.target.conversationId]),
				{ sessionId: page.target.sessionId, conversationId: page.target.conversationId },
			]),
		);
		const query = new URLSearchParams({
			mode: "preview",
			targets: JSON.stringify([...targets.values()]),
			expectedServerId: first.scope.serverId,
			expectedPersonId: first.scope.personId,
		});
		for (const page of this.#pages.values()) {
			page.ready = false;
			page.send({ kind: "reset" });
		}
		this.#connection = this.options.create(query, {
			event: (event) => {
				if (this.#generation !== generation) return;
				const target = event.snapshot?.ref ?? event.patch?.ref;
				for (const page of this.#pages.values()) {
					if (
						event.kind === "collaboration" &&
						(event.snapshot?.conversationId !== page.target.conversationId ||
							(event.snapshot?.sessionId !== undefined && event.snapshot.sessionId !== page.target.sessionId))
					)
						continue;
					if (!target) {
						page.send({ kind: "event", event });
						continue;
					}
					if (!sameTarget(page.target, target)) continue;
					if (event.kind === "conversation") page.ready = true;
					if (page.ready) page.send({ kind: "event", event });
				}
			},
			error: () => {
				if (this.#generation !== generation) return;
				for (const page of this.#pages.values()) page.send({ kind: "connection-error" });
			},
		});
	}
	sweep() {
		for (const [id, page] of this.#pages)
			if (this.now() - page.seen > 120000) {
				page.send({ kind: "expired" });
				this.unsubscribe(id);
			}
	}
	metrics() {
		return { pages: this.#pages.size, connections: this.#connection ? 1 : 0 };
	}
	dispose() {
		this.#generation = {};
		this.#connection?.close();
		this.#connection = null;
		this.#pages.clear();
		this.#dirty = false;
	}
}
