import { test } from "node:test";
import { strict as assert } from "node:assert";
import { POCKET_VERSION, decodePocketRequest } from "../src/pocket.ts";

// Mechanical wire gate only. Real native storage, effects and receipts are covered by session-creation.test.ts.
test("WebUI Session selectors: receipt reads keep the native ID and carry a separate parent Session", () => {
	for (const op of ["receipt", "wait", "withdraw"]) {
		const command = { op, id: "catalog-native-original", sessionId: "native-parent" };
		assert.deepEqual(
			decodePocketRequest({ version: POCKET_VERSION, requestId: "read-original", command }).command,
			command,
		);
		assert.throws(() =>
			decodePocketRequest({
				version: POCKET_VERSION,
				requestId: "invalid",
				command: { ...command, sessionId: "../outside" },
			}),
		);
		assert.throws(() =>
			decodePocketRequest({
				version: POCKET_VERSION,
				requestId: "invalid",
				command: { ...command, sessionId: { id: "native-parent" } },
			}),
		);
	}
	for (const op of ["invite.revoke", "person.revoke"])
		assert.throws(() =>
			decodePocketRequest({
				version: POCKET_VERSION,
				requestId: "not-a-receipt",
				command: { op, id: "person-id", sessionId: "native-parent" },
			}),
		);
});
