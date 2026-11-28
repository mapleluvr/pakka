import { test } from "node:test";
import { strict as assert } from "node:assert";
import { blockSqliteWrites } from "../../agent/test/native-storage.ts";
import { createMas } from "../src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

for (const operation of ["create", "deliver"] as const)
	test(`M2 MAS: unknown ${operation} persistence keeps honest state and seals the Session`, async () => {
		const m = await runtimeFixture();
		let releaseWrites: (() => void) | undefined;
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
			if (operation === "create") {
				releaseWrites = blockSqliteWrites(m.runtime.view().sessionFile);
				await assert.rejects(mas.bootstrap([{ key: "a", owner: "operator" }]));
			} else {
				let admitted = false;
				mas.setAdmission(() => {
					admitted = true;
					// Lock after the membership read so the failure reaches the delivery transaction.
					releaseWrites = blockSqliteWrites(m.runtime.view().sessionFile);
					return true;
				});
				const receipt = await admin.send(before.members[0]!.ref, {
					requestId: "uncertain",
					text: "UNKNOWN-DISPATCH",
				});
				assert.equal(admitted, true);
				assert.equal(receipt.status, "unknown");
				assert.equal(receipt.requestId, "uncertain");
			}
			assert.equal(m.runtime.view().phase, "failed");
			assert.equal((await mas.view()).phase, "unknown");
			assert.equal(m.f.requests.length, 0);
		} finally {
			releaseWrites?.();
			await m.close();
		}
	});

test("M2 MAS: locked membership read rejects before admission and seals the Session", async () => {
	const m = await runtimeFixture();
	let releaseWrites: (() => void) | undefined;
	let admitted = false;
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "locked-read",
			maxDeliveries: 8,
			maxPending: 2,
		});
		await mas.bootstrap([{ key: "a", owner: "operator" }]);
		await mas.activate();
		const before = await mas.view();
		const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
		mas.setAdmission(() => {
			admitted = true;
			return true;
		});
		releaseWrites = blockSqliteWrites(m.runtime.view().sessionFile);
		await assert.rejects(
			admin.send(before.members[0]!.ref, { requestId: "not-admitted", text: "NO-DISPATCH" }),
			/database is locked/,
		);
		assert.equal(admitted, false);
		assert.equal(m.runtime.view().phase, "failed");
		assert.equal((await mas.view()).phase, "unknown");
		assert.equal(m.f.requests.length, 0);
	} finally {
		releaseWrites?.();
		await m.close();
	}
});
