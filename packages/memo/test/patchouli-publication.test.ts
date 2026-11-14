import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemo, MemoError, type SourceProvider } from "../src/index.ts";
import { openPatchouli, type PatchouliService } from "../src/patchouli.ts";
import { createMasResearchDriver, createPatchouliTools } from "../src/patchouli-mas.ts";
import { createMas } from "../../mas/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

test("Patchouli preserves source authorization through its filtered DTO and final native return", async () => {
	const dir = await mkdtemp(join(tmpdir(), "memo-patchouli-publication-")),
		file = join(dir, "memo.sqlite");
	let allowed = true,
		armed = false,
		checks = 0,
		service: PatchouliService | undefined;
	const provider: SourceProvider = {
		check() {},
		async read(input) {
			return { ref: input.ref, text: "RESEARCH-SOURCE-BODY", nextOffset: null, sources: [] };
		},
		publicationCheck() {
			return () => {
				if (!allowed) throw new MemoError("denied", "Source own read revoked");
				// Source helper, Memo return, then Patchouli's transformed-result return.
				if (armed && ++checks === 3)
					queueMicrotask(() => {
						allowed = false;
					});
			};
		},
	};
	const memo = openMemo({ file, providers: { book: provider } }),
		owner = { id: "owner", check() {} };
	memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	const manager = memo.connect(owner),
		ref = { kind: "source" as const, libraryId: "work", sourceId: "book", version: "1" };
	await manager.grant({ libraryId: "work", actorId: "patchouli", role: "reader", requestId: "grant" });
	await manager.registerSource({
		libraryId: "work",
		sourceId: "book",
		requestId: "register",
		baseVersion: 0,
		provider: "book",
		address: "fixed-book",
		version: "1",
		title: "Book",
		summary: "Original source",
	});
	const tools = createPatchouliTools(() => {
		if (!service) throw Error("Not assembled");
		return service;
	});
	const m = await runtimeFixture({ tools: tools.tools }, undefined, (payload) => {
		const results = payload.messages.filter((r) => r.role === "tool");
		if (results.length < 2) {
			if (results.length === 1) armed = true;
			return { tool: "memo_read", args: { ref } };
		}
		return { text: "Finished source checks, research still waiting" };
	});
	try {
		const mas = await createMas({ runtime: m.runtime, namespace: "memo-publication", maxPending: 4 });
		await mas.bootstrap([{ key: "patchouli", owner: "owner", lifetime: "persistent" }]);
		await mas.activate();
		const target = (await mas.view()).members[0]!.ref;
		const sender = mas.connect({ principal: "owner", source: null, grants: ["send", "observe", "abort"] });
		const driver = await createMasResearchDriver({ runtime: m.runtime, mas, client: sender, target });
		service = openPatchouli({
			file,
			providers: { book: provider },
			id: "librarian",
			actorId: "patchouli",
			scope: [{ libraryId: "work", write: false }],
			driver,
			authorize(id) {
				if (id !== "owner") throw Error("Denied");
			},
		});
		const client = service.connect(owner),
			run = await client.request({ requestId: "read", subject: "Read original source", refs: [ref] });
		await client.setEnabled(true);
		await client.advance();
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 3);
		const results = m.f.requests[2]!.messages.filter((r) => r.role === "tool").map((r) =>
			JSON.parse(String(r.content)),
		);
		assert.equal(results[0].status, "ok");
		assert.equal(results[0].value.text, "RESEARCH-SOURCE-BODY");
		assert.equal(allowed, false);
		assert.equal(results[1].status, "denied");
		assert.ok(!JSON.stringify(results[1]).includes("RESEARCH-SOURCE-BODY"));
		assert.equal((await client.get(run.runId)).publications.length, 0);
	} finally {
		tools.revoke();
		service?.close();
		await m.close();
		memo.close();
		await rm(dir, { recursive: true, force: true });
	}
});
