import { test } from "node:test";
import assert from "node:assert/strict";
import type { PocketContentReference } from "@pakka/protocol/pocket";
import { ContentCache } from "../web/content-cache.js";
import { describePart } from "../web/message-parts.js";

const target = {
	key: "root",
	sessionId: "session",
	conversationId: "2",
	incarnation: "original",
	profile: "default",
};
const reference: PocketContentReference = {
	id: "a".repeat(64),
	source: "entry",
	entryId: "9",
	revision: "3",
	path: "/model/0/content/0/text",
	encoding: "text",
	byteLength: 4 * 16384,
	previewComplete: false,
};
const scope = () => ({ serverId: "server", personId: "person" });
const chunk = (ref: typeof reference, offset: number, length: number) => ({
	reference: ref,
	offset,
	nextOffset: Math.min(offset + length, ref.byteLength),
	complete: offset + length >= ref.byteLength,
	text: "x".repeat(Math.min(length, ref.byteLength - offset)),
});

test("lazy part projection: original content locators survive all renderable and download-only parts without loading image bytes", () => {
	for (const part of [
		{ type: "text", text: "head", contentReference: reference },
		{ type: "thinking", thinking: "head", contentReference: reference },
		{ type: "toolCall", id: "call", name: "command", arguments: {}, contentReference: reference },
		{
			type: "image",
			data: "",
			mimeType: "image/png",
			contentReference: { ...reference, encoding: "base64" },
		},
		{
			type: "image",
			data: "",
			mimeType: "image/svg+xml",
			contentReference: { ...reference, encoding: "base64" },
		},
	])
		assert.equal(describePart(part).reference, part.contentReference);
});

test("content cache: exact scope/original identity is single-flight and never aliases another Session", async () => {
	let requests = 0;
	const cache = new ContentCache({
		scope,
		chunkBytes: 16384,
		request: async (_target: unknown, ref: typeof reference, range: { offset: number; length: number }) => {
			requests++;
			return chunk(ref, range.offset, range.length);
		},
	});
	try {
		await Promise.all([cache.loadMore(target, reference), cache.loadMore(target, reference)]);
		assert.equal(requests, 1);
		assert.equal(cache.state(target, reference).progressOffset, 16384);
		assert.equal(cache.state({ ...target, sessionId: "another" }, reference).parts.length, 0);
		assert.equal(
			cache.state(target, { ...reference, revision: "another", id: "b".repeat(64) }).parts.length,
			0,
		);
	} finally {
		cache.dispose();
	}
});

test("content cache: retained chunks obey global and per-body byte LRU even when the entire original is eventually read", async () => {
	const cache = new ContentCache({
		scope,
		chunkBytes: 16384,
		maxBytes: 128 * 1024,
		perEntryBytes: 64 * 1024,
		request: async (_target: unknown, ref: typeof reference, range: { offset: number; length: number }) =>
			chunk(ref, range.offset, range.length),
	});
	try {
		for (let i = 0; i < 4; i++) await cache.loadMore(target, reference);
		const state = cache.state(target, reference);
		assert.equal(state.complete, true);
		assert.equal(state.progressOffset, reference.byteLength);
		assert.ok(state.parts[0]!.offset > 0, "read completion is not full retained residence");
		assert.ok(state.retainedBytes <= 64 * 1024);
		for (let i = 0; i < 8; i++) await cache.loadMore({ ...target, sessionId: "session-" + i }, reference);
		assert.ok(cache.metrics().retainedBytes <= 128 * 1024);
		assert.ok(cache.metrics().evictions > 0);
	} finally {
		cache.dispose();
	}
});

test("content cache: old revision replies never enter the body even if byte ranges appear contiguous", async () => {
	const cache = new ContentCache({
		scope,
		request: async () => ({
			...chunk(reference, 0, 16384),
			reference: { ...reference, revision: "changed" },
		}),
	});
	try {
		await assert.rejects(cache.loadMore(target, reference));
		assert.equal(cache.state(target, reference).progressOffset, 0);
		assert.equal(cache.metrics().retainedBytes, 0);
	} finally {
		cache.dispose();
	}
});

test("content cache: clear/revocation cancels browsing and rejects a late delivered reply rather than repopulating private text", async () => {
	let release: ((value: ReturnType<typeof chunk>) => void) | undefined;
	const cache = new ContentCache({
		scope,
		request: async () =>
			new Promise<ReturnType<typeof chunk>>((resolve) => {
				release = resolve;
			}),
	});
	try {
		const reading = cache.loadMore(target, reference);
		while (!release) await Promise.resolve();
		cache.clear();
		release(chunk(reference, 0, 16384));
		await assert.rejects(reading);
		assert.equal(cache.metrics().retainedBytes, 0);
	} finally {
		cache.dispose();
	}
});

test("content cache: idle fill waits for stable visible work, uses one paced chunk, and yields immediately to activity", async () => {
	let now = 0,
		requests = 0,
		visible = true;
	const cache = new ContentCache({
		scope,
		now: () => now,
		visible: () => visible,
		chunkBytes: 16384,
		request: async (_target: unknown, ref: typeof reference, range: { offset: number; length: number }) => {
			requests++;
			return chunk(ref, range.offset, range.length);
		},
	});
	try {
		const remove = cache.eligible(target, reference);
		await cache.pumpIdle();
		assert.equal(requests, 0);
		now = 2100;
		await cache.pumpIdle();
		assert.equal(requests, 1);
		now = 2350;
		await cache.pumpIdle();
		assert.equal(requests, 1);
		now = 2610;
		await cache.pumpIdle();
		assert.equal(requests, 2);
		cache.activity();
		now = 3000;
		await cache.pumpIdle();
		assert.equal(requests, 2);
		visible = false;
		now = 6000;
		await cache.pumpIdle();
		assert.equal(requests, 2);
		visible = true;
		remove();
		await cache.pumpIdle();
		assert.equal(requests, 2);
	} finally {
		cache.dispose();
	}
});

test("content cache: a current-scope change is published atomically even when subscribers synchronously inspect state", async () => {
	let personId = "first";
	const cache = new ContentCache({
		scope: () => ({ serverId: "server", personId }),
		chunkBytes: 16384,
		request: async (_target: unknown, ref: typeof reference, range: { offset: number; length: number }) =>
			chunk(ref, range.offset, range.length),
	});
	let remove: (() => boolean) | undefined;
	try {
		await cache.loadMore(target, reference);
		remove = cache.subscribe(() => {
			cache.state(target, reference);
		});
		personId = "second";
		assert.doesNotThrow(() => cache.state(target, reference));
		assert.equal(cache.state(target, reference).parts.length, 0);
		assert.equal(cache.metrics().retainedBytes, 0);
	} finally {
		remove?.();
		cache.dispose();
	}
});
