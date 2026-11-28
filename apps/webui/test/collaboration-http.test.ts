import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { POCKET_VERSION, decodePocketResponse } from "@pakka/protocol/pocket";
import { stream } from "./events.ts";
import { decodeWebUiResponse, WEBUI_SERVICE_API, type WebUiCommand } from "@pakka/protocol/webui";
import { executeCollaboration } from "../src/collaboration-service.ts";
import { WebUiServiceRefusal } from "../src/service-refusal.ts";

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
						body: JSON.stringify({ version: POCKET_VERSION, requestId: id, command }),
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
			assert.equal(saved.status, 400);
			const instance = app;
			async function service(command: WebUiCommand, auth = admin) {
				const actor = await instance.people.authenticate(/pakka_pocket=([^;]+)/.exec(auth.cookie)![1]!);
				const requestId = crypto.randomUUID();
				const response = await fetch(origin + "/pakka-webui/services", {
					method: "POST",
					headers: {
						Origin: origin,
						Cookie: auth.cookie,
						"X-Pakka-CSRF": auth.csrf,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						api: WEBUI_SERVICE_API,
						requestId,
						binding: { personId: instance.people.current(actor).id, serverId: instance.http.serverId },
						command,
					}),
				});
				return { status: response.status, value: decodeWebUiResponse(await response.json(), requestId) };
			}
			const viewerView = await service({ op: "collaboration.read", target: ref }, viewer);
			assert.equal(viewerView.status, 200);
			assert.ok("result" in viewerView.value && viewerView.value.result.kind === "collaboration");
			assert.equal(viewerView.value.result.view.canEditNote, false);
			assert.equal(viewerView.value.result.view.canPin, false);
			assert.equal(viewerView.value.result.view.canControl, false);
			const original = {
				requestId: "public-note",
				target: ref,
				action: {
					kind: "save" as const,
					id: "public-note",
					expectedVersion: 0,
					title: "",
					sources: [],
					body: "PUBLIC-ORIGINAL-NOTE",
				},
			};
			const written = await service({ op: "notebook.write", change: original });
			assert.equal(written.status, 200);
			assert.ok("result" in written.value && written.value.result.kind === "notebook-receipt");
			assert.equal(written.value.result.receipt.version, 1);
			await service({
				op: "notebook.write",
				change: {
					requestId: "public-later-note",
					target: ref,
					action: {
						kind: "save",
						id: "public-note",
						expectedVersion: 1,
						title: "",
						sources: [],
						body: "PUBLIC-LATER-NOTE",
					},
				},
			});
			const recovered = await service({ op: "notebook.lookup", original });
			assert.equal(recovered.status, 200);
			assert.ok("result" in recovered.value && recovered.value.result.kind === "notebook-operation");
			assert.deepEqual(recovered.value.result.receipt, written.value.result.receipt);
			const wrong = await service({
				op: "notebook.lookup",
				original: { ...original, action: { ...original.action, body: "ALTERED-ORIGINAL" } },
			});
			assert.equal(wrong.status, 409);
			const other = await service({ op: "notebook.lookup", original }, viewer);
			assert.ok("result" in other.value && other.value.result.kind === "notebook-operation");
			assert.equal(other.value.result.receipt, null);
			const forbidden = await service(
				{ op: "notebook.write", change: { ...original, requestId: "viewer-note" } },
				viewer,
			);
			assert.equal(forbidden.status, 403);
			assert.ok("error" in forbidden.value && forbidden.value.error.outcome === "denied");
			const conflict = await service({
				op: "notebook.write",
				change: { ...original, requestId: "stale-public-note" },
			});
			assert.equal(conflict.status, 409);
			assert.ok("error" in conflict.value && conflict.value.error.outcome === "denied");

			const ownerActor = await instance.people.authenticate(/pakka_pocket=([^;]+)/.exec(admin.cookie)![1]!);
			const afterCommit = {
				requestId: "after-commit",
				target: ref,
				action: { kind: "post" as const, text: "NOTE-LANDED-BEFORE-REFUSAL" },
			};
			let landed = false;
			const observed = {
				...instance.collaboration,
				bind: (actor: typeof ownerActor) => {
					const native = instance.collaboration.bind(actor);
					return {
						...native,
						write: async (request: typeof afterCommit) => {
							const receipt = await native.write(request);
							landed = true;
							return receipt;
						},
					};
				},
			};
			await assert.rejects(
				executeCollaboration(
					{
						actor: ownerActor,
						people: instance.people,
						collaboration: observed,
						check: () => {
							if (landed) throw new WebUiServiceRefusal("FORBIDDEN");
						},
					},
					{ op: "collaboration.write", change: afterCommit },
				),
				(error: unknown) =>
					error instanceof WebUiServiceRefusal && error.code === "UNKNOWN" && !error.confirmedNoEffect,
			);
			assert.equal(
				(await instance.collaboration.bind(ownerActor).snapshot(ref)).messages.at(-1)!.text,
				afterCommit.action.text,
			);
			assert.ok(await instance.collaboration.bind(ownerActor).lookup(afterCommit));
			assert.equal(m.f.requests.length, 0);
			assert.deepEqual(m.f.errors, []);
		} finally {
			events?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
