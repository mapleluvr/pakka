import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { openMemo } from "../src/index.ts";
import { openPatchouli, type PatchouliService } from "../src/patchouli.ts";
import { createMasResearchDriver, createPatchouliTools } from "../src/patchouli-mas.ts";
import { createMas } from "../../mas/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

for (const revocation of ["bundle", "invocation"] as const)
	test(`Native research_finish preserves completion as unknown after ${revocation} revocation`, async () => {
		let service: PatchouliService | undefined,
			runId = "",
			step = 0,
			finishing = false,
			checks = 0,
			revoked = false;
		let observed: { status: string; value?: unknown } | undefined;
		const bundle = createPatchouliTools(() => {
			if (!service) throw Error("Not assembled");
			return service;
		});
		const tools = bundle.tools.map((tool) =>
			tool.name !== "research_finish"
				? tool
				: {
						...tool,
						async execute(...args: Parameters<typeof tool.execute>) {
							finishing = true;
							try {
								const result = await tool.execute(...args);
								observed = JSON.parse(String(result));
								return result;
							} finally {
								finishing = false;
							}
						},
					},
		);
		const m = await runtimeFixture({ tools, systemPrompt: bundle.instructions }, undefined, () =>
			step++ === 0 ? { tool: "research_finish", args: { runId } } : { text: "Finished." },
		);
		const file = join(m.f.dataDir, "memo.sqlite"),
			memo = openMemo({ file });
		try {
			memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
			const mas = await createMas({ runtime: m.runtime, namespace: "completion-publication", maxPending: 4 });
			await mas.bootstrap([{ key: "patchouli", owner: "owner", lifetime: "persistent" }]);
			await mas.activate();
			const target = (await mas.view()).members[0]!.ref;
			const sender = mas.connect({ principal: "owner", source: null, grants: ["send", "observe", "abort"] });
			const driver = await createMasResearchDriver({ runtime: m.runtime, mas, client: sender, target });
			service = openPatchouli({
				file,
				id: "librarian",
				actorId: "patchouli",
				scope: [{ libraryId: "work", write: false }],
				authorize(id) {
					if (id !== "owner") throw Error("Denied");
				},
				driver: {
					...driver,
					checkInvocation(scope) {
						driver.checkInvocation(scope);
						if (revoked && revocation === "invocation") throw Error("Native invocation withdrawn");
						// Transaction pre/post checks and the existing service publication check.
						if (finishing && ++checks === 3)
							queueMicrotask(() => {
								revoked = true;
								if (revocation === "bundle") bundle.revoke();
							});
					},
				},
			});
			const client = service.connect({ id: "owner", check() {} });
			runId = (
				await client.request({ requestId: "finish", subject: "Complete without publication", refs: [] })
			).runId;
			await client.setEnabled(true);
			await client.advance();
			await m.runtime.waitForIdle();
			assert.equal((await client.get(runId)).state, "completed");
			assert.equal(revoked, true);
			assert.equal(m.f.requests.length, 2);
			assert.equal(observed?.status, "unknown");
			assert.equal(observed?.value, undefined);
		} finally {
			bundle.revoke();
			service?.close();
			memo.close();
			await m.close();
		}
	});
