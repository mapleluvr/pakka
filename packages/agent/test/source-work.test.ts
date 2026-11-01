import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, deferred } from "./fixture.ts";
import { readNativeDocument, rewriteNativeDocument } from "./native-storage.ts";

const request = { modelKey: "summary", prompt: "FIXED-SOURCE-REQUEST", maxOutputTokens: 32 };
function options(f: any) {
	return {
		inference: {
			models: [
				{
					key: "summary",
					model: "summary-local",
					endpoint: f.endpoint,
					apiKey: "local-only",
					contextWindow: 16000,
					maxTokens: 64,
				},
			],
			policies: [
				{
					strategyId: "strategy",
					modelKeys: ["summary"],
					maxCalls: 8,
					maxJobCalls: 2,
					maxOutputTokens: 32,
					timeoutMs: 10000,
				},
			],
		},
	};
}
function bind(host: any) {
	const owner = host.connect("work-owner", ["context_artifacts.write", "model.infer"]);
	owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
	return owner.bindStrategy("strategy");
}
async function seed(host: any) {
	await host.connect("ui", ["input.submit"]).submit({ key: "seed", text: "SOURCE" });
	await host.waitForIdle();
}
function spec(b: any) {
	const frame = b.readFrame();
	return {
		frame,
		spec: {
			planId: "fixed-work-plan",
			targetEntryIds: [
				frame.projection.find((e: any) => e.messages.some((m: any) => m.role === "assistant")).sourceEntryId,
			],
			maxCalls: 2,
			requireArtifactReceipt: true,
			metadata: { configuration: "fixed-config", models: ["summary"] },
		},
	};
}

test("prepared SourceWork survives reopen with the same plan and fixed sources", async () => {
	const f = await fixture();
	try {
		let host = await f.start(options(f));
		await seed(host);
		let b = bind(host);
		const initial = spec(b);
		const job = b.createJob(initial.frame.basis, initial.spec);
		await job.prepare();
		const work = b.pendingWork();
		assert.equal(work.length, 1);
		assert.equal(work[0].jobId, job.id);
		assert.equal(work[0].stage, "planned");
		assert.deepEqual(work[0].metadata, initial.spec.metadata);
		const file = host.view().sessionFile;
		assert.match(
			JSON.stringify((await readNativeDocument(file, "pakka.source-work", work[0].address)).value),
			/fixed-work-plan|fixed-config/,
		);
		await host.dispose();
		host = await f.start({ ...options(f), reopenSessionFile: file });
		b = bind(host);
		assert.deepEqual(b.pendingWork(), work);
		const restored = await b.restoreJob(job.id);
		assert.equal(restored.id, job.id);
		assert.notEqual(restored.scope, job.scope);
		const result = await restored.infer(request);
		assert.equal(result.status, "completed");
		assert.equal(f.requests.length, 2);
		const receipt = await b.artifacts.append(restored.scope, {
			expectedVersion: 0,
			records: [{ result: "ADOPTED" }],
			attemptIds: [result.attemptId],
		});
		assert.equal(receipt.status, "committed");
		assert.equal(b.pendingWork().length, 0);
	} finally {
		await f.close();
	}
});

test("ready checkpoint retains retry position and finite budget across reopen", async () => {
	const f = await fixture();
	try {
		let host = await f.start(options(f));
		await seed(host);
		let b = bind(host);
		const initial = spec(b);
		const job = b.createJob(initial.frame.basis, initial.spec),
			first = await job.infer(request);
		const retryAtMs = Date.now() + 60000;
		const checkpoint = {
			stage: "ready",
			state: { nextAttempt: 2, reason: "local-validation-rejected" },
			retryAtMs,
		};
		assert.equal(
			(
				await b.artifacts.append(job.scope, {
					expectedVersion: 0,
					records: [{ result: "REJECTED" }],
					attemptIds: [first.attemptId],
					checkpoint,
				})
			).status,
			"committed",
		);
		assert.equal(b.pendingWork()[0].stage, "ready");
		assert.deepEqual(b.pendingWork()[0].checkpoint, checkpoint.state);
		assert.equal(b.pendingWork()[0].retryAtMs, retryAtMs);
		await assert.rejects(job.infer(request), /retry|time|ready/i);
		assert.equal(f.requests.length, 2, "live work also honors the persisted deadline");
		const file = host.view().sessionFile;
		await host.dispose();
		host = await f.start({ ...options(f), reopenSessionFile: file });
		b = bind(host);
		const restored = await b.restoreJob(job.id);
		await assert.rejects(restored.infer(request), /retry|time|ready/i);
		assert.equal(f.requests.length, 2, "future checkpoint cannot dispatch early");
	} finally {
		await f.close();
	}
});

test("ready work resumes its next confirmed attempt without replenishing the job budget", async () => {
	const f = await fixture();
	try {
		let host = await f.start(options(f));
		await seed(host);
		let b = bind(host);
		const initial = spec(b);
		const job = b.createJob(initial.frame.basis, initial.spec),
			first = await job.infer(request);
		await b.artifacts.append(job.scope, {
			expectedVersion: 0,
			records: [{ result: "REJECTED" }],
			attemptIds: [first.attemptId],
			checkpoint: { stage: "ready", state: { nextAttempt: 2 }, retryAtMs: 0 },
		});
		const file = host.view().sessionFile;
		await host.dispose();
		host = await f.start({ ...options(f), reopenSessionFile: file });
		b = bind(host);
		const restored = await b.restoreJob(job.id),
			second = await restored.infer(request);
		assert.notEqual(second.attemptId, first.attemptId);
		assert.equal(f.requests.length, 3);
		assert.equal(b.pendingWork()[0].budget.reserved, 2);
		await assert.rejects(restored.infer(request), /budget|exhausted/i);
		assert.equal(f.requests.length, 3);
		await b.artifacts.append(restored.scope, {
			expectedVersion: 1,
			records: [{ result: "SUCCESS" }],
			attemptIds: [second.attemptId],
			checkpoint: { stage: "finished" },
		});
		assert.equal(b.pendingWork().length, 0);
		assert.equal(b.audit().length, 2);
	} finally {
		await f.close();
	}
});

test("source plan metadata is checked against the immutable journal proof", async () => {
	const f = await fixture();
	try {
		const host = await f.start(options(f));
		await seed(host);
		const b = bind(host),
			initial = spec(b),
			job = b.createJob(initial.frame.basis, initial.spec);
		await job.prepare();
		const address = b.pendingWork()[0].address,
			file = host.view().sessionFile;
		await host.dispose();
		await rewriteNativeDocument(file, "pakka.source-work", address, (value: any) => ({
			...value,
			state: { ...value.state, metadata: { configuration: "tampered" } },
		}));
		const refused = await f.start({ ...options(f), reopenSessionFile: file });
		assert.equal(refused.view().phase, "failed");
		assert.match(refused.view().lastError ?? "", /plan|source.work|integrity/i);
		assert.throws(() => refused.connect("no-new-work", ["model.infer"]), /failed/i);
		assert.equal(f.requests.length, 1);
	} finally {
		await f.close();
	}
});

test(
	"a killed dispatch retains its exact reservation and cannot be replayed",
	{ timeout: 20000 },
	async () => {
		const sent = deferred(),
			release = deferred();
		const f = await fixture({}, async (payload) => {
			if (payload.model === "summary-local") {
				sent.resolve();
				await release.promise;
			}
			return { text: "LOCAL-ANSWER" };
		});
		let child;
		try {
			const first = await f.start(options(f));
			await seed(first);
			const file = first.view().sessionFile;
			await first.dispose();
			const configuration = join(f.root, "source-work-child.json");
			await writeFile(
				configuration,
				JSON.stringify({
					cwd: f.cwd,
					dataDir: f.dataDir,
					endpoint: f.endpoint,
					model: "local-model",
					apiKey: "local-only",
					systemPrompt: "PAKKA-SYSTEM",
					...options(f),
					reopenSessionFile: file,
				}),
			);
			child = fork(fileURLToPath(new URL("./source-work-child.ts", import.meta.url)), [configuration], {
				silent: true,
				execArgv: ["--experimental-strip-types"],
			});
			let stderr = "";
			child.stderr!.on("data", (data) => {
				stderr += String(data);
			});
			const [message] = await Promise.race([
				once(child, "message", { signal: AbortSignal.timeout(10000) }),
				once(child, "exit").then(() => {
					throw new Error("Child exited before dispatch: " + stderr);
				}),
			]);
			await sent.promise;
			const exited = once(child, "exit");
			child.kill("SIGKILL");
			await exited;
			// Explicit isolated maintenance after external proof of this exact writer exit.
			// Production open continues to refuse stale claims; this is not automatic recovery.
			const claimPath = join(dirname(file), "pakka-writer.json"),
				claimBytes = await readFile(claimPath, "utf8"),
				claim = JSON.parse(claimBytes);
			assert.equal(claim.schema, "pakka.writer.v1");
			assert.equal(claim.pid, child.pid);
			assert.match(claim.nonce, /^[0-9a-f-]{36}$/);
			assert.equal(await readFile(claimPath, "utf8"), claimBytes);
			await unlink(claimPath);
			const host = await f.start({ ...options(f), reopenSessionFile: file }),
				b = bind(host),
				pending = b.pendingWork()[0];
			assert.equal(pending.jobId, message.jobId);
			assert.equal(pending.stage, "reserved");
			assert.equal(pending.budget.reserved, 1);
			assert.equal(pending.hasSealedResult, false);
			const restored = await b.restoreJob(message.jobId);
			await assert.rejects(restored.infer(request), /unconfirmed|replay|unknown/i);
			assert.equal(f.requests.length, 2);
			assert.equal(b.pendingWork()[0].budget.reserved, 1);
			assert.throws(() => b.readFrame(), /unresolved|unknown/i);
			assert.equal(host.view().phase, "failed");
			assert.equal(f.requests.length, 2);
		} finally {
			release.resolve();
			if (child && child.exitCode === null && child.signalCode === null) {
				const exit = once(child, "exit");
				child.kill("SIGKILL");
				await exit;
			}
			await f.close();
		}
	},
);

test("sealed single-call output resumes local adoption without a second model request", async () => {
	const f = await fixture();
	try {
		let host = await f.start(options(f));
		await seed(host);
		let b = bind(host);
		const initial = spec(b);
		const job = b.createJob(initial.frame.basis, initial.spec),
			result = await job.infer(request);
		assert.equal(result.status, "completed");
		const file = host.view().sessionFile;
		assert.equal(b.pendingWork()[0].stage, "resultStored");
		await host.dispose();
		host = await f.start({ ...options(f), reopenSessionFile: file });
		b = bind(host);
		assert.throws(() => b.readFrame(), /adoption|unresolved/i);
		assert.equal(host.view().phase, "ready");
		const restored = await b.restoreJob(job.id);
		assert.deepEqual(await restored.infer(request), result);
		assert.equal(f.requests.length, 2);
		await assert.rejects(
			restored.infer({ ...request, prompt: "DIFFERENT-SOURCE-REQUEST" }),
			/request|digest|changed/i,
		);
		assert.equal(f.requests.length, 2);
		const frame = b.readWorkFrame(restored.scope);
		assert.equal(frame.artifacts.version, 0);
		assert.throws(() => b.createJob(frame.basis, initial.spec), /recovery|basis|local/i);
		const receipt = await b.artifacts.append(restored.scope, {
			expectedVersion: 0,
			records: [{ result: "FROM-SEALED-OUTPUT" }],
			attemptIds: [result.attemptId],
		});
		assert.equal(receipt.status, "committed");
		assert.equal(b.pendingWork().length, 0);
		assert.equal(b.readFrame().artifacts.version, 1);
	} finally {
		await f.close();
	}
});
