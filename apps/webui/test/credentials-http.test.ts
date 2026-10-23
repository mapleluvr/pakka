import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { decodePocketResponse } from "../../../packages/protocol/src/pocket.ts";

test(
	"WebUI private HTTP: real product preserves the host resolver, scopes replace/clear, never returns secrets and reopens cleared",
	{ timeout: 20000 },
	async () => {
		let lookups = 0;
		const m = await runtimeFixture({
			apiKey: "SYNTHETIC-STARTUP-KEY",
			resolveApiKey: () => {
				lookups++;
				return "SYNTHETIC-EXISTING-SOURCE";
			},
		});
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			await m.runtime.close();
			const config = {
				runtime: { ...m.config, dataDir: join(m.f.root, "private-http") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			};
			app = await startPocket(config);
			assert.ok(app.initialOwner);
			async function exchange(token: string, kind = "session") {
				const response = await fetch(app!.http.origin + "/pocket/exchange", {
					method: "POST",
					headers: { Origin: app!.http.origin, "Content-Type": "application/json" },
					body: JSON.stringify({ kind, token, ...(kind === "invite" ? { name: "Viewer" } : {}) }),
				});
				assert.equal(response.status, 200);
				const cookies = response.headers
					.getSetCookie()
					.map((value) => value.split(";")[0])
					.join("; ");
				return { cookies, csrf: /pakka_csrf=([^;]+)/.exec(cookies)![1]! };
			}
			const admin = await exchange(app.initialOwner.token);
			async function rpc(command: object, auth = admin) {
				const requestId = crypto.randomUUID(),
					response = await fetch(app!.http.origin + "/pocket/rpc", {
						method: "POST",
						headers: {
							Origin: app!.http.origin,
							"Content-Type": "application/json",
							Cookie: auth.cookies,
							"X-Pakka-CSRF": auth.csrf,
						},
						body: JSON.stringify({ version: 2, requestId, command }),
					});
				const text = await response.text();
				assert.doesNotMatch(
					text,
					/SYNTHETIC-STARTUP-KEY|SYNTHETIC-EXISTING-SOURCE|SYNTHETIC-REPLACEMENT-KEY/,
				);
				return { response, value: decodePocketResponse(JSON.parse(text), requestId) };
			}
			const initial = await rpc({ op: "credential.status" });
			assert.equal(initial.response.status, 200);
			assert.ok("result" in initial.value && initial.value.result.kind === "credential");
			assert.deepEqual(initial.value.result.status, { version: 0, configured: true });
			assert.equal(lookups, 0);
			const list = await rpc({ op: "list" });
			assert.ok("result" in list.value && list.value.result.kind === "list");
			const ref = list.value.result.conversations[0]!;
			async function invoke(id: string) {
				const sent = await rpc({
					op: "submit",
					target: ref,
					input: { requestId: id, text: "PRIVATE-HTTP-" + id, mode: "prompt" },
				});
				assert.ok("result" in sent.value && sent.value.result.kind === "receipt");
				const done = await rpc({ op: "wait", id: sent.value.result.receipt.id });
				assert.ok("result" in done.value && done.value.result.kind === "receipt");
				return done.value.result.receipt;
			}
			assert.equal((await invoke("bootstrap")).status, "done");
			assert.equal(m.f.authorization[0], "Bearer SYNTHETIC-EXISTING-SOURCE");
			assert.equal(lookups, 1);
			const input = { requestId: "replace", expectedVersion: 0, secret: "SYNTHETIC-REPLACEMENT-KEY" };
			const replacement = await rpc({ op: "credential.replace", input });
			assert.equal(replacement.response.status, 200);
			const repeated = await rpc({ op: "credential.replace", input });
			assert.ok("result" in replacement.value && "result" in repeated.value);
			assert.deepEqual(repeated.value.result, replacement.value.result);
			assert.equal(
				(
					await rpc({
						op: "credential.replace",
						input: { ...input, requestId: "invalid", expectedVersion: 1, secret: "" },
					})
				).response.status,
				400,
			);
			assert.equal(
				(await rpc({ op: "credential.replace", input: { ...input, requestId: "stale", secret: "OTHER" } }))
					.response.status,
				409,
			);
			assert.equal((await invoke("replacement")).status, "done");
			assert.equal(m.f.authorization[1], "Bearer SYNTHETIC-REPLACEMENT-KEY");
			assert.equal(lookups, 1);
			const actor = await app.people.authenticate(/pakka_pocket=([^;]+)/.exec(admin.cookies)![1]!);
			for (const role of ["viewer", "admin"] as const) {
				const invite = await app.people.invite(actor, {
					requestId: "restricted-" + role,
					role,
					resources: [ref.conversationId],
					ttlMs: 60000,
				});
				assert.ok(invite.token);
				const restricted = await exchange(invite.token, "invite");
				for (const command of [
					{ op: "credential.status" },
					{
						op: "credential.replace",
						input: { requestId: "forbidden", expectedVersion: 1, secret: "UNAUTHORIZED" },
					},
					{ op: "credential.clear", input: { requestId: "forbidden", expectedVersion: 1 } },
				])
					assert.equal((await rpc(command, restricted)).response.status, 403);
			}
			const cleared = await rpc({
				op: "credential.clear",
				input: { requestId: "clear", expectedVersion: 1 },
			});
			assert.equal(cleared.response.status, 200);
			assert.equal((await invoke("cleared")).status, "unanswered");
			assert.equal(m.f.requests.length, 2);
			assert.equal(app.runtime.view().budget.primaryAttempts, 3);
			const sessionFile = app.runtime.view().sessionFile,
				port = Number(new URL(app.http.origin).port);
			await app.close();
			app = await startPocket({
				...config,
				runtime: { ...config.runtime, reopenSessionFile: sessionFile },
				transport: { port },
			});
			const restored = await rpc({ op: "credential.status" });
			assert.ok("result" in restored.value && restored.value.result.kind === "credential");
			assert.deepEqual(restored.value.result.status, { version: 2, configured: false });
			assert.equal(app.runtime.view().budget.primaryAttempts, 3);
			assert.equal(m.f.requests.length, 2);
			assert.equal(lookups, 1);
		} finally {
			await app?.close();
			await m.close();
		}
	},
);
