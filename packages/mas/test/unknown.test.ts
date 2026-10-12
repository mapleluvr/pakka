import { test } from "node:test";
import { strict as assert } from "node:assert";
import { rename, mkdir, rm } from "node:fs/promises";
import { createMas } from "../src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

for (const operation of ["create", "deliver"] as const)
	test(`M2 MAS: unknown ${operation} persistence keeps honest state and seals the Session`, async () => {
		const m = await runtimeFixture();
		let file: string | undefined;
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "unknown",
				maxDeliveries: 8,
				maxPending: 2,
			});
			if (operation === "deliver") {
				await mas.bootstrap([{ key: "a", owner: "operator" }]);
				await mas.activate();
			}
			const before = await mas.view(),
				admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
			file = m.runtime.view().sessionFile;
			await rename(file, file + ".saved");
			await mkdir(file);
			if (operation === "create") await assert.rejects(mas.bootstrap([{ key: "a", owner: "operator" }]));
			else {
				const receipt = await admin.send(before.members[0]!.ref, {
					requestId: "uncertain",
					text: "UNKNOWN-DISPATCH",
				});
				assert.equal(receipt.status, "unknown");
			}
			assert.equal(m.runtime.view().phase, "failed");
			assert.equal((await mas.view()).phase, "unknown");
			assert.equal(m.f.requests.length, 0);
		} finally {
			if (file) {
				await rm(file, { recursive: true });
				await rename(file + ".saved", file);
			}
			await m.close();
		}
	});
