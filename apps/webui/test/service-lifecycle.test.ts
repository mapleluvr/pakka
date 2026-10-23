import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";

for (const startupFailure of [false, true])
	test(`WebUI services: ${startupFailure ? "failed registration" : "normal product close"} releases host-owned listeners`, async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		const listener = createServer((_req, res) => res.end("OWNED-RESOURCE"));
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			const options = {
				runtime: { ...m.config, dataDir: join(m.f.root, "owned-product-services") },
				owner: "Owner",
				extensions: startupFailure
					? [{ root: join(m.f.root, "missing-extension"), facets: ["backend" as const] }]
					: [],
				extensionServices: async () => {
					await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
					const address = listener.address();
					assert.ok(address && typeof address !== "string");
					assert.equal(await (await fetch("http://127.0.0.1:" + address.port)).text(), "OWNED-RESOURCE");
					return {
						owned: {
							permission: "read" as const,
							bind: () => Object.freeze({}),
							dispose: async () => {
								listener.closeAllConnections();
								await new Promise<void>((resolve, reject) =>
									listener.close((error) => (error ? reject(error) : resolve())),
								);
							},
						},
					};
				},
			};
			if (startupFailure) await assert.rejects(startPocket(options));
			else {
				app = await startPocket(options);
				await app.close();
			}
			assert.equal(
				listener.listening,
				false,
				"the actual owned listener is closed, not merely hidden in the UI",
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await app?.close();
			if (listener.listening) {
				listener.closeAllConnections();
				await new Promise<void>((resolve) => listener.close(() => resolve()));
			}
			await m.f.close();
		}
	});
