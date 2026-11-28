import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { WEBUI_SERVICE_API, decodeWebUiResponse } from "@pakka/protocol/webui";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { loginHttpSession, connectHttpSession } from "./fixtures/http-session.ts";

// Release/webui heavy: the production projection and decoder must retain native error history after reopen.
test("WebUI error history: a cleared-credential failure stays readable after restart without replay", async () => {
	const m = await runtimeFixture();
	await m.runtime.close();
	const runtime = { ...m.config, dataDir: join(m.f.root, "error-history") };
	const initial = [{ name: "Error history", profile: "default" }];
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		app = await startPocket({ runtime, owner: "Owner", initial });
		assert.ok(app.initialOwner);
		let owner = await loginHttpSession(app.http.origin, app.initialOwner.token);
		const list = await owner.workbench({ op: "list" });
		assert.ok("result" in list.decoded && list.decoded.result.kind === "list");
		const target = list.decoded.result.conversations[0]!;
		const cleared = await owner.workbench({
			op: "credential.clear",
			input: { requestId: "clear", expectedVersion: 0 },
		});
		assert.equal(cleared.response.status, 200);
		const sent = await owner.workbench({
			op: "submit",
			target,
			input: { requestId: "failed-original", text: "ERROR-HISTORY-ORIGINAL", mode: "prompt" },
		});
		assert.ok("result" in sent.decoded && sent.decoded.result.kind === "receipt");
		const receiptId = sent.decoded.result.receipt.id;
		const completed = await owner.workbench({ op: "wait", id: receiptId });
		assert.ok("result" in completed.decoded && completed.decoded.result.kind === "receipt");
		assert.equal(completed.decoded.result.receipt.status, "unanswered");
		const sessionFile = app.runtime.view().sessionFile;
		assert.equal(app.runtime.view().budget.primaryAttempts, 1);
		assert.equal(m.f.requests.length, 0);
		await app.close();
		app = undefined;
		app = await startPocket({
			runtime: { ...runtime, reopenSessionFile: sessionFile },
			owner: "Owner",
			initial,
		});
		owner = await connectHttpSession(app.http.origin, owner.cookies);
		const requestId = crypto.randomUUID();
		const response = await fetch(app.http.origin + "/pakka-webui/services", {
			method: "POST",
			headers: owner.headers,
			body: JSON.stringify({
				api: WEBUI_SERVICE_API,
				requestId,
				binding: { personId: owner.person.id, serverId: app.http.serverId },
				command: {
					op: "resource.history",
					reference: {
						kind: "conversation",
						sessionId: target.sessionId,
						conversationId: target.conversationId,
					},
				},
			}),
		});
		assert.equal(response.status, 200);
		const result = decodeWebUiResponse(await response.json(), requestId);
		assert.ok(
			"result" in result &&
				result.result.kind === "resource-history" &&
				result.result.history.status === "loaded",
		);
		const messages = result.result.history.snapshot.entries.flatMap((entry) => entry.messages);
		assert.ok(JSON.stringify(messages).includes("ERROR-HISTORY-ORIGINAL"));
		assert.ok(
			messages.some((message) =>
				message.errorMessage?.includes("Configured provider credential unavailable"),
			),
		);
		const receipt = await owner.workbench({ op: "receipt", id: receiptId });
		assert.ok("result" in receipt.decoded && receipt.decoded.result.kind === "receipt");
		assert.deepEqual(receipt.decoded.result.receipt, completed.decoded.result.receipt);
		assert.equal(app.runtime.view().budget.primaryAttempts, 1);
		assert.equal(
			m.f.requests.length,
			0,
			"Reading failed history cannot dispatch or fall back to the bootstrap credential",
		);
	} finally {
		await app?.close();
		await m.f.close();
	}
});
