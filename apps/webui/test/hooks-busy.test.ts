import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceHooksExtensionRoot, workspaceHooksService } from "../src/workflows.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test(
	"Pocket hooks busy product: native queued input survives completed HTTP and extension disable while new ingress is refused",
	{ timeout: 15000 },
	async (t) => {
		const release = deferred();
		let first = true,
			entered = false;
		const m = await runtimeFixture({}, undefined, async () => {
			if (first) {
				first = false;
				entered = true;
				await release.promise;
			}
			return { text: "HOOK-BUSY-DONE" };
		});
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			service: Awaited<ReturnType<typeof workspaceHooksService>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "busy-hook-product") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				extensions: [{ root: workspaceHooksExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => {
					service = await workspaceHooksService(context, { namespace: "busy.hooks" });
					return { hooks: service };
				},
			});
			assert.ok(app.initialOwner);
			assert.ok(service);
			const actor = await app.people.authenticate(app.initialOwner.token),
				target = app.runtime.view().conversations.at(-1)!,
				client = service.bind(actor, target, () => {});
			const added = await client.create({
				requestId: "busy",
				name: "Busy",
				instructions: "Handle the event.",
				signed: false,
				allowOutside: false,
			});
			assert.ok(added.hook);
			const credentials = await client.credentials(added.hook.id);
			const initial = await app.workspace
				.bind(actor)
				.submit(target, { requestId: "blocked", text: "FIRST-BLOCKED-GENERATION", mode: "prompt" });
			assert.equal(initial.status, "placed");
			await t.waitFor(
				() => {
					assert.equal(entered, true);
					assert.equal(m.f.requests.length, 1);
				},
				{ timeout: 3000 },
			);
			const url =
				app.http.origin +
				"/pocket/ingress/workspace-hooks/hooks/" +
				credentials.id +
				"/" +
				credentials.secret;
			const response = await fetch(url, {
				method: "POST",
				headers: { "idempotency-key": "busy-follow-up" },
				body: "QUEUED-HOOK-AFTER-HTTP-CLOSE",
			});
			assert.equal(response.status, 202);
			const result: unknown = await response.json();
			assert.ok(
				result &&
					typeof result === "object" &&
					"state" in result &&
					result.state === "accepted" &&
					"receiptId" in result &&
					typeof result.receiptId === "string",
			);
			assert.equal((await app.workspace.bind(actor).receipt(result.receiptId)).status, "queued");
			assert.equal(m.f.requests.length, 1);
			await app.extensions.setEnabled(actor, "workspace-hooks", false);
			assert.equal((await fetch(url, { method: "POST", body: "NO-NEW-DISABLED-INPUT" })).status, 404);
			release.resolve();
			await app.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			assert.ok(JSON.stringify(m.f.requests[1]).includes("QUEUED-HOOK-AFTER-HTTP-CLOSE"));
			assert.equal(app.runtime.view().budget.primaryAttempts, 2);
			assert.equal((await app.workspace.bind(actor).wait(result.receiptId)).status, "done");
		} finally {
			release.resolve();
			await app?.close();
			await m.close();
		}
	},
);
