import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { stream } from "./events.ts";

// Rejecting a concurrent stale edit must leave the winner unchanged and publish a definite conflict,
// not an opaque unknown or a forged/foreign resource's data. Exercise actual Cookie/RPC/SSE.
test(
	"WebUI collaboration HTTP: scoped attributed events, viewer participation and definite note conflict",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			events: Awaited<ReturnType<typeof stream>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "http-shared") },
				owner: "Alice",
				initial: [
					{ name: "Shared", profile: "default" },
					{ name: "Private", profile: "default" },
				],
				transport: { pollMs: 20 },
			});
			assert.ok(app.initialOwner);
			const origin = app.http.origin;
			async function exchange(token: string, kind: "session" | "invite", name?: string) {
				const response = await fetch(origin + "/pocket/exchange", {
					method: "POST",
					headers: { Origin: origin, "Content-Type": "application/json" },
					body: JSON.stringify({ token, kind, ...(name ? { name } : {}) }),
				});
				assert.equal(response.status, 200);
				const cookie = response.headers
					.getSetCookie()
					.map((row) => row.split(";")[0])
					.join("; ");
				return { cookie, csrf: /pakka_csrf=([^;]+)/.exec(cookie)![1]! };
			}
			const admin = await exchange(app.initialOwner.token, "session");
			async function rpc(command: object, auth = admin) {
				const id = crypto.randomUUID(),
					response = await fetch(origin + "/pocket/rpc", {
						method: "POST",
						headers: {
							Origin: origin,
							Cookie: auth.cookie,
							"X-Pakka-CSRF": auth.csrf,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ version: 2, requestId: id, command }),
					});
				return { status: response.status, value: decodePocketResponse(await response.json(), id) };
			}
			const list = await rpc({ op: "list" });
			assert.ok("result" in list.value && list.value.result.kind === "list");
			const [ref, hidden] = list.value.result.conversations;
			assert.ok(ref && hidden);
			const chat = await rpc({
				op: "collaboration.post",
				target: ref,
				input: { requestId: "chat", text: "ONLY-SHARED-CHAT" },
			});
			assert.equal(chat.status, 200);
			assert.ok("result" in chat.value && chat.value.result.kind === "collaboration");
			assert.equal(chat.value.result.snapshot.messages[0]!.authorName, "Alice");
			await rpc({
				op: "collaboration.post",
				target: hidden,
				input: { requestId: "private", text: "PRIVATE-COLLABORATION-CANARY" },
			});
			const invited = await rpc({
				op: "invite",
				requestId: "viewer",
				role: "viewer",
				resources: [ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(
				"result" in invited.value && invited.value.result.kind === "invite" && invited.value.result.token,
			);
			const viewer = await exchange(invited.value.result.token, "invite", "Bob");
			events = await stream(origin, ref.conversationId, viewer.cookie);
			assert.equal((await events.next())?.kind, "conversation");
			const shared = await events.next();
			assert.ok(shared?.kind === "collaboration");
			assert.equal(shared.snapshot.messages[0]!.authorName, "Alice");
			assert.doesNotMatch(JSON.stringify(shared), /PRIVATE-COLLABORATION-CANARY|fingerprint|tokenHash/);
			const foreign = await rpc({ op: "collaboration.read", target: hidden }, viewer);
			assert.equal(foreign.status, 403);
			assert.ok("error" in foreign.value && foreign.value.error.outcome === "denied");
			const forged = await rpc(
				{
					op: "collaboration.post",
					target: ref,
					input: { requestId: "forge", text: "x", authorId: "Alice" },
				},
				viewer,
			);
			assert.equal(forged.status, 400);
			assert.equal(
				(
					await rpc(
						{
							op: "collaboration.post",
							target: ref,
							input: { requestId: "human", text: "VIEWER-HUMAN-ONLY" },
						},
						viewer,
					)
				).status,
				200,
			);
			assert.equal(
				(
					await rpc(
						{ op: "collaboration.note", target: ref, input: { expectedVersion: 0, text: "forbidden" } },
						viewer,
					)
				).status,
				403,
			);
			const saved = await rpc({
				op: "collaboration.note",
				target: ref,
				input: { expectedVersion: 0, text: "WINNING-NOTE" },
			});
			assert.equal(saved.status, 200);
			const stale = await rpc({
				op: "collaboration.note",
				target: ref,
				input: { expectedVersion: 0, text: "LOST-EDIT" },
			});
			assert.equal(stale.status, 409);
			assert.ok("error" in stale.value);
			assert.equal(stale.value.error.code, "CONFLICT");
			assert.equal(stale.value.error.outcome, "denied");
			const final = await rpc({ op: "collaboration.read", target: ref });
			assert.ok("result" in final.value && final.value.result.kind === "collaboration");
			assert.equal(final.value.result.snapshot.note.text, "WINNING-NOTE");
			assert.equal(final.value.result.snapshot.note.version, 1);
			assert.equal(m.f.requests.length, 0);
			assert.deepEqual(m.f.errors, []);
		} finally {
			events?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
