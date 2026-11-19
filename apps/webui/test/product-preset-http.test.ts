import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startPocket } from "../src/bootstrap.ts";
import { createLocalProduct } from "../src/product-runtime.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { loginHttpSession } from "./fixtures/http-session.ts";

// Preserve the public creation/configuration seam and actual tool restriction while the old renderer exits.
test(
	"local WebUI HTTP creates the selected read-only preset independently of its model",
	{ timeout: 45000 },
	async () => {
		const p = await isolated((_body, n) =>
			n === 1
				? { tool: "read", args: { path: "protected.txt" } }
				: n === 2
					? { tool: "write", args: { path: "protected.txt", content: "WRONG" } }
					: { text: "PRESET-COMPLETE" },
		);
		let options: Awaited<ReturnType<typeof createLocalProduct>> | undefined;
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			await configuration(p.agentDir, p.f.endpoint);
			await writeFile(join(p.f.cwd, "protected.txt"), "READ-ONLY-ORACLE");
			options = await createLocalProduct({ cwd: p.f.cwd, dataDir: p.f.dataDir, agentDir: p.agentDir });
			app = await startPocket(options);
			assert.ok(app.initialOwner);
			const http = await loginHttpSession(app.http.origin, app.initialOwner.token);
			const parent = await http.workbench({
				op: "session.create",
				requestId: "preset-parent",
				name: "Read-only Session",
				cwd: p.f.cwd,
			});
			assert.equal(parent.response.status, 200);
			assert.ok("result" in parent.decoded && parent.decoded.result.kind === "managed.session");
			assert.ok(parent.decoded.result.session);
			const made = await http.workbench({
				op: "create",
				requestId: "preset-conversation",
				sessionId: parent.decoded.result.session.id,
				name: "Read-only work",
				profile: "read-only",
				configuration: { model: "beta/model-069", thinkingLevel: "low" },
			});
			assert.equal(made.response.status, 200);
			assert.ok("result" in made.decoded && made.decoded.result.kind === "reference");
			const ref = made.decoded.result.ref;
			assert.equal(ref.profile, "read-only");
			assert.notEqual(ref.sessionId, app.runtime.view().sessionId);
			const runtime = app.sessions.runtimeFor(ref);
			assert.equal((await runtime.configuration(ref)).model, "beta/model-069");
			assert.equal(p.f.requests.length, 0);
			const submit = await http.workbench({
				op: "submit",
				target: ref,
				input: {
					requestId: "preset-input",
					text: "Read and attempt to overwrite the protected file",
					mode: "prompt",
				},
			});
			assert.ok("result" in submit.decoded && submit.decoded.result.kind === "receipt");
			const completed = await http.workbench({
				op: "wait",
				id: submit.decoded.result.receipt.id,
				sessionId: ref.sessionId,
			});
			assert.ok("result" in completed.decoded && completed.decoded.result.kind === "receipt");
			assert.equal(completed.decoded.result.receipt.status, "done");
			assert.equal(p.f.requests.length, 3);
			assert.equal(p.f.requests[0]!.model, "model-069");
			assert.equal(p.f.requests[0]!.reasoning_effort, "low");
			assert.match(JSON.stringify(p.f.requests[0]!.tools), /"name":"read"/);
			assert.doesNotMatch(JSON.stringify(p.f.requests[0]!.tools), /"name":"(?:write|edit|powershell|bash)"/);
			assert.match(
				JSON.stringify(p.f.requests[1]!.messages.filter((message) => message.role === "tool")),
				/READ-ONLY-ORACLE/,
			);
			assert.equal(await readFile(join(p.f.cwd, "protected.txt"), "utf8"), "READ-ONLY-ORACLE");
			assert.deepEqual(p.f.errors, []);
		} finally {
			await app?.close();
			await options?.modelConfiguration?.close();
			await p.f.close();
		}
	},
);
