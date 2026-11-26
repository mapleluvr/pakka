import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemo, MemoError, type MemoClient, type SourceRef } from "../src/index.ts";
import { createMemoTools, bindMemoInvocation } from "../src/agent.ts";
import type { HostOptions, ToolInvocationScope } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

test("native Memo tools save, search and read the same page while stale or forged invocation scopes deny access", async () => {
	const module = await import(new URL("../src/agent.ts", import.meta.url).href).catch(
		(e: NodeJS.ErrnoException) => {
			if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
			return {};
		},
	);
	assert.equal(typeof module.createMemoTools, "function", "Memo native tools missing");
	const dir = await mkdtemp(join(tmpdir(), "memo-agent-")),
		service = openMemo({ file: join(dir, "memo.sqlite") });
	service.createLibrary({ id: "work", title: "Work", ownerId: "bot" });
	let resolve!: (s: ToolInvocationScope) => MemoClient, captured!: ToolInvocationScope;
	const tools = module.createMemoTools({
		resolve: (s: ToolInvocationScope) => {
			captured = s;
			return resolve(s);
		},
	}) as { tools: NonNullable<HostOptions["tools"]>; instructions: string; revoke(): void };
	const m = await runtimeFixture(
		{ tools: tools.tools, systemPrompt: tools.instructions },
		undefined,
		(payload) => {
			const results = payload.messages.filter((r) => r.role === "tool");
			if (!results.length)
				return {
					tool: "wiki_write",
					args: {
						libraryId: "work",
						requestId: "native-write",
						baseRevision: 0,
						path: "topic.md",
						title: "隔离知识",
						markdown: "真正保存的内容",
						summary: "native",
						sources: [],
					},
				};
			if (results.length === 1) return { tool: "memo_search", args: { query: "隔离" } };
			if (results.length === 2) {
				const found = JSON.parse(String(results[1]!.content));
				return { tool: "memo_read", args: { ref: found.value.items[0].ref } };
			}
			return { text: "Saved and read the knowledge." };
		},
	);
	try {
		const source = m.runtime.view().conversations[0]!;
		resolve = (scope) =>
			module.bindMemoInvocation(
				{ runtime: m.runtime, source, service, actor: { id: "bot", check() {} } },
				scope,
			);
		await m.runtime
			.root()
			.connect("operator", ["input.submit"])
			.submit({ key: "start", text: "Save knowledge" });
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 4);
		assert.ok(JSON.stringify(m.f.requests[3]).includes("真正保存的内容"));
		const client = service.connect({ id: "bot", check() {} });
		assert.equal((await client.list({ libraryId: "work" })).items.length, 1);
		await assert.rejects(resolve(captured).list({ libraryId: "work" }), { code: "denied" });
		await assert.rejects(resolve({ ...captured }).list({ libraryId: "work" }), { code: "denied" });
		const write = tools.tools.find((r) => r.name === "wiki_write")!;
		assert.equal(
			JSON.parse(
				await write.execute(
					{
						libraryId: "work",
						requestId: "forged",
						baseRevision: 0,
						path: "forged.md",
						title: "x",
						markdown: "x",
						summary: "x",
						sources: [],
					},
					undefined,
					{ ...captured },
				),
			).status,
			"denied",
		);
		tools.revoke();
		assert.equal((await client.list({ libraryId: "work" })).items.length, 1);
	} finally {
		tools.revoke();
		await m.close();
		service.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("native Memo publication rechecks the actual source after headless read returns", async () => {
	const dir = await mkdtemp(join(tmpdir(), "memo-native-publication-"));
	let allowed = true,
		armed = false,
		checks = 0;
	const service = openMemo({
		file: join(dir, "memo.sqlite"),
		providers: {
			book: {
				check() {},
				async read(i) {
					return { ref: i.ref, text: "RESOLVED-OBJECT-BODY", nextOffset: null };
				},
				publicationCheck() {
					return () => {
						if (!allowed) throw new MemoError("denied", "Actual source read revoked");
						if (armed && ++checks === 2)
							queueMicrotask(() => {
								allowed = false;
							});
					};
				},
			},
		},
	});
	service.createLibrary({ id: "work", title: "Work", ownerId: "bot" });
	const ref: SourceRef = { kind: "source", libraryId: "work", sourceId: "book", version: "1" };
	await service.connect({ id: "bot", check() {} }).registerSource({
		libraryId: "work",
		sourceId: "book",
		requestId: "register",
		baseVersion: 0,
		provider: "book",
		address: "book:fixed",
		version: "1",
		title: "Book",
		summary: "Source",
	});
	let resolve!: (scope: ToolInvocationScope) => MemoClient;
	const tools = createMemoTools({ resolve: (scope) => resolve(scope) });
	const m = await runtimeFixture({ tools: tools.tools }, undefined, (payload) => {
		const results = payload.messages.filter((r) => r.role === "tool");
		if (results.length < 2) {
			if (results.length === 1) armed = true;
			return { tool: "memo_read", args: { ref } };
		}
		return { text: "Read boundary checked" };
	});
	try {
		const source = m.runtime.view().conversations[0]!;
		resolve = (scope) =>
			bindMemoInvocation({ runtime: m.runtime, source, service, actor: { id: "bot", check() {} } }, scope);
		await m.runtime
			.root()
			.connect("operator", ["input.submit"])
			.submit({ key: "source-read", text: "Read a source twice" });
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 3);
		const results = m.f.requests[2]!.messages.filter((r) => r.role === "tool").map((r) =>
			JSON.parse(String(r.content)),
		);
		assert.equal(results[0].status, "ok");
		assert.equal(results[0].value.text, "RESOLVED-OBJECT-BODY");
		assert.equal(allowed, false);
		assert.equal(results[1].status, "denied");
		assert.ok(!JSON.stringify(results[1]).includes("RESOLVED-OBJECT-BODY"));
	} finally {
		tools.revoke();
		await m.close();
		service.close();
		await rm(dir, { recursive: true, force: true });
	}
});
