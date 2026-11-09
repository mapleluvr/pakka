import { test } from "node:test";
import assert from "node:assert/strict";
import { Server } from "node:http";
import { fixture } from "../../../packages/agent/test/fixture.ts";
import { runtimeLimits } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";

// Rebinding must be used by both the deterministic provider and the actual WebUI entry.
// Control the reported port, not a host-specific permission to bind that fixed port.
test("WebUI and its model endpoint remain reachable after rejecting a reported blocked dynamic port", async (t) => {
	const original = Server.prototype.address,
		seen = new WeakSet<Server>();
	let rejected = 0;
	t.mock.method(Server.prototype, "address", function (this: Server) {
		const address = Reflect.apply(original, this, []);
		if (!seen.has(this) && address && typeof address !== "string") {
			seen.add(this);
			rejected++;
			return { ...address, port: 4045 };
		}
		return address;
	});
	const f = await fixture();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		assert.notEqual(
			new URL(f.endpoint).port,
			"4045",
			"provider fixture must not publish an unusable endpoint",
		);
		app = await startPocket({
			runtime: {
				cwd: f.cwd,
				dataDir: f.dataDir,
				endpoint: f.endpoint,
				model: "local-model",
				apiKey: "local-only",
				limits: runtimeLimits,
			},
			owner: "Owner",
		});
		assert.ok(rejected >= 2, "both provider and WebUI must reject their first reported address");
		const origin = new URL(app.http.origin);
		assert.equal(origin.protocol, "http:");
		assert.equal(origin.hostname, "127.0.0.1");
		const response = await fetch(origin, { redirect: "error" });
		assert.equal(response.status, 200);
		const host = app.runtime.root();
		await host.connect("port-check", ["input.submit"]).submit({ key: "check", text: "SAFE-HTTP-PORT" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 1);
		assert.deepEqual(f.errors, []);
	} finally {
		await app?.close();
		await f.close();
	}
});
