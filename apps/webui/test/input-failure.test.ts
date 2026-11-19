import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { loginHttpSession } from "./fixtures/http-session.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";

test(
	"WebUI recoverable model failure: new admission succeeds while its original receipt and spent attempts remain",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture({}, undefined, (_payload, n) =>
			n === 1 ? { error: 400 } : { text: "EXPLICIT-RECOVERY-ANSWER" },
		);
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "input-http-product") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			const owner = await loginHttpSession(app.http.origin, app.initialOwner.token);
			const actor = await app.people.authenticate(/pakka_pocket=([^;]+)/.exec(owner.cookies)![1]!);
			const client = app.workspace.bind(actor);
			const ref = (await client.list())[0]!;
			const rpc = owner.workbench;
			const input = { requestId: "original", text: "FIRST-FAILED", mode: "prompt" as const };
			const start = await rpc({ op: "submit", target: ref, input });
			assert.ok("result" in start.decoded && start.decoded.result.kind === "receipt");
			const id = start.decoded.result.receipt.id;
			await rpc({ op: "wait", id });
			await (await app.runtime.conversation(ref)).waitForIdle();
			const original = await client.receipt(id);
			assert.equal(original.status, "unanswered");
			assert.equal((await client.configuration(ref)).canConfigure, true);
			assert.equal(m.f.requests.length, 1, "the failure must not trigger an automatic retry");
			const retryOriginal = await rpc({ op: "submit", target: ref, input });
			assert.ok("result" in retryOriginal.decoded && retryOriginal.decoded.result.kind === "receipt");
			assert.deepEqual(retryOriginal.decoded.result.receipt, original);
			assert.equal(m.f.requests.length, 1);
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			assert.deepEqual(await client.receipt(id), original);
			const originalEntries = (await client.read(ref)).entries.map((entry) => entry.id);
			const recovery = await rpc({
				op: "submit",
				target: ref,
				input: { ...input, requestId: "new", text: "EXPLICIT-RECOVERY" },
			});
			assert.equal(recovery.response.status, 200);
			assert.ok("result" in recovery.decoded && recovery.decoded.result.kind === "receipt");
			const recoveredId = recovery.decoded.result.receipt.id;
			await rpc({ op: "wait", id: recoveredId });
			assert.equal((await client.receipt(recoveredId)).status, "done");
			assert.deepEqual(await client.receipt(id), original);
			assert.equal(m.f.requests.length, 2);
			assert.equal(app.runtime.view().budget.primaryAttempts, 2);
			assert.equal((await client.list()).length, 1, "recovery does not create a replacement Conversation");
			const history = await rpc({ op: "read", target: ref });
			assert.ok("result" in history.decoded && history.decoded.result.kind === "conversation");
			assert.deepEqual(
				history.decoded.result.snapshot.entries.slice(0, originalEntries.length).map((entry) => entry.id),
				originalEntries,
				"the original failure history remains",
			);
		} finally {
			await app?.close();
			await m.f.close();
		}
	},
);
