import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket, type PocketServiceContext } from "../src/bootstrap.ts";

// A product-specific MAS import in the shell is unnecessary; this public composition callback serves any trusted extension.
test(
	"Pocket service assembly: trusted factory receives the existing writer/identity and original owner on normal reopen",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		const contexts: PocketServiceContext[] = [];
		const services = async (context: PocketServiceContext) => {
			contexts.push(context);
			assert.equal(context.runtime.view().phase, "ready");
			return {};
		};
		const options = {
			runtime: { ...m.config, dataDir: m.f.dataDir + "/services" },
			owner: "Owner",
			initial: [{ name: "Project", profile: "default" }],
			extensionServices: services,
		};
		try {
			app = await startPocket(options);
			assert.equal(contexts.length, 1);
			const original = contexts[0]!;
			assert.equal(original.ownerId, app.initialOwner!.person.id);
			assert.equal(original.runtime, app.runtime);
			const file = app.runtime.view().sessionFile;
			await app.close();
			app = await startPocket({ ...options, runtime: { ...options.runtime, reopenSessionFile: file } });
			assert.equal(contexts.length, 2);
			assert.equal(contexts[1]!.ownerId, original.ownerId);
			assert.equal(app.initialOwner, null);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await app?.close();
			await m.f.close();
		}
	},
);
