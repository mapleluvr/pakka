import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StrategyBinding, ToolInvocationScope } from "../src/index.ts";
import { binding, target } from "./strategy-fixture.ts";
import { deferred, fixture, raw, seed, text } from "./fixture.ts";
import { blockSqliteWrites, readStorageText } from "./native-storage.ts";

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
		b.installProjector(async (frame) => {
			const receipt = await b.artifacts.append(frame.basis, {
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
	let unblock: (() => void) | undefined;
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
		const receipt = (await b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ kind: "saved" }] }));
		assert.equal(receipt.status, "committed");
		assert.equal(receipt.version, 1);
		assert.match(await readStorageText(host.view().sessionFile), /saved/);
		assert.equal(
			(await b.artifacts.append(b.readFrame().basis, { expectedVersion: 0, records: [{ kind: "conflict" }] })).status,
			"conflict",
		);
		b.installProjector((f) => ({ status: "disabled", basis: f.basis }));
		unblock = blockSqliteWrites(host.view().sessionFile);
		assert.equal((await b.artifacts.append(b.readFrame().basis, { expectedVersion: 1, records: [{ mustNotLand: true }] })).status, "unknown");
		unblock();
		unblock = undefined;
		assert.throws(() => b.readFrame(), /failed|storage/i);
		await assert.rejects(user.submit({ key: "no-http", text: "NO" }), /failed/);
		assert.equal(f.requests.length, 1);
	} finally {
		unblock?.();
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
		(await old.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ kind: "recover" }] }));
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
		const host = await f.start();
		const file = host.view().sessionFile,
			directory = dirname(dirname(file));
		await host.dispose();
		const names = (await readdir(directory)).sort();
		await assert.rejects(
			f.start({ reopenSessionFile: join(directory, "missing", "main.sqlite") }),
			/reopen|ENOENT|missing/i,
		);
		const body = Buffer.from('{"looks":"valid-json"}\n');
		await writeFile(file, body);
		await assert.rejects(f.start({ reopenSessionFile: file }), /SQLite|corrupt|database/i);
		assert.ok((await readFile(file)).equals(body), "corrupt input is preserved");
		assert.deepEqual((await readdir(directory)).sort(), names, "no replacement Session directory");
		assert.equal(f.requests.length, 0);
	} finally {
		await f.close();
	}
});
