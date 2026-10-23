import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime, type Runtime } from "../../../packages/agent/src/index.ts";
import { createPocketPeople, createPocketWorkspace } from "@pakka/server/pocket";
import { fixture } from "./fixture.ts";

test("WebUI navigation normal reopen: metadata and original receipt persist without rewriting history, effects or spent attempts", async () => {
	const m = await fixture();
	let runtime: Runtime | undefined;
	try {
		const sent = await m.client.submit(m.ref, {
			requestId: "original-input",
			mode: "prompt",
			text: "ONE-NATIVE-EFFECT",
		});
		await m.client.wait(sent.id);
		const input = {
			requestId: "original-metadata",
			expectedVersion: 0,
			name: "Persisted title",
			archived: true,
		};
		const result = await m.client.setMetadata(m.ref, input);
		const before = m.runtime.view(),
			token = /pakka_pocket=([^;]+)/.exec(m.admin.cookies)![1]!;
		await m.http.close();
		await m.runtime.close();
		runtime = await createRuntime({ ...m.config, reopenSessionFile: before.sessionFile });
		const people = await createPocketPeople({ runtime, namespace: "people" }),
			actor = await people.authenticate(token);
		const workspace = createPocketWorkspace({
				runtime,
				people,
				catalog: { namespace: "pocket", maxDeliveries: 32, maxPending: 8 },
				profileCeiling: () => ["default"],
			}),
			client = workspace.bind(actor);
		const navigation = await client.navigation();
		assert.equal(navigation[0]!.name, "Persisted title");
		assert.equal(navigation[0]!.archived, true);
		assert.equal(navigation[0]!.version, 1);
		const catalog = runtime.catalog({ namespace: "pocket", maxDeliveries: 32, maxPending: 8 }),
			version = (await catalog.snapshot()).version;
		assert.deepEqual(await client.setMetadata(m.ref, input), result);
		assert.equal(
			(await catalog.snapshot()).version,
			version,
			"original metadata result is read, not written again",
		);
		assert.match(JSON.stringify((await client.read(m.ref)).entries), /ONE-NATIVE-EFFECT/);
		assert.equal(runtime.view().budget.primaryAttempts, before.budget.primaryAttempts);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await runtime?.close();
		await m.close();
	}
});
