import { test } from "node:test";
import assert from "node:assert/strict";
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime } from "../src/index.ts";
import type { RuntimeContextSource } from "../src/index.ts";
import { deferred } from "./fixture.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

test(
	"Runtime context authority: state changed during real credential resolution blocks HTTP and retains the prepared attempt",
	{ timeout: 10000 },
	async (t) => {
		const release = deferred();
		let resolving = false,
			valid = true;
		const m = await runtimeFixture({
			resolveApiKey: async () => {
				resolving = true;
				await release.promise;
				return "SYNTHETIC-CONTEXT-KEY";
			},
			contextSources: [
				{
					id: "live-memory",
					version: 1,
					profiles: ["default"],
					render: () => ({
						text: "STALE-MEMORY-MUST-NOT-LEAVE",
						check: () => {
							if (!valid) throw Error("Memory state changed");
						},
					}),
				},
			],
		});
		try {
			const host = m.runtime.root();
			await host
				.connect("operator", ["input.submit"])
				.submit({ key: "delayed", text: "WAIT-FOR-CREDENTIAL" });
			await t.waitFor(() => assert.equal(resolving, true), { timeout: 2000 });
			assert.equal(m.runtime.view().budget.primaryAttempts, 1);
			valid = false;
			release.resolve();
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 0);
			assert.equal(m.runtime.view().budget.primaryAttempts, 1);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);

// TypeScript accepts an async function in a void callback slot; runtime checks must still fail closed.
test(
	"Runtime context validity: an asynchronous check cannot silently allow a provider request",
	{ timeout: 10000 },
	async () => {
		const m = await runtimeFixture({
			contextSources: [
				{
					id: "invalid-check",
					version: 1,
					profiles: ["default"],
					render: () => ({ text: "UNCONFIRMED-CONTEXT", check: async () => {} }),
				},
			],
		});
		try {
			const host = m.runtime.root();
			await host
				.connect("operator", ["input.submit"])
				.submit({ key: "invalid-check", text: "DO-NOT-DISPATCH" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 0);
			assert.equal(host.view().phase, "failed");
		} finally {
			await m.close();
		}
	},
);

for (const [label, result] of [
	["extra output authority", { text: "CONTEXT", check: () => {}, endpoint: "https://unapproved.invalid" }],
	["missing current text", { check: () => {} }],
	["over-limit text", { text: "x".repeat(32769), check: () => {} }],
] as const) {
	test("Runtime context decode: " + label + " blocks actual HTTP", { timeout: 10000 }, async () => {
		const source: RuntimeContextSource = {
			id: "bounded-context",
			version: 1,
			profiles: ["default"],
			render: () => ({ text: null, check: () => {} }),
		};
		Object.assign(source, { render: () => result });
		const m = await runtimeFixture({ contextSources: [source] });
		try {
			const host = m.runtime.root();
			await host
				.connect("operator", ["input.submit"])
				.submit({ key: "malformed", text: "DO-NOT-SEND-INVALID-CONTEXT" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 0);
			assert.equal(host.view().phase, "failed");
		} finally {
			await m.close();
		}
	});
}

for (const failureAt of ["render", "check"] as const) {
	test(
		"Runtime context privacy: opaque " +
			failureAt +
			" errors block the request without publishing private source content",
		{ timeout: 10000 },
		async () => {
			const secret = "PRIVATE-CONTEXT-ERROR-CANARY-" + failureAt;
			const m = await runtimeFixture({
				contextSources: [
					{
						id: "private-source",
						version: 1,
						profiles: ["default"],
						render: () => {
							if (failureAt === "render") throw Error(secret);
							return {
								text: "APPROVED-CONTEXT",
								check: () => {
									throw Error(secret);
								},
							};
						},
					},
				],
			});
			try {
				const host = m.runtime.root();
				await host
					.connect("operator", ["input.submit"])
					.submit({ key: "opaque", text: "DO-NOT-PUBLISH-SOURCE-ERROR" });
				await host.waitForIdle();
				assert.equal(m.f.requests.length, 0);
				assert.ok(!JSON.stringify(host.view()).includes(secret));
				assert.ok(!(await readFile(m.runtime.view().sessionFile, "utf8")).includes(secret));
			} finally {
				await m.close();
			}
		},
	);
}

test(
	"Runtime context registry: mutable startup arrays cannot expand profile scope or replace the approved renderer",
	{ timeout: 10000 },
	async () => {
		const allowed = ["memory"],
			sources: RuntimeContextSource[] = [
				{
					id: "fixed-source",
					version: 1,
					profiles: allowed,
					render: () => ({ text: "ORIGINALLY-APPROVED-CONTEXT", check: () => {} }),
				},
			];
		const m = await runtimeFixture({
			profiles: [{ id: "memory" }, { id: "plain" }],
			contextSources: sources,
		});
		try {
			allowed.push("plain");
			sources[0]!.render = () => ({ text: "MUTATED-RENDERER", check: () => {} });
			sources.push({
				id: "added-after-startup",
				version: 1,
				profiles: ["plain"],
				render: () => ({ text: "LATE-EXPANSION", check: () => {} }),
			});
			const plain = await m.runtime.conversation(
				await m.runtime.createConversation({ key: "plain", profile: "plain" }),
			);
			await plain.connect("operator", ["input.submit"]).submit({ key: "plain", text: "PLAIN" });
			await plain.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.ok(!JSON.stringify(m.f.requests[0]).includes("CONTEXT"));
			assert.ok(!JSON.stringify(m.f.requests[0]).includes("LATE-EXPANSION"));
			const memory = await m.runtime.conversation(
				await m.runtime.createConversation({ key: "memory", profile: "memory" }),
			);
			await memory.connect("operator", ["input.submit"]).submit({ key: "memory", text: "MEMORY" });
			await memory.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			assert.ok(JSON.stringify(m.f.requests[1]).includes("ORIGINALLY-APPROVED-CONTEXT"));
			assert.ok(!JSON.stringify(m.f.requests[1]).includes("MUTATED-RENDERER"));
		} finally {
			await m.close();
		}
	},
);

test(
	"Runtime context bootstrap: unknown profiles and duplicate sources fail before opening native storage",
	{ timeout: 10000 },
	async () => {
		const m = await runtimeFixture();
		try {
			for (const [name, sources] of [
				[
					"unapproved",
					[
						{
							id: "wrong-profile",
							version: 1,
							profiles: ["outside"],
							render: () => ({ text: null, check: () => {} }),
						},
					],
				],
				[
					"duplicate",
					[
						...Array.from({ length: 2 }, () => ({
							id: "duplicate",
							version: 1,
							profiles: ["default"],
							render: () => ({ text: null, check: () => {} }),
						})),
					],
				],
			] as const) {
				const dataDir = join(m.f.root, "bad-context-" + name);
				await assert.rejects(
					createRuntime({ ...m.config, dataDir, contextSources: sources }),
					/context source/i,
				);
				await assert.rejects(stat(dataDir), { code: "ENOENT" });
			}
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
