import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { decodePocketProduct } from "../src/main.ts";
import { startPocket } from "../src/bootstrap.ts";
import type { PocketServiceContext } from "../src/backend.ts";

test("Approved directory roots: host JSON admits project trees without combination profiles and refuses changed recovery authority", async () => {
	const m = await runtimeFixture();
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		const child = join(m.f.cwd, "new-project");
		await mkdir(child);
		const raw = {
			runtime: { ...m.config, dataDir: join(m.f.root, "roots-product"), cwdRoots: [m.f.cwd] },
			owner: "Owner",
			initial: [{ name: "Root", profile: "default" }],
		};
		const decoded = decodePocketProduct(raw);
		assert.deepEqual(decoded.runtime.cwdRoots, [m.f.cwd]);
		for (const cwdRoots of [[], ["relative"], [42], Array(65).fill(m.f.cwd)])
			assert.throws(() => decodePocketProduct({ ...raw, runtime: { ...raw.runtime, cwdRoots } }));
		app = await startPocket(decoded);
		assert.deepEqual(app.runtime.directoryRoots(), [m.f.cwd]);
		assert.equal(m.f.requests.length, 0);
		const sessionFile = app.runtime.view().sessionFile;
		await app.close();
		app = undefined;
		await assert.rejects(
			startPocket({
				...decoded,
				runtime: { ...decoded.runtime, reopenSessionFile: sessionFile, cwdRoots: [m.f.root] },
			}),
			/profile|limits|migration|roots/i,
		);
		app = await startPocket({ ...decoded, runtime: { ...decoded.runtime, reopenSessionFile: sessionFile } });
		assert.deepEqual(app.runtime.directoryRoots(), [m.f.cwd]);
	} finally {
		await app?.close();
		await m.close();
	}
});

// Strict JSON startup must preserve the chosen model all the way into the actual product Runtime.
test("Pocket model configuration: approved JSON profiles reach the real product provider; extra credential/endpoint fields stay rejected", async () => {
	const m = await runtimeFixture();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined, context: PocketServiceContext | undefined;
	try {
		await m.runtime.close();
		const profile = {
			id: "alternate",
			systemPrompt: "JSON-APPROVED-MODEL",
			model: "alternate-local-model",
			cwd: process.cwd(),
		};
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
		assert.equal(
			(await client.configuration(ref)).choices.find((choice) => choice.id === "alternate")?.cwd,
			process.cwd(),
		);
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
