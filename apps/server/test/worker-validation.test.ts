import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "../../../packages/agent/test/fixture.ts";
import { createWorkerManager } from "../src/worker-manager.ts";

// Missing early UUID validation accepts these presets before probing a derived path or spawning a child.
for (const reservedSessionId of [
	"../../outside-reservation",
	"not-a-uuid",
	"91383703-b5ca-441c-81de-72b487a3e2bg",
	"91383703-b5ca-441c-81de-72b487a3e2bA",
]) {
	test(
		"M3 review: invalid reserved Session identity is refused at manager construction: " + reservedSessionId,
		async () => {
			const f = await fixture();
			let manager: ReturnType<typeof createWorkerManager> | undefined;
			try {
				assert.throws(() => {
					manager = createWorkerManager({
						maxWorkers: 1,
						startupTimeoutMs: 5000,
						requestTimeoutMs: 5000,
						placements: {
							one: {
								runtime: {
									cwd: f.cwd,
									dataDir: f.dataDir,
									endpoint: f.endpoint,
									model: "local-model",
									apiKey: "local-only",
									systemPrompt: "validation",
									reservedSessionId,
									limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
								},
								catalog: { namespace: "members", maxDeliveries: 8, maxPending: 2 },
							},
						},
					});
				}, /reserved|identity|UUID/);
				assert.equal(f.requests.length, 0);
				assert.equal(existsSync(join(f.dataDir, "sessions", reservedSessionId)), false);
			} finally {
				await manager?.close();
				await f.close();
			}
		},
	);
}
