import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { startPocket } from "../src/bootstrap.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

test("Session recovery HTTP uses the original identity, safe diagnostics and current global authority", async () => {
	const m = await runtimeFixture();
	const config = { ...m.config, dataDir: join(m.f.root, "recovery-http") };
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({ runtime: config, owner: "Owner" });
		assert.ok(app.initialOwner);
		const token = app.initialOwner.token;
		const actor = await app.people.authenticate(token);
		const child = await app.sessions!.create(actor, {
			requestId: "child",
			name: "Original Session",
			cwd: m.f.cwd,
		});
		const file = app.sessions!.runtimeFor({ sessionId: child.id }).view().sessionFile;
		const controlFile = app.runtime.view().sessionFile;
		const invited = await app.people.invite(actor, {
			requestId: "viewer",
			role: "viewer",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invited.token);
		const viewer = await app.people.redeem(invited.token, "Viewer");
		await app.close();
		app = undefined;
		const original = await readFile(file);
		await unlink(file);
		app = await startPocket({ runtime: { ...config, reopenSessionFile: controlFile }, owner: "Owner" });
		const origin = app.http.origin;
		const signIn = async (token: string) => {
			const response = await fetch(origin + "/pocket/exchange", {
				method: "POST",
				headers: { Origin: origin, "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "session", token }),
			});
			assert.equal(response.status, 200);
			const cookie = response.headers
				.getSetCookie()
				.map((value) => value.split(";")[0])
				.join("; ");
			const csrf = /pakka_csrf=([^;]+)/.exec(cookie)?.[1];
			assert.ok(csrf);
			return async (command: Record<string, unknown>) => {
				const requestId = crypto.randomUUID();
				const response = await fetch(origin + "/pocket/rpc", {
					method: "POST",
					headers: {
						Origin: origin,
						Cookie: cookie,
						"X-Pakka-CSRF": csrf,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ version: 2, requestId, command }),
				});
				const body = await response.json();
				if (response.ok) decodePocketResponse(body, requestId);
				return { status: response.status, body };
			};
		};
		const owner = await signIn(token);
		const unavailable = await owner({ op: "session.reopen", sessionId: child.id });
		assert.equal(unavailable.status, 200, JSON.stringify(unavailable.body));
		assert.equal(unavailable.body.result.kind, "session.state");
		assert.deepEqual(unavailable.body.result.session.problem, { kind: "open-failed", canReopen: true });
		assert.equal(unavailable.body.result.session.id, child.id);
		assert.equal(unavailable.body.result.session.status, "unavailable");
		assert.doesNotMatch(JSON.stringify(unavailable.body), /ENOENT|lstat|main\.sqlite|stack/);
		const denied = await (await signIn(viewer.token))({ op: "session.reopen", sessionId: child.id });
		assert.equal(denied.status, 403);
		assert.equal(denied.body.error.outcome, "denied");
		await writeFile(file, original);
		const recovered = await owner({ op: "session.reopen", sessionId: child.id });
		assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
		assert.equal(recovered.body.result.session.status, "ready");
		assert.equal(recovered.body.result.session.id, child.id);
		assert.equal(recovered.body.result.session.problem, undefined);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.close();
	}
});
