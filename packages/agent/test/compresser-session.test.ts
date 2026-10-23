import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import * as api from "../src/index.ts";
import { fixture as httpFixture, seed, text, deferred } from "./fixture.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";

const outputTool = {
	name: "submit_candidate",
	description: "Submit the complete source-bound candidate, never a patch.",
	parameters: {
		type: "object",
		properties: { text: { type: "string", minLength: 3 } },
		required: ["text"],
		additionalProperties: false,
	},
};
const request = { modelKey: "summary", prompt: "SOURCE ALPHA", outputTool };
const fixtureCleanup = new Map<string, () => Promise<void>>();
async function fixture(...args: Parameters<typeof httpFixture>) {
	assert.equal(
		typeof api.createCompresserSession,
		"function",
		"the production public API must create the governed native Compresser Session",
	);
	const f = await httpFixture(...args);
	const close = async () => {
		fixtureCleanup.delete(f.root);
		await f.close();
	};
	fixtureCleanup.set(f.root, close);
	return { ...f, close };
}
async function container(root: string, toolCallingTolerance = 3, unresolvedErrorTolerance = 4) {
	assert.equal(
		typeof api.createCompresserSession,
		"function",
		"the production public API must create the governed native Compresser Session",
	);
	try {
		return await api.createCompresserSession({
			storageDir: join(root, "compresser"),
			toolCallingTolerance,
			unresolvedErrorTolerance,
		});
	} catch (error) {
		await fixtureCleanup.get(root)?.();
		throw error;
	}
}
function policy(endpoint: string, compresserSession: api.CompresserSession, maxCalls = 30, maxJobCalls = 10) {
	const config = inferencePolicy(endpoint).inference!;
	return {
		inference: {
			...config,
			compresserSession,
			policies: config.policies.map((p) => ({ ...p, maxCalls, maxJobCalls })),
		},
	};
}
function source(host: api.Host, planId: string, maxCalls = 10) {
	const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
	owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
	const b = binding(owner),
		frame = b.readFrame();
	return { b, owner, job: b.createJob(frame.basis, { planId, targetEntryIds: [target(frame)], maxCalls }) };
}

test("Compresser repairs a stop and invalid call in the same native trajectory, auditing every real request", async () => {
	let n = 0;
	const f = await fixture({}, (p) =>
		p.model !== "summary-model"
			? { text: "MAIN" }
			: ++n === 1
				? { text: "EARLIER ANALYSIS" }
				: n === 2
					? { tool: "submit_candidate", args: {} }
					: { tool: "submit_candidate", args: { text: "COMPLETE" } },
	);
	const c = await container(f.root);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "repair");
		const result = await job.converse(request);
		assert.equal(result.status, "completed", result.reason ?? "complete candidate required");
		assert.equal(result.toolCall?.arguments.text, "COMPLETE");
		const sent = f.requests.filter((p) => p.model === "summary-model");
		assert.equal(sent.length, 3);
		assert.match(text(sent[2]), /EARLIER ANALYSIS/);
		assert.ok(sent[2].messages.some((m) => m.role === "tool" && m.tool_call_id === "call-3"));
		assert.match(text(sent[2]), /complete|entire|full/i);
		assert.deepEqual(
			b.audit().map((a) => a.status),
			["failed", "failed", "completed"],
		);
		assert.equal(new Set(b.audit().map((a) => a.attemptId)).size, 3);
		assert.deepEqual(
			result.compresser?.attemptIds,
			b.audit().map((a) => a.attemptId),
		);
		assert.equal(
			result.compresser?.reportedUsage.output,
			6,
			"logical usage includes all measured repair requests, not just the successful one",
		);
		assert.equal(result.compresser?.usageStatus, "known");
		const state = await c.snapshot();
		assert.equal(result.compresser?.sessionId, state.sessionId);
		assert.equal(result.compresser?.conversationId, state.conversations[0].conversationId);
		assert.equal(state.status, "open");
		assert.equal(state.toolErrors, 1);
		assert.equal(state.unresolvedErrors, 1);
		assert.equal(state.conversations.length, 1);
		assert.ok(Object.isFrozen(state));
		assert.ok(Object.isFrozen(result.toolCall?.arguments));
	} finally {
		await f.close();
		await c.close();
	}
});

test("an empty semantic error is still a rejected call, including repeated admission validation", async () => {
	let validations = 0;
	const f = await fixture({}, (p) =>
		p.model === "summary-model" ? { tool: "submit_candidate", args: { text: "COMPLETE" } } : { text: "MAIN" },
	);
	const c = await container(f.root);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { job } = source(host, "empty-diagnostic");
		assert.equal(
			(await job.converse(request, () => (++validations === 1 ? "" : undefined))).status,
			"completed",
		);
		const before = f.requests.length;
		assert.equal(before, 3);
		assert.equal((await c.snapshot()).toolErrors, 1);
		await assert.rejects(
			job.converse(request, () => ""),
			/validation/i,
		);
		assert.equal(f.requests.length, before);
	} finally {
		await f.close();
		await c.close();
	}
});

test("Compresser provider errors use the native failed-run boundary without losing earlier analysis", async () => {
	let n = 0;
	const f = await fixture({}, (p) =>
		p.model !== "summary-model"
			? { text: "MAIN" }
			: ++n === 1
				? { text: "RETAIN PROVIDER ANALYSIS" }
				: n === 2
					? { error: 400 }
					: { tool: "submit_candidate", args: { text: "COMPLETE" } },
	);
	const c = await container(f.root);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "provider");
		assert.equal((await job.converse(request)).status, "completed");
		assert.equal(n, 3);
		assert.match(text(f.requests.at(-1)!), /RETAIN PROVIDER ANALYSIS/);
		assert.deepEqual(
			b.audit().map((a) => a.status),
			["failed", "failed", "completed"],
		);
		assert.equal((await c.snapshot()).unresolvedErrors, 2);
	} finally {
		await f.close();
		await c.close();
	}
});

test("one external Conversation creates independent Compresser Conversations and repeated job admission sends nothing", async () => {
	const f = await fixture({}, (p) =>
		p.model === "summary-model" ? { tool: "submit_candidate", args: { text: "COMPLETE" } } : { text: "MAIN" },
	);
	const c = await container(f.root);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "first");
		const first = await job.converse(request),
			before = f.requests.length;
		assert.deepEqual(await job.converse(request), first);
		assert.equal(f.requests.length, before);
		const frame = b.readFrame();
		const second = b.createJob(frame.basis, {
			planId: "second",
			targetEntryIds: [target(frame)],
			maxCalls: 10,
		});
		assert.equal((await second.converse({ ...request, prompt: "SOURCE BETA" })).status, "completed");
		const state = await c.snapshot();
		assert.equal(state.conversations.length, 2);
		assert.equal(new Set(state.conversations.map((row) => row.conversationId)).size, 2);
		const last = f.requests.at(-1)!;
		assert.match(text(last), /SOURCE BETA/);
		assert.doesNotMatch(text(last), /SOURCE ALPHA/);
		assert.equal(new Set(state.conversations.map((row) => row.sourceConversationId)).size, 1);
	} finally {
		await f.close();
		await c.close();
	}
});

test("tool tolerance is shared across child Conversations and survives reopen without dispatch", async () => {
	let n = 0;
	const f = await fixture({}, (p) =>
		p.model !== "summary-model"
			? { text: "MAIN" }
			: ++n % 2 === 1
				? { tool: "submit_candidate", args: {} }
				: { tool: "submit_candidate", args: { text: "COMPLETE" } },
	);
	let c = await container(f.root, 2, 4);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "first");
		assert.equal((await job.converse(request)).status, "completed");
		const frame = b.readFrame(),
			next = b.createJob(frame.basis, { planId: "second", targetEntryIds: [target(frame)], maxCalls: 10 });
		const failed = await next.converse({ ...request, prompt: "SOURCE BETA" });
		assert.equal(failed.status, "failed");
		assert.equal(n, 3);
		const state = await c.snapshot();
		assert.equal(state.status, "sealed");
		assert.equal(state.toolErrors, 2);
		assert.ok(state.lastError?.reason);
		const before = f.requests.length;
		await assert.rejects(job.converse(request), /sealed/i);
		await c.close();
		c = await container(f.root, 2, 4);
		assert.deepEqual(await c.snapshot(), state);
		assert.equal(f.requests.length, before);
	} finally {
		await f.close();
		await c.close();
	}
});

for (const kind of ["stop", "provider"] as const)
	test(`four ${kind} errors seal the Session, preserve the actual reason, and send no fifth request`, async () => {
		let n = 0;
		const f = await fixture({}, (p) => {
			if (p.model !== "summary-model") return { text: "MAIN" };
			n++;
			return kind === "stop" ? { text: "DRAFT " + n } : { error: 400 };
		});
		const c = await container(f.root);
		try {
			const host = await f.start(policy(f.endpoint, c));
			await seed(host);
			const { b, job } = source(host, kind);
			const result = await job.converse(request);
			assert.equal(result.status, "failed");
			assert.equal(n, 4);
			assert.equal(b.audit().length, 4);
			const state = await c.snapshot();
			assert.equal(state.status, "sealed");
			assert.equal(state.unresolvedErrors, 4);
			assert.equal(state.toolErrors, 0);
			assert.match(state.lastError!.reason, kind === "provider" ? /LOCAL-FAILURE/ : /complete|submission/i);
			assert.equal(result.reason, state.lastError!.reason);
		} finally {
			await f.close();
			await c.close();
		}
	});

for (const code of [429, 503])
	test(`Compresser HTTP ${code} has no hidden provider retries outside the charged native attempts`, async () => {
		let n = 0;
		const f = await fixture({}, (p) => {
			if (p.model !== "summary-model") return { text: "MAIN" };
			n++;
			return { error: code };
		});
		const c = await container(f.root, 3, 2);
		try {
			const host = await f.start(policy(f.endpoint, c));
			await seed(host);
			const { b, job } = source(host, "http-" + code);
			assert.equal((await job.converse(request)).status, "failed");
			assert.equal(n, 2);
			assert.equal(b.audit().length, n);
			const state = await c.snapshot();
			assert.equal(state.status, "sealed");
			assert.equal(state.unresolvedErrors, 2);
			assert.equal(state.toolErrors, 0);
		} finally {
			await f.close();
			await c.close();
		}
	});

test("Compresser output-length failure with a tool-shaped partial is unresolved, never an adopted tool error", async () => {
	let n = 0;
	const f = await fixture({}, (p) =>
		p.model !== "summary-model"
			? { text: "MAIN" }
			: ++n === 1
				? { tool: "submit_candidate", args: { text: "PARTIAL" }, finishReason: "length" }
				: { tool: "submit_candidate", args: { text: "COMPLETE" } },
	);
	const c = await container(f.root);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "length");
		const result = await job.converse(request);
		assert.equal(result.status, "completed");
		assert.equal(n, 2);
		const state = await c.snapshot();
		assert.equal(state.unresolvedErrors, 1);
		assert.equal(state.toolErrors, 0);
		assert.equal(b.audit()[0].status, "failed");
		assert.match(b.audit()[0].reason!, /length/i);
	} finally {
		await f.close();
		await c.close();
	}
});

test("Compresser strict raw and source validation failures are complete-call repairs, not adopted normalized DTOs", async () => {
	let n = 0;
	const f = await fixture({}, (p) =>
		p.model !== "summary-model"
			? { text: "MAIN" }
			: ++n === 1
				? { tool: "submit_candidate", argsJson: '{"text":"bad\\q"}' }
				: n === 2
					? { tool: "submit_candidate", args: { text: "FOREIGN" } }
					: { tool: "submit_candidate", args: { text: "COMPLETE" } },
	);
	const c = await container(f.root, 4, 4);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "strict");
		const result = await job.converse(request, (call) =>
			call.arguments.text === "FOREIGN"
				? "Foreign source reference; rewrite the complete candidate"
				: undefined,
		);
		assert.equal(result.toolCall?.arguments.text, "COMPLETE");
		assert.equal(n, 3);
		assert.equal((await c.snapshot()).toolErrors, 2);
		assert.deepEqual(
			b.audit().map((a) => a.status),
			["failed", "failed", "completed"],
		);
		assert.match(text(f.requests.at(-1)!), /Foreign source/);
	} finally {
		await f.close();
		await c.close();
	}
});

test("a source revocation during Compresser HTTP prevents late adoption and another dispatch", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({}, async (p) => {
		if (p.model !== "summary-model") return { text: "MAIN" };
		entered.resolve();
		await release.promise;
		return { tool: "submit_candidate", args: { text: "COMPLETE" } };
	});
	const c = await container(f.root);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { owner, job } = source(host, "revoked");
		const pending = job.converse(request);
		await entered.promise;
		owner.deactivateStrategy("strategy");
		release.resolve();
		const result = await pending;
		assert.notEqual(result.status, "completed");
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
	} finally {
		release.resolve();
		await f.close();
		await c.close();
	}
});

test("Compresser job and strategy hard budgets remain independent of error tolerances", async () => {
	const f = await fixture({}, (p) => ({ text: p.model === "summary-model" ? "NO SUBMISSION" : "MAIN" }));
	const c = await container(f.root, 10, 10);
	try {
		const host = await f.start(policy(f.endpoint, c, 3, 2));
		await seed(host);
		const { b, job } = source(host, "budget-first", 2);
		assert.equal((await job.converse(request)).status, "failed");
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 2);
		assert.equal((await job.converse(request)).status, "failed");
		const frame = b.readFrame(),
			second = b.createJob(frame.basis, {
				planId: "budget-second",
				targetEntryIds: [target(frame)],
				maxCalls: 2,
			});
		assert.equal((await second.converse({ ...request, prompt: "SOURCE BETA" })).status, "failed");
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 3);
		assert.equal(b.audit().length, 3);
		const state = await c.snapshot();
		assert.equal(state.unresolvedErrors, 3);
		assert.equal(state.status, "open");
	} finally {
		await f.close();
		await c.close();
	}
});

test("managed Compresser requests spend auxiliary aggregate quota and never primary quota", async () => {
	const f = await fixture({}, (p) => ({ text: p.model === "summary-model" ? "NO SUBMISSION" : "MAIN" }));
	const c = await container(f.root, 10, 10);
	let runtime: api.Runtime | undefined;
	try {
		runtime = await api.createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			...policy(f.endpoint, c),
			limits: { maxConversations: 2, maxPrimaryAttempts: 10, maxAuxiliaryAttempts: 2 },
		});
		const host = runtime.root();
		await seed(host);
		const { b, job } = source(host, "aggregate");
		const result = await job.converse(request);
		assert.equal(result.status, "failed");
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 2);
		assert.deepEqual(runtime.view().budget, { primaryAttempts: 1, auxiliaryAttempts: 2 });
		assert.equal(
			b.audit().length,
			3,
			"a cross-store aggregate denial retains its already committed source-job reservation",
		);
		assert.match(b.audit().at(-1)!.reason!, /auxiliary.*budget/i);
		assert.equal((await c.snapshot()).unresolvedErrors, 2);
	} finally {
		await runtime?.close();
		await f.close();
		await c.close();
	}
});

test("one container serves distinct external Sessions and sealing refuses adoption of a previously returned candidate", async () => {
	const first = await fixture({}, (p) =>
		p.model === "summary-model"
			? { tool: "submit_candidate", args: { text: "COMPLETE" } }
			: { text: "MAIN A" },
	);
	const second = await fixture({}, (p) =>
		p.model === "summary-model" ? { tool: "submit_candidate", args: {} } : { text: "MAIN B" },
	);
	let c: api.CompresserSession | undefined;
	try {
		c = await container(first.root, 2, 4);
		const a = await first.start(policy(first.endpoint, c)),
			b = await second.start(policy(second.endpoint, c));
		await seed(a);
		await seed(b);
		const original = source(a, "unused-first"),
			frame = original.b.readFrame();
		const job = original.b.createJob(frame.basis, {
			planId: "unadopted-success",
			targetEntryIds: [target(frame)],
			maxCalls: 10,
			requireArtifactReceipt: true,
		});
		const result = await job.converse(request);
		assert.equal(result.status, "completed");
		const other = source(b, "sealing-other-session");
		assert.equal((await other.job.converse({ ...request, prompt: "SOURCE BETA" })).status, "failed");
		const state = await c.snapshot();
		assert.equal(state.status, "sealed");
		assert.equal(state.toolErrors, 2);
		assert.equal(new Set(state.conversations.map((row) => row.sourceSessionId)).size, 2);
		assert.throws(
			() =>
				original.b.artifacts.append(job.scope, {
					expectedVersion: 0,
					records: [{ candidate: "must not be adopted" }],
					attemptIds: [result.attemptId],
				}),
			/sealed/i,
		);
		assert.equal(original.b.artifacts.read(job.scope).version, 0);
	} finally {
		await first.close();
		await second.close();
		await c?.close();
	}
});

test("shared sealing keeps another source's candidate private in admission and late-result errors", async () => {
	const secret = "SOURCE_A_PRIVATE_CANDIDATE";
	const entered = deferred(),
		release = deferred();
	const first = await fixture({}, (p) =>
		p.model === "summary-model"
			? { tool: "submit_candidate", args: { privateDraft: secret } }
			: { text: "MAIN" },
	);
	const second = await fixture({}, async (p) => {
		if (p.model !== "summary-model") return { text: "MAIN" };
		entered.resolve();
		await release.promise;
		return { tool: "submit_candidate", args: { text: "OTHER COMPLETE" } };
	});
	let c: api.CompresserSession | undefined, pending: Promise<api.InferenceResult> | undefined;
	try {
		c = await container(first.root, 1, 4);
		const hostA = await first.start(policy(first.endpoint, c));
		await seed(hostA);
		const hostB = await second.start(policy(second.endpoint, c));
		await seed(hostB);
		const observer = source(hostB, "private-observer");
		pending = observer.job.converse(request);
		await entered.promise;
		const rejected = await source(hostA, "private-owner").job.converse(request);
		assert.equal(rejected.status, "failed");
		assert.match(
			rejected.reason!,
			new RegExp(secret),
			"the originating source retains its actual diagnostic",
		);
		const state = await c.snapshot();
		assert.equal(state.status, "sealed");
		assert.match(
			state.lastError!.reason,
			new RegExp(secret),
			"trusted bootstrap retains the last actual error",
		);
		const frame = observer.b.readFrame();
		const blocked = observer.b.createJob(frame.basis, {
			planId: "private-blocked",
			targetEntryIds: [target(frame)],
			maxCalls: 3,
		});
		let admission = "";
		await assert.rejects(blocked.converse(request), (error) => {
			admission = String(error);
			assert.match(admission, /sealed|unavailable/i);
			assert.doesNotMatch(
				admission,
				new RegExp(secret),
				"another source cannot receive the private seal cause",
			);
			return true;
		});
		release.resolve();
		const late = await pending;
		assert.equal(late.status, "quarantined");
		assert.doesNotMatch(JSON.stringify(late), new RegExp(secret));
		assert.equal(second.requests.filter((p) => p.model === "summary-model").length, 1);
		assert.equal(observer.b.audit().length, 1, "denied admission spends no new auxiliary attempt");
		assert.match((await c.snapshot()).lastError!.reason, new RegExp(secret));
		await writeFile(
			join(first.root, "privacy-observation.json"),
			JSON.stringify({ state, admission, late, otherAudit: observer.b.audit() }, null, 2),
		);
	} finally {
		release.resolve();
		await pending?.catch(() => {});
		await first.close();
		await second.close();
		await c?.close();
	}
});

test("a sibling seal quarantines an already-in-flight otherwise valid response", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({}, async (p) => {
		if (p.model !== "summary-model") return { text: "MAIN" };
		if (text(p).includes("SLOW SOURCE")) {
			entered.resolve();
			await release.promise;
			return { tool: "submit_candidate", args: { text: "COMPLETE" } };
		}
		return { tool: "submit_candidate", args: {} };
	});
	const c = await container(f.root, 1, 4);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "slow");
		const slow = job.converse({ ...request, prompt: "SLOW SOURCE" });
		await entered.promise;
		const frame = b.readFrame(),
			sibling = b.createJob(frame.basis, { planId: "seal", targetEntryIds: [target(frame)], maxCalls: 10 });
		assert.equal((await sibling.converse(request)).status, "failed");
		release.resolve();
		assert.equal((await slow).status, "quarantined");
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 2);
		assert.equal(
			(await c.snapshot()).conversations.find((row) => row.jobId === job.id)!.status,
			"quarantined",
		);
	} finally {
		release.resolve();
		await f.close();
		await c.close();
	}
});

test("multiple output calls in one response are not candidate patches and each actual tool error counts once", async () => {
	const f = await fixture({}, (p) =>
		p.model !== "summary-model"
			? { text: "MAIN" }
			: {
					toolCalls: [
						{ tool: "submit_candidate", args: { text: "FIRST" } },
						{ tool: "submit_candidate", args: { text: "SECOND" } },
					],
				},
	);
	const c = await container(f.root, 2, 4);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "multiple");
		const result = await job.converse(request);
		assert.equal(result.status, "failed");
		assert.equal(result.toolCall, undefined);
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
		const state = await c.snapshot();
		assert.equal(state.status, "sealed");
		assert.equal(state.toolErrors, 2);
		assert.equal(state.unresolvedErrors, 0);
		assert.equal(b.audit().length, 1);
		assert.equal(b.audit()[0].status, "failed");
	} finally {
		await f.close();
		await c.close();
	}
});

test("cancelling the source job refuses a late result without spending error tolerance or dispatching again", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({}, async (p) => {
		if (p.model !== "summary-model") return { text: "MAIN" };
		entered.resolve();
		await release.promise;
		return { tool: "submit_candidate", args: { text: "LATE" } };
	});
	const c = await container(f.root);
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { b, job } = source(host, "cancel");
		const pending = job.converse(request);
		await entered.promise;
		job.cancel("operator cancellation");
		release.resolve();
		assert.equal((await pending).status, "quarantined");
		assert.equal(b.audit().length, 1);
		assert.equal(b.audit()[0].status, "quarantined");
		const state = await c.snapshot();
		assert.equal(state.status, "open");
		assert.equal(state.toolErrors, 0);
		assert.equal(state.unresolvedErrors, 0);
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
		await assert.rejects(job.converse(request), /cancel|abort/i);
	} finally {
		release.resolve();
		await f.close();
		await c.close();
	}
});

test("a source audit storage failure after real HTTP seals unknown work without a correction or releasing admission", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({}, async (p) => {
		if (p.model !== "summary-model") return { text: "MAIN" };
		entered.resolve();
		await release.promise;
		return { tool: "submit_candidate", args: { text: "COMPLETE" } };
	});
	const c = await container(f.root);
	let path: string | undefined;
	try {
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner),
			original = b.readFrame();
		const initial = b.artifacts.append(original.basis, {
			expectedVersion: original.artifacts.version,
			records: [{ kind: "initial" }],
		});
		assert.equal(initial.status, "committed");
		path = initial.journalPath;
		const frame = b.readFrame(),
			job = b.createJob(frame.basis, {
				planId: "audit-unknown",
				targetEntryIds: [target(frame)],
				maxCalls: 10,
			});
		const pending = job.converse(request);
		await entered.promise;
		const attempt = b.audit()[0].attemptId,
			directory = dirname(path);
		const files = await Promise.all(
			(await readdir(directory))
				.filter((name) => name.endsWith(".jsonl"))
				.map(async (name) => ({
					path: join(directory, name),
					content: await readFile(join(directory, name), "utf8"),
				})),
		);
		const matching = files.filter((file) => file.content.includes(attempt));
		assert.equal(matching.length, 1);
		path = matching[0].path;
		await chmod(path, 0o444);
		const rejected = assert.rejects(pending, /storage|persist|journal|unknown|writ/i);
		release.resolve();
		await rejected;
		const state = await c.snapshot();
		assert.equal(state.status, "sealed");
		assert.equal(state.conversations[0].status, "quarantined");
		assert.equal(state.toolErrors, 0);
		assert.equal(state.unresolvedErrors, 0);
		assert.equal(
			await readFile(path, "utf8"),
			matching[0].content,
			"the original reservation remains, with no invented completion or refund",
		);
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
		assert.throws(
			() =>
				b.artifacts.append(job.scope, {
					expectedVersion: frame.artifacts.version,
					records: [{ candidate: "DO-NOT-ADOPT" }],
					attemptIds: [attempt],
				}),
			/storage|failed|unknown|cancel/i,
		);
		await assert.rejects(job.converse(request), /storage|failed|unknown|cancel/i);
	} finally {
		release.resolve();
		if (path) await chmod(path, 0o666);
		await f.close();
		await c.close();
	}
});

test("completed native job state survives reopen without new HTTP and one writer is enforced", async () => {
	const f = await fixture({}, (p) =>
		p.model === "summary-model" ? { tool: "submit_candidate", args: { text: "COMPLETE" } } : { text: "MAIN" },
	);
	let c = await container(f.root);
	try {
		await assert.rejects(
			api.createCompresserSession({
				storageDir: join(f.root, "compresser"),
				toolCallingTolerance: 3,
				unresolvedErrorTolerance: 4,
			}),
			/writer.*locked/i,
		);
		const host = await f.start(policy(f.endpoint, c));
		await seed(host);
		const { job } = source(host, "complete-reopen");
		assert.equal((await job.converse(request)).status, "completed");
		const state = await c.snapshot(),
			requests = f.requests.length;
		await c.close();
		c = await container(f.root);
		assert.deepEqual(await c.snapshot(), state);
		assert.equal(f.requests.length, requests);
	} finally {
		await f.close();
		await c.close();
	}
});
