/**
 * @typedef {{sessionId:string,conversationId:string,incarnation:string,key:string,profile:string}} Target
 * @typedef {{scope:()=>({serverId:string,personId:string}|null),maxBytes?:number}} Options
 */
/** Tiny memory-only expansion metadata; it never retains content or credentials. */
export class DisclosureState {
	/** @type {Map<string,number>} */ #items = new Map();
	#scope = "";
	#bytes = 0;
	/** @param {Options} options */
	constructor(options) {
		this.options = options;
		this.maxBytes = options.maxBytes ?? 256 * 1024;
		if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1024)
			throw new Error("Invalid disclosure metadata budget");
	}
	/** @param {Target} target @param {string} identity */
	#key(target, identity) {
		const scope = this.options.scope();
		const current = scope ? JSON.stringify([scope.serverId, scope.personId]) : "";
		if (current !== this.#scope) {
			this.clear();
			this.#scope = current;
		}
		return current
			? JSON.stringify([
					current,
					target.sessionId,
					target.conversationId,
					target.incarnation,
					target.key,
					target.profile,
					identity,
				])
			: "";
	}
	/** @param {Target} target @param {string} identity */
	get(target, identity) {
		const key = this.#key(target, identity),
			bytes = this.#items.get(key);
		if (bytes !== undefined) {
			this.#items.delete(key);
			this.#items.set(key, bytes);
			return true;
		}
		return false;
	}
	/** @param {Target} target @param {string} identity @param {boolean} open */
	set(target, identity, open) {
		const key = this.#key(target, identity);
		if (!key) return;
		const old = this.#items.get(key);
		if (old !== undefined) {
			this.#items.delete(key);
			this.#bytes -= old;
		}
		if (!open) return;
		const bytes = new TextEncoder().encode(key).byteLength + 64;
		if (bytes > this.maxBytes) return;
		this.#items.set(key, bytes);
		this.#bytes += bytes;
		while (this.#bytes > this.maxBytes) {
			const first = this.#items.entries().next().value;
			if (!first) break;
			this.#items.delete(first[0]);
			this.#bytes -= first[1];
		}
	}
	metrics() {
		return { entries: this.#items.size, retainedBytes: this.#bytes };
	}
	clear() {
		this.#items.clear();
		this.#bytes = 0;
		this.#scope = "";
	}
}
