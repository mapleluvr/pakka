import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { decodePocketEvent, type PocketEvent } from "@pakka/protocol/pocket";
import { applyPocketObservation } from "@pakka/client/pocket";
import { fixture } from "./fixture.ts";

async function capture(m: Awaited<ReturnType<typeof fixture>>, query: URLSearchParams) {
	const controller = new AbortController();
	const response = await fetch(m.http.origin + "/pocket/events?" + query, {
		headers: { Origin: m.http.origin, Cookie: m.admin.cookies },
		signal: controller.signal,
	});
	assert.equal(response.status, 200);
	const reader = response.body!.getReader();
	const frames: PocketEvent[] = [];
	let bytes = 0,
		failure: unknown;
	const reading = (async () => {
		const decoder = new TextDecoder();
		let text = "";
		try {
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) return;
				bytes += chunk.value.byteLength;
				text += decoder.decode(chunk.value, { stream: true });
				let at: number;
				while ((at = text.indexOf("\n\n")) >= 0) {
					const block = text.slice(0, at);
					text = text.slice(at + 2);
					const data = block
						.split("\n")
						.filter((line) => line.startsWith("data: "))
						.map((line) => line.slice(6))
						.join("\n");
					if (data) frames.push(decodePocketEvent(JSON.parse(data)));
				}
			}
		} catch (error) {
			if (!controller.signal.aborted) failure = error;
		} finally {
			reader.releaseLock();
		}
	})();
	return {
		frames,
		bytes: () => bytes,
		failure: () => failure,
		close: async () => {
			controller.abort();
			await reading;
		},
	};
}
async function until(check: () => boolean, message: string) {
	const deadline = Date.now() + 2500;
	while (!check() && Date.now() < deadline) await delay(10);
	assert.ok(check(), message);
}

test(
	"WebUI bounded stream: idle does not re-send complete snapshots and a native commit sends only its changed entry",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		let stream: Awaited<ReturnType<typeof capture>> | undefined;
		try {
			stream = await capture(
				m,
				new URLSearchParams({
					sessionId: m.ref.sessionId,
					conversationId: m.ref.conversationId,
					mode: "preview",
				}),
			);
			const observed = stream;
			await until(() => observed.frames.length > 0, "a fresh bounded snapshot should arrive");
			assert.equal(observed.frames[0]?.kind, "conversation");
			const initialBytes = observed.bytes();
			await delay(6200);
			assert.equal(observed.frames.length, 1, "the former five-second full-body keepalive must not recur");
			assert.ok(
				observed.bytes() - initialBytes < 1024,
				"idle transport only permits a small comment/heartbeat",
			);
			const body = "ORIGINAL-DISPLAY-LINE\n".repeat(700);
			await m.client.display(m.ref, { requestId: "actual-change", kind: "card", text: body });
			await until(
				() => observed.frames.some((frame) => frame.kind === "conversation.patch"),
				"a real commit should advance the bounded hot view",
			);
			const patch = observed.frames.find((frame) => frame.kind === "conversation.patch");
			assert.ok(patch?.kind === "conversation.patch");
			assert.equal(patch.patch.entries?.length, 1);
			assert.ok(JSON.stringify(patch).length < body.length);
			let state = applyPocketObservation(undefined, observed.frames[0], {
				serverId: m.http.serverId,
				target: m.ref,
			});
			state = applyPocketObservation(state, patch, { serverId: m.http.serverId, target: m.ref });
			assert.equal(
				state?.snapshot.entries.find((entry) => entry.display?.requestId === "actual-change")?.display
					?.contentReference?.previewComplete,
				false,
			);
			assert.equal(observed.failure(), undefined);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await stream?.close();
			await m.close();
		}
	},
);

test(
	"WebUI transport: a live observer does not occupy the only short control request slot",
	{ timeout: 10000 },
	async () => {
		const m = await fixture({ maxConnections: 1 });
		let stream: Awaited<ReturnType<typeof capture>> | undefined;
		try {
			stream = await capture(
				m,
				new URLSearchParams({ sessionId: m.ref.sessionId, conversationId: m.ref.conversationId }),
			);
			const observed = stream;
			await until(() => observed.frames.length > 0, "the explicitly compatible stream should be established");
			const result = await fetch(m.http.origin + "/pocket/rpc", {
				method: "POST",
				headers: {
					Origin: m.http.origin,
					Cookie: m.admin.cookies,
					"X-Pakka-CSRF": m.admin.csrf,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ version: 2, requestId: "control-probe", command: { op: "list" } }),
			});
			const body = await result.text();
			assert.equal(
				result.status,
				200,
				"control capacity must be independent of long-held observers: " + body,
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await stream?.close();
			await m.close();
		}
	},
);

test(
	"WebUI multiplexed observer: one connection serves selected exact resources and rejects a partially unauthorized set before bytes",
	{ timeout: 10000 },
	async () => {
		const m = await fixture();
		let stream: Awaited<ReturnType<typeof capture>> | undefined;
		try {
			const other = await m.client.create({ requestId: "other", name: "Other", profile: "default" });
			await m.client.display(other, { requestId: "private", kind: "card", text: "PRIVATE-MULTIPLEX-CANARY" });
			const targets = [
				{ sessionId: m.ref.sessionId, conversationId: m.ref.conversationId },
				{ sessionId: other.sessionId, conversationId: other.conversationId },
			];
			const query = new URLSearchParams({ mode: "preview", targets: JSON.stringify(targets) });
			stream = await capture(m, query);
			const observed = stream;
			await until(
				() => observed.frames.filter((frame) => frame.kind === "conversation").length === 2,
				"both authorized hot pages should arrive on one stream",
			);
			assert.equal(new Set(observed.frames.map((frame) => frame.streamId)).size, 1);
			const invitation = await m.people.invite(m.actor, {
				requestId: "scoped",
				role: "viewer",
				resources: [m.people.resourceId(m.ref)],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewer = await m.exchange(invitation.token, "invite", "Reader");
			const denied = await fetch(m.http.origin + "/pocket/events?" + query, {
				headers: { Origin: m.http.origin, Cookie: viewer.cookies },
			});
			assert.equal(denied.status, 403);
			assert.equal((await denied.text()).includes("PRIVATE-MULTIPLEX-CANARY"), false);
			const duplicate = await fetch(
				m.http.origin +
					"/pocket/events?" +
					new URLSearchParams({ mode: "preview", targets: JSON.stringify([targets[0], targets[0]]) }),
				{ headers: { Origin: m.http.origin, Cookie: m.admin.cookies } },
			);
			assert.equal(duplicate.status, 400);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await stream?.close();
			await m.close();
		}
	},
);
