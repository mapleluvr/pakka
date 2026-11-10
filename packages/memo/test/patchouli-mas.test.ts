import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemo } from "../src/index.ts";
import { openPatchouli, type PatchouliService } from "../src/patchouli.ts";
import { createMasResearchDriver, createPatchouliTools } from "../src/patchouli-mas.ts";
import { createMas } from "../../mas/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createRuntime, type ToolInvocationScope } from "../../agent/src/index.ts";

test("actual Runtime and Memo reopen reconcile a lost MAS reply without another model delivery", async () => {
	const dir = await mkdtemp(join(tmpdir(), "memo-research-reopen-")),
		file = join(dir, "memo.sqlite"),
		memo = openMemo({ file });
	const owner = { id: "owner", check() {} };
	memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	const fixture = await runtimeFixture();
	let runtime = fixture.runtime,
		service: PatchouliService | undefined;
	try {
		async function assemble(lost = false) {
			const mas = await createMas({ runtime, namespace: "reopen-research", maxPending: 4 });
			await mas.bootstrap([{ key: "patchouli", owner: "owner", lifetime: "persistent" }]);
			await mas.activate();
			const target = (await mas.view()).members[0]!.ref,
				client = mas.connect({ principal: "owner", source: null, grants: ["send", "observe", "abort"] });
			const driver = await createMasResearchDriver({ runtime, mas, client, target });
			service = openPatchouli({
				file,
				id: "p",
				actorId: "patchouli",
				scope: [{ libraryId: "work", write: false }],
				driver: {
					...driver,
					async send(...args) {
						const value = await driver.send(...args);
						if (lost) throw Error("Response lost");
						return value;
					},
				},
				authorize(id) {
					if (id !== "owner") throw Error("Denied");
				},
			});
			return service.connect(owner);
		}
		let client = await assemble(true);
		const requested = await client.request({
			requestId: "read",
			subject: "Inspect without mandatory publication",
			refs: [],
		});
		await client.setEnabled(true);
		await client.advance();
		await runtime.waitForIdle();
		assert.equal((await client.get(requested.runId)).state, "unknown");
		assert.equal(fixture.f.requests.length, 1);
		const sessionFile = runtime.view().sessionFile;
		service!.close();
		service = undefined;
		await runtime.close();
		runtime = await createRuntime({ ...fixture.config, reopenSessionFile: sessionFile });
		client = await assemble();
		assert.equal((await client.get(requested.runId)).state, "unknown");
		assert.equal(fixture.f.requests.length, 1);
		await client.advance();
		assert.equal((await client.get(requested.runId)).state, "waiting");
		assert.equal(fixture.f.requests.length, 1);
	} finally {
		service?.close();
		await runtime.close();
		await fixture.close();
		memo.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("native persistent Patchouli waits across answers, completes without publication, and records only approved actual writes", async () => {
	const dir = await mkdtemp(join(tmpdir(), "memo-native-research-")),
		file = join(dir, "memo.sqlite"),
		memo = openMemo({ file });
	const owner = { id: "owner", check() {} };
	memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	memo.createLibrary({ id: "outside", title: "Other", ownerId: "owner" });
	const manager = memo.connect(owner);
	await manager.grant({ libraryId: "work", actorId: "patchouli", role: "editor", requestId: "grant-work" });
	await manager.grant({
		libraryId: "outside",
		actorId: "patchouli",
		role: "editor",
		requestId: "grant-outside",
	});
	let service: PatchouliService | undefined,
		captured: ToolInvocationScope | undefined,
		runId = "",
		mode: "wait" | "empty" | "write" = "wait",
		step = 0;
	const tools = createPatchouliTools((scope) => {
		captured = scope;
		if (!service) throw Error("Not assembled");
		return service;
	});
	const runtime = await runtimeFixture(
		{ tools: tools.tools, systemPrompt: tools.instructions },
		undefined,
		() => {
			if (mode === "wait") return { text: "Waiting for more information, not finished." };
			if (mode === "empty") {
				if (step++ === 0) return { tool: "research_finish", args: { runId } };
				return { text: "Completed without publishing." };
			}
			if (step++ === 0)
				return {
					tool: "wiki_write",
					args: {
						libraryId: "outside",
						requestId: runId + ":outside",
						baseRevision: 0,
						path: "wrong.md",
						title: "Wrong",
						markdown: "Must not publish",
						summary: "x",
						sources: [],
					},
				};
			if (step === 2)
				return {
					tool: "wiki_write",
					args: {
						libraryId: "work",
						requestId: runId + ":publication",
						baseRevision: 0,
						path: "result.md",
						title: "Adopted note",
						markdown: "Actual knowledge",
						summary: "Research outcome",
						sources: [],
					},
				};
			if (step === 3) return { tool: "research_finish", args: { runId } };
			return { text: "Complete with the actual saved note." };
		},
	);
	try {
		const mas = await createMas({ runtime: runtime.runtime, namespace: "memo-research", maxPending: 4 });
		await mas.bootstrap([{ key: "patchouli", owner: "owner", lifetime: "persistent" }]);
		await mas.activate();
		const target = (await mas.view()).members[0]!.ref,
			sender = mas.connect({ principal: "owner", source: null, grants: ["send", "observe", "abort"] });
		const driver = await createMasResearchDriver({ runtime: runtime.runtime, mas, client: sender, target });
		const failures: unknown[] = [];
		const options = {
			file,
			id: "librarian",
			actorId: "patchouli",
			scope: [{ libraryId: "work", write: true }],
			driver: {
				...driver,
				async send(...args: Parameters<typeof driver.send>) {
					try {
						return await driver.send(...args);
					} catch (error) {
						failures.push(error);
						throw error;
					}
				},
			},
			authorize(id: string) {
				if (id !== "owner") throw Error("Denied");
			},
		};
		service = openPatchouli(options);
		let client = service.connect(owner);
		const first = await client.request({ requestId: "r1", subject: "Review, waiting is allowed", refs: [] });
		runId = first.runId;
		assert.equal(runtime.f.requests.length, 0);
		await client.setEnabled(true);
		await client.advance();
		await runtime.runtime.waitForIdle();
		await client.advance();
		assert.deepEqual(failures, []);
		assert.equal((await client.get(runId)).state, "waiting");
		assert.equal(runtime.f.requests.length, 1);
		mode = "empty";
		step = 0;
		await sender.send(target, {
			requestId: "human-reply",
			text: "No further material; finish this research.",
			mode: "followUp",
		});
		await runtime.runtime.waitForIdle();
		assert.equal((await client.get(runId)).state, "completed");
		assert.equal((await client.get(runId)).publications.length, 0);
		assert.ok(captured);
		assert.throws(() => service!.knowledgeForInvocation({ ...captured! }), { code: "denied" });
		service.close();
		const requests = runtime.f.requests.length;
		service = openPatchouli(options);
		client = service.connect(owner);
		assert.equal((await client.get(runId)).state, "completed");
		assert.equal(runtime.f.requests.length, requests);
		mode = "write";
		step = 0;
		runId = (await client.request({ requestId: "r2", subject: "Write only into approved library", refs: [] }))
			.runId;
		await client.advance();
		await runtime.runtime.waitForIdle();
		await client.advance();
		const completed = await client.get(runId);
		assert.equal(completed.state, "completed");
		assert.equal(completed.publications.length, 1);
		assert.equal(completed.publications[0]!.requestId, runId + ":publication");
		assert.equal((await manager.list({ libraryId: "outside" })).items.length, 0);
		assert.equal((await manager.list({ libraryId: "work" })).items.length, 1);
	} finally {
		tools.revoke();
		service?.close();
		await runtime.close();
		memo.close();
		await rm(dir, { recursive: true, force: true });
	}
});
