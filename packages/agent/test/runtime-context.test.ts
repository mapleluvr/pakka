import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/index.ts";
import type { Runtime, RuntimeContextSource } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

// Omitting profile selection, retaining old rendered text, or writing it into raw history must fail this case.
test(
	"Runtime context: actual provider payload follows the selected profile and current source without changing raw history",
	{ timeout: 15000 },
	async () => {
		let active = true;
		const seen: string[] = [];
		const source: RuntimeContextSource = {
			id: "approved-memory",
			version: 1,
			profiles: ["memory"],
			render: ({ target }) => {
				assert.equal(Object.isFrozen(target), true);
				seen.push(target.key);
				return { text: active ? "APPROVED-CONTEXT-ONLY-FOR-MEMORY" : null, check: () => {} };
			},
		};
		const m = await runtimeFixture({
			profiles: [{ id: "memory" }, { id: "plain" }],
			contextSources: [source],
		});
		try {
			const ref = await m.runtime.createConversation({ key: "project", profile: "memory" }),
				host = await m.runtime.conversation(ref);
			const plain = await m.runtime.conversation(
				await m.runtime.createConversation({ key: "plain", profile: "plain" }),
			);
			const client = host.connect("operator", ["input.submit"]);
			await client.submit({ key: "one", text: "FIRST-CONTEXT-WORK" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.ok(JSON.stringify(m.f.requests[0]).includes("APPROVED-CONTEXT-ONLY-FOR-MEMORY"));
			assert.ok(
				!JSON.stringify(await m.runtime.readConversation(ref, () => {})).includes(
					"APPROVED-CONTEXT-ONLY-FOR-MEMORY",
				),
			);
			assert.ok(
				!(await readFile(m.runtime.view().sessionFile, "utf8")).includes("APPROVED-CONTEXT-ONLY-FOR-MEMORY"),
			);
			active = false;
			await client.submit({ key: "two", text: "AFTER-EXPLICIT-OMISSION" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			assert.ok(!JSON.stringify(m.f.requests[1]).includes("APPROVED-CONTEXT-ONLY-FOR-MEMORY"));
			active = true;
			await plain.connect("operator", ["input.submit"]).submit({ key: "plain", text: "PLAIN-WORK" });
			await plain.waitForIdle();
			assert.equal(m.f.requests.length, 3);
			assert.ok(!JSON.stringify(m.f.requests[2]).includes("APPROVED-CONTEXT-ONLY-FOR-MEMORY"));
			assert.deepEqual(seen, ["project", "project"]);
		} finally {
			await m.close();
		}
	},
);

test(
	"Runtime context: source failure blocks actual provider dispatch instead of keeping previously rendered text",
	{ timeout: 10000 },
	async () => {
		const m = await runtimeFixture({
			contextSources: [
				{
					id: "broken-source",
					version: 1,
					profiles: ["default"],
					render: () => {
						throw Error("CONTEXT-NOT-CONFIRMED");
					},
				},
			],
		});
		try {
			const host = m.runtime.root();
			await host
				.connect("operator", ["input.submit"])
				.submit({ key: "must-block", text: "NEVER-SEND-WITHOUT-CONTEXT" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 0);
			assert.equal(host.view().phase, "failed");
		} finally {
			await m.close();
		}
	},
);

test(
	"Runtime context: definition identity is retained across reopen and a changed version cannot silently replace it",
	{ timeout: 15000 },
	async () => {
		const source: RuntimeContextSource = {
			id: "versioned-context",
			version: 1,
			profiles: ["default"],
			render: () => ({ text: "VERSIONED-CONTEXT", check: () => {} }),
		};
		const m = await runtimeFixture({ contextSources: [source] });
		let reopened: Runtime | undefined;
		try {
			const file = m.runtime.view().sessionFile;
			await m.runtime.close();
			await assert.rejects(
				createRuntime({ ...m.config, reopenSessionFile: file, contextSources: [{ ...source, version: 2 }] }),
				/profile|bootstrap/i,
			);
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			await reopened
				.root()
				.connect("operator", ["input.submit"])
				.submit({ key: "after-reopen", text: "AFTER-REOPEN-CONTEXT" });
			await reopened.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.ok(JSON.stringify(m.f.requests[0]).includes("VERSIONED-CONTEXT"));
		} finally {
			await reopened?.close();
			await m.close();
		}
	},
);
