import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas } from "../src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { deferred } from "../../agent/test/fixture.ts";

test("M4: composed authority is rechecked at admission commit and cannot remove a revoked parent lease", async () => {
	const m = await runtimeFixture();
	const entered = deferred(),
		release = deferred();
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "composed",
			maxDeliveries: 8,
			maxPending: 2,
		});
		await mas.bootstrap([
			{ key: "a", owner: "operator" },
			{ key: "b", owner: "operator" },
		]);
		await mas.activate();
		const [a, b] = (await mas.view()).members;
		const base = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
		assert.equal(typeof Reflect.get(base, "authorize"), "function", "Missing pure grant authorization");
		assert.equal(typeof Reflect.get(base, "withAuthority"), "function", "Missing composed effect gate");
		const extended = base as typeof base & {
			authorize(action: "send" | "spawn"): void;
			withAuthority(check: () => void): typeof base;
		};
		extended.authorize("send");
		assert.throws(() => extended.authorize("spawn"), /grant/);
		assert.equal(m.f.requests.length, 0);
		let enabled = true;
		const bound = extended.withAuthority(() => {
			if (!enabled) throw new Error("Contribution revoked");
		});
		mas.setAdmission(async () => {
			entered.resolve();
			await release.promise;
			return true;
		});
		const operation = bound.send(b!.ref, { requestId: "late", text: "COMPOSED-MUST-NOT-SEND" });
		await entered.promise;
		enabled = false;
		release.resolve();
		await assert.rejects(operation, /revoked/);
		assert.equal(m.f.requests.length, 0);
		mas.revoke("a");
		assert.throws(() => extended.withAuthority(() => {}), /revoked/);
	} finally {
		release.resolve();
		await m.close();
	}
});
