import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketCredentials, type PocketCredentials } from "../src/pocket-credentials.ts";

// Only synthetic keys are used. The independent real HTTP listener is the oracle, not a resolver self-report.
test("Pocket private credentials: explicit replace/clear changes real Authorization, never returns a secret and survives normal reopen without fallback", async () => {
	const authorization: unknown[] = [];
	const server = createServer((req, res) => {
		req.resume();
		req.once("end", () => {
			authorization.push(req.headers.authorization);
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.end(
				'data: {"id":"auth","object":"chat.completion.chunk","model":"local-model","choices":[{"index":0,"delta":{"role":"assistant","content":"AUTHENTICATED-LOCAL-ANSWER"},"finish_reason":null}]}\n\ndata: {"id":"auth","object":"chat.completion.chunk","model":"local-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	let credentials: PocketCredentials | undefined,
		reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	const m = await runtimeFixture({
		endpoint: `http://127.0.0.1:${address.port}/v1`,
		apiKey: "SYNTHETIC-BOOTSTRAP-KEY",
		resolveApiKey: async () => {
			assert.ok(credentials);
			return credentials.resolve();
		},
	});
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "private-people" }),
			session = await people.initializeOwner("Owner"),
			actor = await people.authenticate(session.token);
		credentials = await createPocketCredentials({
			runtime: m.runtime,
			people,
			namespace: "private-credentials",
			bootstrap: () => m.config.apiKey,
		});
		let privateClient = credentials.bind(actor);
		const catalog = { namespace: "private-workspace", maxDeliveries: 8, maxPending: 2 };
		const workspace = createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog,
				profileCeiling: () => ["default"],
			}),
			client = workspace.bind(actor),
			ref = await client.create({ requestId: "main", name: "Main", profile: "default" });
		const invoke = async (id: string) => {
			const sent = await client.submit(ref, { requestId: id, text: "AUTH-WORK-" + id, mode: "prompt" });
			return client.wait(sent.id);
		};
		assert.deepEqual(await privateClient.status(), { version: 0, configured: true });
		assert.equal((await invoke("bootstrap")).status, "done");
		assert.deepEqual(authorization, ["Bearer SYNTHETIC-BOOTSTRAP-KEY"]);
		const replacement = { requestId: "replace", expectedVersion: 0, secret: "SYNTHETIC-REPLACEMENT-KEY" };
		const first = await privateClient.replace(replacement);
		assert.deepEqual(first, { version: 1, configured: true });
		assert.deepEqual(await privateClient.replace(replacement), first);
		await assert.rejects(
			privateClient.replace({ ...replacement, requestId: "blank", expectedVersion: 1, secret: "" }),
		);
		assert.equal((await invoke("replacement")).status, "done");
		assert.equal(authorization[1], "Bearer SYNTHETIC-REPLACEMENT-KEY");
		const invite = await people.invite(actor, {
			requestId: "viewer",
			role: "viewer",
			resources: [ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const viewer = await people.redeem(invite.token, "Viewer"),
			viewerActor = await people.authenticate(viewer.token);
		await assert.rejects(async () => credentials!.bind(viewerActor).status(), /denied/i);
		await assert.rejects(
			async () => credentials!.bind(viewerActor).clear({ requestId: "forbidden", expectedVersion: 1 }),
			/denied/i,
		);
		const cleared = await privateClient.clear({ requestId: "clear", expectedVersion: 1 });
		assert.deepEqual(cleared, { version: 2, configured: false });
		assert.equal((await invoke("cleared")).status, "unanswered");
		assert.equal(authorization.length, 2, "clearing may not fall back to the bootstrap key");
		assert.equal(m.runtime.view().budget.primaryAttempts, 3, "a failed prepared attempt is not refunded");
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		credentials = undefined;
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		const restoredPeople = await createPocketPeople({ runtime: reopened, namespace: "private-people" });
		credentials = await createPocketCredentials({
			runtime: reopened,
			people: restoredPeople,
			namespace: "private-credentials",
			bootstrap: () => "CHANGED-BOOTSTRAP-MUST-NOT-RETURN",
		});
		privateClient = credentials.bind(await restoredPeople.authenticate(session.token));
		assert.deepEqual(await privateClient.status(), cleared);
		await assert.rejects(credentials.resolve(), /credential|configured/i);
		assert.equal(authorization.length, 2);
		assert.equal(reopened.view().budget.primaryAttempts, 3);
		const next = await privateClient.replace({
			requestId: "after-reopen",
			expectedVersion: 2,
			secret: "SYNTHETIC-AFTER-REOPEN",
		});
		const restored = createPocketWorkspace({
			runtime: reopened,
			people: restoredPeople,
			catalog,
			profileCeiling: () => ["default"],
		}).bind(await restoredPeople.authenticate(session.token));
		const sent = await restored.submit(ref, {
			requestId: "after-reopen",
			text: "AFTER-REOPEN-AUTH",
			mode: "prompt",
		});
		assert.equal((await restored.wait(sent.id)).status, "done");
		assert.equal(authorization[2], "Bearer SYNTHETIC-AFTER-REOPEN");
		assert.doesNotMatch(
			JSON.stringify([first, cleared, next, await privateClient.status(), await restored.read(ref)]),
			/SYNTHETIC-|CHANGED-BOOTSTRAP/,
		);
	} finally {
		await reopened?.close();
		await m.close();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
