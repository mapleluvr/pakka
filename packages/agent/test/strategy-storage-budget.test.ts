import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import type { Host, StrategyBinding } from "../src/index.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";
import { deferred, fixture, seed, text } from "./fixture.ts";

async function writer(
	host: Host,
	grants = ["real_context.write", "context_artifacts.write", "model.infer"] as const,
) {
	const owner = host.connect("owner", grants);
	owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
	return { owner, b: binding(owner) };
}

test("source job rejects targets across a checkpoint instead of minting unsafe authority", async () => {
	const f = await fixture();
	try {
		const h = await f.start(inferencePolicy(f.endpoint));
		await seed(h);
		const file = h.view().sessionFile;
		await h.dispose();
		const { SessionManager } = await import("@earendil-works/pi-coding-agent");
		const manager = SessionManager.open(file);
		manager.appendMessage({ role: "system", content: "CHECKPOINT", timestamp: 2 });
		const last = manager.appendMessage({ role: "user", content: "LATER", timestamp: 3 });
		const host = await f.start({ ...inferencePolicy(f.endpoint), reopenSessionFile: file });
		const { b } = await writer(host);
		const frame = b.readFrame();
		assert.throws(
			() =>
				b.createJob(frame.basis, { planId: "unsafe", targetEntryIds: [target(frame), last], maxCalls: 1 }),
			/source|range|boundary|checkpoint/,
		);
		assert.equal(f.requests.length, 1);
	} finally {
		await f.close();
	}
});

test("a stale artifact version after a projector's own write blocks HTTP until explicitly rebased", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const { client: user } = await seed(host);
		const { b } = await writer(host);
		b.installProjector((frame) => {
			b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ trigger: true }] });
			return { status: "disabled", basis: frame.basis };
		});
		await user.submit({ key: "no-rebase", text: "BLOCK" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 1);
		assert.equal(host.view().phase, "failed");
	} finally {
		await f.close();
	}
});

test("an artifact append write failure returns unknown, latches, and sends no model retry", async () => {
	const f = await fixture();
	let path: string | undefined;
	try {
		const host = await f.start(inferencePolicy(f.endpoint));
		await seed(host);
		const { b } = await writer(host),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, {
			planId: "paid-once",
			targetEntryIds: [target(frame)],
			maxCalls: 2,
		});
		assert.equal(
			(await job.infer({ modelKey: "summary", prompt: "ONE", maxOutputTokens: 64 })).status,
			"completed",
		);
		const committed = b.artifacts.append(job.scope, { expectedVersion: 0, records: [{ initial: true }] });
		assert.equal(committed.status, "committed");
		path = committed.journalPath;
		await chmod(path, 0o444);
		const receipt = b.artifacts.append(job.scope, { expectedVersion: 1, records: [{ candidate: true }] });
		assert.equal(receipt.status, "unknown");
		assert.equal(host.view().phase, "failed");
		await assert.rejects(
			job.infer({ modelKey: "summary", prompt: "DO-NOT-RETRY", maxOutputTokens: 64 }),
			/cancel|failed|storage/,
		);
		assert.equal(f.requests.length, 2);
	} finally {
		if (path) await chmod(path, 0o666);
		await f.close();
	}
});

test("opted-in completed adoption survives trusted reopen without replay", async () => {
	const f = await fixture();
	try {
		const first = await f.start(inferencePolicy(f.endpoint));
		await seed(first);
		const { b } = await writer(first),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, {
			planId: "adopted",
			targetEntryIds: [target(frame)],
			maxCalls: 1,
			requireArtifactReceipt: true,
		});
		const result = await job.infer({ modelKey: "summary", prompt: "ADOPT" });
		assert.equal(result.status, "completed");
		const receipt = b.artifacts.append(job.scope, {
			expectedVersion: frame.artifacts.version,
			records: [{ kind: "adopted-candidate" }],
			attemptIds: [result.attemptId],
		});
		assert.equal(receipt.status, "committed");
		const file = first.view().sessionFile;
		await first.dispose();
		const second = await f.start({ ...inferencePolicy(f.endpoint), reopenSessionFile: file });
		try {
			const reopened = await writer(second);
			assert.doesNotThrow(() => reopened.b.readFrame());
			assert.equal(f.requests.length, 2);
		} finally {
			await second.dispose();
		}
	} finally {
		await f.close();
	}
});

test("unadopted completed inference stays fail-closed across trusted reopen", async () => {
	const f = await fixture();
	let path: string | undefined;
	try {
		const first = await f.start(inferencePolicy(f.endpoint));
		await seed(first);
		const { b } = await writer(first),
			frame = b.readFrame();
		const initial = b.artifacts.append(frame.basis, {
			expectedVersion: frame.artifacts.version,
			records: [{ kind: "initial" }],
		});
		assert.equal(initial.status, "committed");
		path = initial.journalPath;
		const current = b.readFrame();
		const job = b.createJob(current.basis, {
			planId: "unknown-adoption",
			targetEntryIds: [target(current)],
			maxCalls: 1,
			requireArtifactReceipt: true,
		});
		const result = await job.infer({ modelKey: "summary", prompt: "UNKNOWN" });
		assert.equal(result.status, "completed");
		await chmod(path, 0o444);
		const unknown = b.artifacts.append(job.scope, {
			expectedVersion: initial.version,
			records: [{ kind: "candidate" }],
			attemptIds: [result.attemptId],
		});
		assert.equal(unknown.status, "unknown");
		const file = first.view().sessionFile;
		await first.dispose();
		await chmod(path, 0o666);
		const second = await f.start({ ...inferencePolicy(f.endpoint), reopenSessionFile: file });
		try {
			const reopened = await writer(second);
			assert.throws(() => reopened.b.readFrame(), /adopt|intent|storage|unknown/i);
			assert.equal(f.requests.length, 2);
		} finally {
			await second.dispose();
		}
	} finally {
		if (path) await chmod(path, 0o666);
		await f.close();
	}
});

test("call budgets survive reload, owner replacement and trusted process reopen", async () => {
	const f = await fixture();
	const config = inferencePolicy(f.endpoint);
	config.inference = {
		...config.inference!,
		policies: [{ ...config.inference!.policies[0], maxCalls: 1, maxJobCalls: 1 }],
	};
	try {
		const first = await f.start(config);
		await seed(first);
		const { owner, b } = await writer(first),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, { planId: "one", targetEntryIds: [target(frame)], maxCalls: 1 });
		await job.infer({ modelKey: "summary", prompt: "ONE", maxOutputTokens: 64 });
		await first.reload();
		owner.deactivateStrategy("strategy");
		owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
		const fresh = binding(owner),
			current = fresh.readFrame();
		const denied = fresh.createJob(current.basis, {
			planId: "two",
			targetEntryIds: [target(current)],
			maxCalls: 1,
		});
		await assert.rejects(denied.infer({ modelKey: "summary", prompt: "NO" }), /budget/);
		const file = first.view().sessionFile;
		await first.dispose();
		const second = await f.start({ ...config, reopenSessionFile: file });
		const next = (await writer(second)).b,
			reopened = next.readFrame();
		const attempt = next.createJob(reopened.basis, {
			planId: "three",
			targetEntryIds: [target(reopened)],
			maxCalls: 1,
		});
		await assert.rejects(attempt.infer({ modelKey: "summary", prompt: "NO" }), /budget/);
		assert.equal(next.audit().length, 1);
		assert.equal(f.requests.length, 2);
	} finally {
		await f.close();
	}
});

test("a job checks each explicit fallback with the same source and preserves zero-cap host limits", async () => {
	const f = await fixture({}, (p) => (p.model === "summary-model" ? { error: 503 } : { text: "FALLBACK" }));
	const config = inferencePolicy(f.endpoint);
	config.inference = {
		models: [
			...config.inference!.models,
			{ ...config.inference!.models[0], key: "fallback", model: "fallback-model" },
		],
		policies: [{ ...config.inference!.policies[0], modelKeys: ["summary", "fallback"] }],
	};
	try {
		const host = await f.start(config);
		await seed(host);
		const { b } = await writer(host),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, { planId: "fixed", targetEntryIds: [target(frame)], maxCalls: 2 });
		await assert.rejects(job.infer({ modelKey: "foreign", prompt: "FIXED" }), /allowlist/);
		const failed = await job.infer({
			modelKey: "summary",
			systemPrompt: "PREVIOUS-CONTEXT",
			prompt: "EXACT-TARGET",
			maxOutputTokens: 64,
		});
		assert.equal(failed.status, "failed");
		assert.equal(
			(
				await job.infer({
					modelKey: "fallback",
					systemPrompt: "PREVIOUS-CONTEXT",
					prompt: "EXACT-TARGET",
					maxOutputTokens: 0,
				})
			).status,
			"completed",
		);
		const attempts = f.requests.slice(1);
		assert.deepEqual(
			attempts.map((r) => r.model),
			["summary-model", "fallback-model"],
		);
		assert.deepEqual(
			attempts.map((r) => r.max_tokens),
			[64, 256],
		);
		for (const r of attempts) {
			assert.match(text(r), /PREVIOUS-CONTEXT/);
			assert.match(text(r), /EXACT-TARGET/);
		}
	} finally {
		await f.close();
	}
});

test("public inference policy rejects non-finite or missing budgets at bootstrap", async () => {
	for (const bad of [0, -1, Infinity, NaN]) {
		const f = await fixture();
		try {
			const config = inferencePolicy(f.endpoint);
			config.inference = {
				...config.inference!,
				policies: [{ ...config.inference!.policies[0], maxCalls: bad }],
			};
			await assert.rejects(f.start(config), /finite|budget|policy/);
			assert.equal(f.requests.length, 0);
		} finally {
			await f.close();
		}
	}
});

test("old tool async context cannot omit invocation scope to refresh authority after replacement", async () => {
	const entered = deferred(),
		release = deferred();
	let b: StrategyBinding;
	let refusal = "";
	const f = await fixture(
		{
			tools: [
				{
					name: "old",
					description: "old",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						entered.resolve();
						await release.promise;
						try {
							b.readFrame();
						} catch (e) {
							refusal = String(e);
						}
						return "OLD";
					},
				},
			],
		},
		(_p, n) => (n === 1 ? { tool: "old" } : { text: "ANSWER" }),
	);
	try {
		const host = await f.start();
		const user = host.connect("user", ["input.submit"]);
		const writer = host.connect("writer", ["context_artifacts.write"]);
		writer.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		b = binding(writer);
		await user.submit({ key: "old", text: "OLD" });
		await entered.promise;
		const transition = host.newSession();
		release.resolve();
		await transition;
		assert.match(refusal, /invocation|scope/);
		assert.doesNotThrow(() => b.readFrame());
	} finally {
		release.resolve();
		await f.close();
	}
});
