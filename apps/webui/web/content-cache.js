/**
 * @typedef {import('@pakka/protocol/pocket').AgentRef} Target
 * @typedef {import('@pakka/protocol/pocket').PocketContentReference} Reference
 * @typedef {import('@pakka/protocol/pocket').PocketContentChunk} Chunk
 * @typedef {{offset:number,nextOffset:number,text:string,bytes:number,lruKey:string}} Part
 * @typedef {{key:string,target:Target,reference:Reference,parts:Map<number,Part>,retainedBytes:number,progressOffset:number,complete:boolean}} Body
 * @typedef {{scope:()=>({serverId:string,personId:string}|null),request:(target:Target,reference:Reference,range:{offset:number,length:number},options:{signal:AbortSignal})=>Promise<Chunk>,now?:()=>number,visible?:()=>boolean,pressure?:()=>boolean,maxBytes?:number,perEntryBytes?:number,chunkBytes?:number}} Options
 */

export class ContentScopeChanged extends Error {
	constructor() {
		super("Content access changed. Read the current preview again.");
		this.name = "ContentScopeChanged";
	}
}

/** Memory-only body cache. Completed retrieval and complete retained residence are deliberately different. */
export class ContentCache {
	/** @type {Map<string,Body>} */
	#bodies = new Map();
	/** @type {Map<string,{body:Body,part:Part}>} */
	#lru = new Map();
	/** @type {Map<string,{promise:Promise<ReturnType<ContentCache['state']>>,controller:AbortController,idle:boolean}>} */
	#pending = new Map();
	/** @type {Map<object,Body>} */
	#eligible = new Map();
	/** @type {Set<()=>void>} */
	#listeners = new Set();
	#tail = Promise.resolve();
	#scopeId = "";
	#generation = 0;
	#retained = 0;
	#evictions = 0;
	#requests = 0;
	#lastActivity = 0;
	#nextIdle = 0;
	#disposed = false;
	/** @param {Options} options */
	constructor(options) {
		this.options = options;
		this.now = options.now ?? (() => Date.now());
		this.chunkBytes = options.chunkBytes ?? 65536;
		this.maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
		this.perEntryBytes = options.perEntryBytes ?? 4 * 1024 * 1024;
		if (
			![this.chunkBytes, this.maxBytes, this.perEntryBytes].every(Number.isSafeInteger) ||
			this.chunkBytes < 8 ||
			this.chunkBytes > 65536 ||
			this.maxBytes < this.chunkBytes * 2 + 256 ||
			this.perEntryBytes < this.chunkBytes * 2 + 128 ||
			this.perEntryBytes > this.maxBytes
		)
			throw new Error("Invalid bounded content cache");
		this.#lastActivity = this.now();
	}
	#scope() {
		if (this.#disposed) throw new ContentScopeChanged();
		const value = this.options.scope();
		if (!value || !value.serverId || !value.personId) throw new ContentScopeChanged();
		const id = JSON.stringify([value.serverId, value.personId]);
		if (id !== this.#scopeId) this.#reset(id);
		return id;
	}
	/** @param {Target} target @param {Reference} reference */
	#body(target, reference) {
		const scope = this.#scope();
		const key = JSON.stringify([
			scope,
			target.sessionId,
			target.conversationId,
			target.key,
			target.incarnation,
			target.profile,
			reference,
		]);
		let body = this.#bodies.get(key);
		if (!body) {
			body = {
				key,
				target: structuredClone(target),
				reference: structuredClone(reference),
				parts: new Map(),
				retainedBytes: 0,
				progressOffset: 0,
				complete: reference.byteLength === 0,
			};
			this.#bodies.set(key, body);
			while (this.#bodies.size > 256) {
				const first = this.#bodies.values().next().value;
				if (!first || first === body) break;
				for (const part of first.parts.values()) this.#remove(first, part);
				this.#bodies.delete(first.key);
				for (const [token, entry] of this.#eligible) if (entry === first) this.#eligible.delete(token);
			}
		} else {
			this.#bodies.delete(key);
			this.#bodies.set(key, body);
		}
		return body;
	}
	/** @param {Body} body @param {Part} part */
	#remove(body, part) {
		body.parts.delete(part.offset);
		this.#lru.delete(part.lruKey);
		body.retainedBytes -= part.bytes;
		this.#retained -= part.bytes;
		this.#evictions++;
	}
	#notify() {
		for (const listener of this.#listeners) listener();
	}
	/** @param {()=>void} listener */
	subscribe(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	/** @param {Target} target @param {Reference} reference */
	state(target, reference) {
		const body = this.#body(target, reference);
		const parts = [...body.parts.values()].sort((a, b) => a.offset - b.offset);
		for (const part of parts) {
			const value = this.#lru.get(part.lruKey);
			if (value) {
				this.#lru.delete(part.lruKey);
				this.#lru.set(part.lruKey, value);
			}
		}
		let contiguous = 0;
		for (const part of parts) {
			if (part.offset !== contiguous) break;
			contiguous = part.nextOffset;
		}
		return {
			key: body.key,
			parts,
			retainedBytes: body.retainedBytes,
			progressOffset: body.progressOffset,
			complete: body.complete,
			retainedComplete: body.complete && contiguous === reference.byteLength,
			byteLength: reference.byteLength,
		};
	}
	metrics() {
		return {
			retainedBytes: this.#retained,
			evictions: this.#evictions,
			requests: this.#requests,
			pending: this.#pending.size,
			bodies: this.#bodies.size,
		};
	}
	activity() {
		this.#lastActivity = this.now();
		for (const task of this.#pending.values()) if (task.idle) task.controller.abort();
	}
	/** @param {Target} target @param {Reference} reference */
	eligible(target, reference) {
		const body = this.#body(target, reference),
			token = {};
		this.#eligible.set(token, body);
		return () => {
			this.#eligible.delete(token);
			if (![...this.#eligible.values()].includes(body)) {
				for (const [key, task] of this.#pending)
					if (task.idle && key.startsWith(body.key + "|")) task.controller.abort();
			}
		};
	}
	/** @param {Target} target @param {Reference} reference @param {{signal?:AbortSignal,idle?:boolean}} [options] */
	loadMore(target, reference, options = {}) {
		const body = this.#body(target, reference);
		if (body.complete) return Promise.resolve(this.state(target, reference));
		return this.loadRange(target, reference, body.progressOffset, options);
	}
	/** @param {Target} target @param {Reference} reference @param {number} offset @param {{signal?:AbortSignal,idle?:boolean}} [options] */
	loadRange(target, reference, offset, options = {}) {
		if (!options.idle) this.activity();
		const body = this.#body(target, reference),
			scope = this.#scopeId,
			generation = this.#generation;
		const key = body.key + "|" + offset;
		const existing = this.#pending.get(key);
		if (existing && !existing.controller.signal.aborted) return existing.promise;
		const cached = body.parts.get(offset);
		if (cached) return Promise.resolve(this.state(target, reference));
		const controller = new AbortController();
		const aborted = () => controller.abort();
		options.signal?.addEventListener("abort", aborted, { once: true });
		if (options.signal?.aborted) controller.abort();
		const promise = this.#tail
			.then(async () => {
				if (controller.signal.aborted || generation !== this.#generation || this.#scope() !== scope)
					throw new ContentScopeChanged();
				this.#requests++;
				const chunk = await this.options.request(
					body.target,
					body.reference,
					{ offset, length: this.chunkBytes },
					{ signal: controller.signal },
				);
				if (
					controller.signal.aborted ||
					generation !== this.#generation ||
					this.#scope() !== scope ||
					this.#bodies.get(body.key) !== body
				)
					throw new ContentScopeChanged();
				if (
					!chunk ||
					[
						"id",
						"source",
						"entryId",
						"sourceConversationId",
						"taskId",
						"callId",
						"revision",
						"path",
						"encoding",
						"byteLength",
						"previewComplete",
					].some((key) => chunk.reference[key] !== reference[key]) ||
					chunk.offset !== offset ||
					!Number.isSafeInteger(chunk.nextOffset) ||
					chunk.nextOffset < offset ||
					chunk.nextOffset > Math.min(reference.byteLength, offset + this.chunkBytes) ||
					chunk.complete !== (chunk.nextOffset === reference.byteLength) ||
					typeof chunk.text !== "string" ||
					(chunk.nextOffset === offset && !chunk.complete)
				)
					throw new Error("Original content range/version changed. Read its preview again.");
				const bytes = chunk.text.length * 2 + 128;
				if (bytes > this.perEntryBytes || bytes > this.maxBytes)
					throw new Error("One content chunk exceeds the cache budget");
				for (const part of [...body.parts.values()].sort((a, b) => a.offset - b.offset)) {
					if (body.retainedBytes + bytes <= this.perEntryBytes) break;
					this.#remove(body, part);
				}
				while (this.#retained + bytes > this.maxBytes && this.#lru.size) {
					const oldest = this.#lru.values().next().value;
					if (!oldest) break;
					this.#remove(oldest.body, oldest.part);
				}
				const part = { offset, nextOffset: chunk.nextOffset, text: chunk.text, bytes, lruKey: key };
				body.parts.set(offset, part);
				body.retainedBytes += bytes;
				this.#retained += bytes;
				this.#lru.set(key, { body, part });
				if (offset === body.progressOffset) {
					body.progressOffset = chunk.nextOffset;
					body.complete = chunk.complete;
				}
				this.#notify();
				return this.state(target, reference);
			})
			.finally(() => {
				options.signal?.removeEventListener("abort", aborted);
				if (this.#pending.get(key)?.controller === controller) this.#pending.delete(key);
			});
		this.#pending.set(key, { promise, controller, idle: options.idle === true });
		this.#tail = promise.then(
			() => {},
			() => {},
		);
		return promise;
	}
	async pumpIdle() {
		if (
			this.#disposed ||
			this.#pending.size ||
			this.now() - this.#lastActivity < 2000 ||
			this.now() < this.#nextIdle ||
			this.options.visible?.() === false ||
			this.options.pressure?.() === true ||
			this.#retained >= this.maxBytes * 0.8
		)
			return;
		const body = [...this.#eligible.values()].find(
			(entry) => !entry.complete && entry.retainedBytes < this.perEntryBytes * 0.8,
		);
		if (!body) return;
		this.#nextIdle = this.now() + 500;
		try {
			await this.loadMore(body.target, body.reference, { idle: true });
		} catch {
			/* Idle reads stop; explicit viewing reports its own error. */
		}
	}
	/** @param {string} scopeId */
	#reset(scopeId) {
		this.#generation++;
		for (const task of this.#pending.values()) task.controller.abort();
		this.#bodies.clear();
		this.#lru.clear();
		this.#eligible.clear();
		this.#retained = 0;
		// Publish the new scope before callbacks can synchronously inspect the empty cache.
		this.#scopeId = scopeId;
		this.#lastActivity = this.now();
		this.#notify();
	}
	clear() {
		this.#reset("");
	}
	dispose() {
		this.clear();
		this.#disposed = true;
		this.#listeners.clear();
	}
}
