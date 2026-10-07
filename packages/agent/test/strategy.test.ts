import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StrategyBinding, ToolInvocationScope } from "../src/index.ts";
import { binding, target } from "./strategy-fixture.ts";
import { deferred, fixture, raw, seed, text } from "./fixture.ts";

test("strategy binding enforces principal, exact hook and deactivation", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write"]);
		const other = host.connect("other", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner);
		assert.throws(() => other.bindStrategy("strategy"), /owner/);
		assert.throws(() => owner.bindStrategy("missing"), /strategy/);
		owner.deactivateStrategy("strategy");
		other.activateStrategy({ id: "art", hooks: ["context_artifacts.write"] });
		const art = binding(other, "art");
		assert.throws(
			() => art.installProjector((frame) => ({ status: "disabled", basis: frame.basis })),
			/real_context/,
		);
		assert.throws(() => b.readFrame(), /inactive|lease/);
		assert.equal(f.requests.length, 0);
	} finally {
		await f.close();
	}
});

test("request patches preserve canonical history and survive reload without double installation", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const { client: user, receipt } = await seed(host);
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner);
		let calls = 0;
		b.installProjector((frame) => {
			calls++;
			assert.equal(Object.isFrozen(frame.projection[0].messages), true);
			return {
				status: "apply",
				basis: frame.basis,
				patches: [
					{
						sourceEntryId: receipt.entryId!,
						messageIndex: 0,
						content: [{ type: "text", text: "NUMBERED-REDUCED" }],
					},
				],
			};
		});
		for (const key of ["next", "reloaded"]) {
			if (key === "reloaded") await host.reload();
			await user.submit({ key, text: key });
			await host.waitForIdle();
			assert.match(text(f.requests.at(-1)!), /NUMBERED-REDUCED/);
			assert.doesNotMatch(text(f.requests.at(-1)!), /ORIGINAL/);
			assert.match(text(f.requests.at(-1)!), /PAKKA-SYSTEM/);
		}
		assert.equal(calls, 2);
		assert.match(await raw(host), /ORIGINAL/);
		assert.doesNotMatch(await raw(host), /NUMBERED-REDUCED|"type":"compaction"|"type":"context_edit"/);
	} finally {
		await f.close();
	}
});

for (const bad of ["throw", "copied-basis", "missing-entry", "system", "revoked"])
	test(`active projector ${bad} blocks the next actual HTTP request`, async () => {
		const f = await fixture();
		try {
			const host = await f.start();
			const { client: user } = await seed(host);
			const owner = host.connect("owner", ["real_context.write"]);
			owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
			const b = binding(owner);
			b.installProjector(async (frame) => {
				if (bad === "throw") throw new Error("CONTROL-FAILURE");
				if (bad === "revoked") {
					await Promise.resolve();
					owner.deactivateStrategy("strategy");
				}
				return {
					status: "apply",
					basis: bad === "copied-basis" ? { ...frame.basis } : frame.basis,
					patches:
						bad === "missing-entry" || bad === "system"
							? [
									{
										sourceEntryId:
											bad === "system"
												? frame.projection.find((e) => e.boundary === "system")!.sourceEntryId
												: "missing",
										messageIndex: 0,
										content: [{ type: "text", text: "FORGED" }],
									},
								]
							: [],
				};
			});
			await user.submit({ key: "blocked", text: "MUST-NOT-SEND" });
			await host.waitForIdle();
			assert.equal(f.requests.length, 1);
			assert.equal(host.view().phase, "failed");
		} finally {
			await f.close();
		}
	});

test("projector can rebase its own artifact commit before returning a plan", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner);
		b.installProjector((frame) => {
			const receipt = b.artifacts.append(frame.basis, {
				expectedVersion: frame.artifacts.version,
				records: [{ kind: "trigger" }],
			});
			assert.equal(receipt.status, "committed");
			const rebased = b.readFrame();
			return {
				status: "apply",
				basis: rebased.basis,
				replacements: [{ sourceEntryIds: [target(rebased)], summary: "REQUEST-SUMMARY" }],
			};
		});
		await user.submit({ key: "rebased", text: "AFTER" });
		await host.waitForIdle();
		assert.match(text(f.requests[1]), /REQUEST-SUMMARY/);
		assert.doesNotMatch(text(f.requests[1]), /ORIGINAL/);
		assert.match(await raw(host), /ORIGINAL/);
		assert.equal(b.readFrame().artifacts.records.length, 1);
	} finally {
		await f.close();
	}
});

test("artifact receipts enforce scope/version and a physical journal fault latches", async () => {
	const f = await fixture();
	let path: string | undefined;
	try {
		const host = await f.start();
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write", "context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		assert.throws(
			() => b.artifacts.append({ ...frame.basis }, { expectedVersion: 0, records: [{ kind: "copied" }] }),
			/scope|basis/,
		);
		const receipt = b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ kind: "saved" }] });
		assert.equal(receipt.status, "committed");
		assert.equal(receipt.version, 1);
		path = receipt.journalPath;
		assert.match(await readFile(path, "utf8"), /saved/);
		assert.equal(
			b.artifacts.append(b.readFrame().basis, { expectedVersion: 0, records: [{ kind: "conflict" }] }).status,
			"conflict",
		);
		b.installProjector((f) => ({ status: "disabled", basis: f.basis }));
		await rename(path, path + ".saved");
		await mkdir(path);
		assert.throws(() => b.readFrame(), /journal|storage/i);
		await rm(path, { recursive: true });
		await rename(path + ".saved", path);
		path = undefined;
		assert.throws(() => b.readFrame(), /failed|storage/i);
		await assert.rejects(user.submit({ key: "no-http", text: "NO" }), /failed/);
		assert.equal(f.requests.length, 1);
	} finally {
		if (path) {
			await rm(path, { recursive: true });
			await rename(path + ".saved", path);
		}
		await f.close();
	}
});

test("late tool invocation cannot obtain a new-session frame", async () => {
	const entered = deferred(),
		release = deferred();
	let b: StrategyBinding, invocation: ToolInvocationScope | undefined;
	let rejection = "";
	const f = await fixture(
		{
			tools: [
				{
					name: "scope",
					description: "scope",
					parameters: { type: "object", properties: {} },
					execute: async (_args, _signal, scope) => {
						invocation = scope;
						entered.resolve();
						await release.promise;
						try {
							b.readFrame(scope);
						} catch (e) {
							rejection = String(e);
						}
						return "OLD-TOOL";
					},
				},
			],
		},
		(_p, n) => (n === 1 ? { tool: "scope" } : { text: "ANSWER" }),
	);
	try {
		const host = await f.start(),
			owner = host.connect("owner", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		b = binding(owner);
		const user = host.connect("user", ["input.submit"]);
		await user.submit({ key: "old", text: "OLD" });
		await entered.promise;
		assert.ok(invocation);
		assert.doesNotThrow(() => b.readFrame(invocation));
		const transition = host.newSession();
		release.resolve();
		await transition;
		assert.match(rejection, /invocation|scope|transition/);
		assert.throws(() => b.readFrame(invocation), /invocation|scope/);
		assert.throws(() => b.readFrame({ ...invocation! }), /invocation|scope/);
		assert.doesNotThrow(() => b.readFrame());
	} finally {
		release.resolve();
		await f.close();
	}
});

test("trusted reopen preserves raw identity and records but not old operation authority", async () => {
	const f = await fixture();
	try {
		const first = await f.start();
		await seed(first);
		const owner = first.connect("owner", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const old = binding(owner),
			frame = old.readFrame();
		old.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ kind: "recover" }] });
		const before = first.view();
		await first.dispose();
		const second = await f.start({ reopenSessionFile: before.sessionFile });
		assert.equal(second.view().sessionId, before.sessionId);
		assert.deepEqual(
			second
				.view()
				.entries.map((e) => e.id)
				.slice(0, before.entries.length),
			before.entries.map((e) => e.id),
		);
		const next = second.connect("next-owner", ["context_artifacts.write"]);
		next.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const fresh = binding(next);
		assert.deepEqual(fresh.readFrame().artifacts.records, [{ kind: "recover" }]);
		assert.throws(() => fresh.artifacts.read(frame.basis), /scope|basis/);
	} finally {
		await f.close();
	}
});

test("requested reopen of missing or corrupted owned storage never creates a new session", async () => {
	const f = await fixture();
	try {
		await assert.rejects(
			f.start({ reopenSessionFile: join(f.dataDir, "sessions", "missing.jsonl") }),
			/reopen|ENOENT|missing/,
		);
		const file = join(f.dataDir, "sessions", "broken.jsonl");
		await mkdir(join(f.dataDir, "sessions"), { recursive: true });
		await writeFile(file, '{"type":"session","id":"fake"}\n{bad}\n');
		await assert.rejects(f.start({ reopenSessionFile: file }), /reopen|corrupt|JSON/);
	} finally {
		await f.close();
	}
});
