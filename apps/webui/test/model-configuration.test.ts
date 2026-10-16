import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { decodePocketProduct } from "../src/main.ts";
import { startPocket } from "../src/bootstrap.ts";
import type { PocketServiceContext } from "../src/backend.ts";

// Strict JSON startup must preserve the chosen model all the way into the actual product Runtime.
test("Pocket model configuration: approved JSON profiles reach the real product provider; extra credential/endpoint fields stay rejected", async () => {
	const m = await runtimeFixture();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined, context: PocketServiceContext | undefined;
	try {
		await m.runtime.close();
		const profile = { id: "alternate", systemPrompt: "JSON-APPROVED-MODEL", model: "alternate-local-model" };
		const raw = {
			runtime: { ...m.config, dataDir: join(m.f.root, "model-product"), profiles: [profile] },
			owner: "Owner",
			profiles: ["default", "alternate"],
			initial: [{ name: "Model project", profile: "alternate" }],
		};
		for (const extra of [{ endpoint: "http://127.0.0.1:1" }, { apiKey: "FORBIDDEN-PROFILE-KEY" }])
			assert.throws(
				() =>
					decodePocketProduct({ ...raw, runtime: { ...raw.runtime, profiles: [{ ...profile, ...extra }] } }),
				/configuration/i,
			);
		app = await startPocket({
			...decodePocketProduct(raw),
			extensionServices: (value) => {
				context = value;
				return {};
			},
		});
		assert.ok(context);
		assert.ok(app.initialOwner);
		const client = context.workspace.bind(await context.people.authenticate(app.initialOwner.token)),
			ref = (await client.list())[0]!;
		const sent = await client.submit(ref, {
			requestId: "json-model",
			text: "JSON-PRODUCT-MODEL-WORK",
			mode: "prompt",
		});
		assert.equal((await client.wait(sent.id)).status, "done");
		assert.equal(m.f.requests.length, 1);
		assert.equal(m.f.requests[0]?.model, "alternate-local-model");
		assert.equal(app.runtime.view().budget.primaryAttempts, 1);
	} finally {
		await app?.close();
		await m.close();
	}
});
