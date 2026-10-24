import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness, createRegistry, defineDoc } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { createModels } from "@earendil-works/pi-ai";
import * as api from "../src/index.ts";
import { fixture, seed, text, deferred } from "./fixture.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";

const outputTool = {
	name: "submit_candidate",
	description: "Submit the complete local candidate.",
	parameters: { type: "object", properties: { text: { type: "string", minLength: 3 } }, required: ["text"], additionalProperties: false },
};
const request = (prompt: string) => ({ modelKey: "summary", prompt, outputTool });
const complete = () => ({ tool: "submit_candidate", args: { text: "COMPLETE" } });
async function container(root: string, toolCallingTolerance = 2, unresolvedErrorTolerance = 2) {
	return api.createCompresserSession({ storageDir: join(root, "compresser"), toolCallingTolerance, unresolvedErrorTolerance });
}
function policy(endpoint: string, compresserSession: api.CompresserSession) {
	const base = inferencePolicy(endpoint).inference!;
	return { inference: { ...base, compresserSession, policies: base.policies.map(p => ({ ...p, maxCalls: 50, maxJobCalls: 10 })) } };
}
function setup(host: api.Host) {
	const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
	owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
	const b = binding(owner);
	const job = (planId: string) => { const frame = b.readFrame(); return b.createJob(frame.basis, { planId, targetEntryIds: [target(frame)], maxCalls: 8, requireArtifactReceipt: true }); };
	return { b, job };
}

for (const kind of ["tool", "stop", "provider"] as const)
	test(`each Compressor Conversation has its own ${kind} allowance, not the sum of successful siblings`, async () => {
		const counts = new Map<string, number>();
		const f = await fixture({}, p => {
			if (p.model !== "summary-model") return { text: "MAIN" };
			const key = text(p).includes("JOB-A") ? "A" : "B";
			const n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
			if (n !== 1) return complete();
			return kind === "tool" ? { tool: "submit_candidate", args: {} } : kind === "stop" ? { text: "UNFINISHED" } : { error: 400 };
		});
		const c = await container(f.root);
		try {
			const host = await f.start(policy(f.endpoint, c)); await seed(host);
			const { job } = setup(host);
			assert.equal((await job("first").converse(request("JOB-A"))).status, "completed");
			assert.equal((await job("second").converse(request("JOB-B"))).status, "completed", "another Conversation's incident cannot consume this job's allowance");
			assert.deepEqual([...counts.values()], [2, 2]);
			const state = await c.snapshot();
			assert.equal(state.status, "open");
			assert.deepEqual(state.conversations.map(row => [row.toolErrors, row.unresolvedErrors, row.sealed]), kind === "tool" ? [[1, 0, false], [1, 0, false]] : [[0, 1, false], [0, 1, false]]);
			await writeFile(join(f.root, "conversation-observation.json"), JSON.stringify({ state, requests: f.requests }, null, 2));
		} finally { await f.close(); await c.close(); }
	});

test("a sealed Conversation leaves sibling native HTTP and subsequent independent admission usable", async () => {
	const entered = deferred(), release = deferred();
	const f = await fixture({}, async p => {
		if (p.model !== "summary-model") return { text: "MAIN" };
		if (text(p).includes("SLOW-B")) { entered.resolve(); await release.promise; return complete(); }
		return text(p).includes("BAD-A") ? { tool: "submit_candidate", args: {} } : complete();
	});
	const c = await container(f.root, 1, 2);
	let pending: Promise<api.InferenceResult> | undefined;
	try {
		const host = await f.start(policy(f.endpoint, c)); await seed(host);
		const { job, b } = setup(host), slow = job("slow"), bad = job("bad");
		pending = slow.converse(request("SLOW-B")); await entered.promise;
		assert.equal((await bad.converse(request("BAD-A"))).status, "failed");
		const before = f.requests.length;
		await assert.rejects(bad.converse(request("BAD-A")), /sealed/i);
		assert.equal(f.requests.length, before, "same sealed job has no fresh reservation or provider attempt");
		const fresh = job("fresh"), result = await fresh.converse(request("FRESH-C"));
		assert.equal(result.status, "completed", "a new unrelated job does not need a replacement Session");
		release.resolve();
		assert.equal((await pending).status, "completed", "the in-flight sibling candidate remains admissible");
		const state = await c.snapshot();
		assert.equal(state.status, "open");
		assert.deepEqual(state.conversations.filter(row => row.sealed).map(row => row.jobId), [bad.id]);
		assert.deepEqual(state.conversations.filter(row => row.status === "completed").map(row => row.jobId).sort(), [slow.id, fresh.id].sort());
		assert.equal(b.audit().length, 3);
		await writeFile(join(f.root, "conversation-observation.json"), JSON.stringify({ state, audit: b.audit() }, null, 2));
	} finally { release.resolve(); await pending?.catch(() => {}); await f.close(); await c.close(); }
});

test("a sibling tolerance does not revoke an exact returned candidate's artifact receipt", async () => {
	const f = await fixture({}, p => p.model !== "summary-model" ? { text: "MAIN" } : text(p).includes("BAD") ? { tool: "submit_candidate", args: {} } : complete());
	const c = await container(f.root, 1, 2);
	try {
		const host = await f.start(policy(f.endpoint, c)); await seed(host);
		const { b, job } = setup(host), good = job("adopt"), bad = job("bad");
		const result = await good.converse(request("GOOD")); assert.equal(result.status, "completed");
		assert.equal((await bad.converse(request("BAD"))).status, "failed");
		const receipt = b.artifacts.append(good.scope, { expectedVersion: 0, records: [{ localCandidate: "GOOD" }], attemptIds: [result.attemptId] });
		assert.equal(receipt.status, "committed", "only the candidate's own Conversation seal can deny its receipt");
		assert.equal(b.artifacts.read(good.scope).records.length, 1);
	} finally { await f.close(); await c.close(); }
});

test("source-local unknown completion quarantines only its Conversation and retains the pending reservation", async () => {
	const entered = deferred(), release = deferred();
	const first = await fixture({}, async p => { if (p.model !== "summary-model") return { text: "MAIN" }; entered.resolve(); await release.promise; return complete(); });
	const second = await fixture({}, p => p.model === "summary-model" ? complete() : { text: "MAIN" });
	let c = await container(first.root);
	let lockedPath: string | undefined, pending: Promise<api.InferenceResult> | undefined;
	try {
		const host = await first.start(policy(first.endpoint, c)); await seed(host);
		const { b, job } = setup(host), failed = job("source-unknown");
		const initial = b.artifacts.append(b.readFrame().basis, { expectedVersion: 0, records: [{ initial: true }] });
		assert.equal(initial.status, "committed");
		pending = failed.converse(request("UNKNOWN SOURCE")); await entered.promise;
		const attempt = b.audit()[0].attemptId;
		const directory = dirname(initial.journalPath);
		for (const name of await readdir(directory)) if (name.endsWith(".jsonl")) {
			const path = join(directory, name), body = await readFile(path, "utf8");
			if (body.includes(attempt)) { lockedPath = path; break; }
		}
		assert.ok(lockedPath);
		const original = await readFile(lockedPath, "utf8"); await chmod(lockedPath, 0o444);
		const rejected = assert.rejects(pending, /storage|unknown|persist|journal|write/i); release.resolve(); await rejected;
		assert.equal(await readFile(lockedPath, "utf8"), original, "unknown completion does not append a fabricated completion or refund");
		const otherHost = await second.start(policy(second.endpoint, c)); await seed(otherHost);
		assert.equal((await setup(otherHost).job("healthy-other-source").converse(request("OTHER SOURCE"))).status, "completed");
		const state = await c.snapshot(); assert.equal(state.status, "open");
		assert.equal(state.conversations.find(row => row.jobId === failed.id)!.status, "quarantined");
		assert.equal(state.conversations.find(row => row.jobId === failed.id)!.sealed, true);
		assert.equal(first.requests.filter(p => p.model === "summary-model").length, 1);
		await writeFile(join(first.root, "conversation-observation.json"), JSON.stringify({ state, attempt, original }, null, 2));
		await c.close(); c = await container(first.root);
		assert.deepEqual(await c.snapshot(), state, "reopen preserves the actual source-local unknown diagnostic, counts and seal");
		assert.equal(first.requests.filter(p => p.model === "summary-model").length, 1, "quarantined source work is not replayed");
	} finally { release.resolve(); await pending?.catch(() => {}); if (lockedPath) await chmod(lockedPath, 0o666); await first.close(); await second.close(); await c.close(); }
});

test("genuine shared Compresser storage uncertainty refuses every source without another provider dispatch", async () => {
	const entered = deferred(), release = deferred();
	const first = await fixture({}, async p => { if (p.model !== "summary-model") return { text: "MAIN" }; entered.resolve(); await release.promise; return complete(); });
	const second = await fixture({}, p => p.model === "summary-model" ? complete() : { text: "MAIN" });
	const c = await container(first.root), lockedPaths: string[] = [];
	let pending: Promise<api.InferenceResult> | undefined;
	try {
		const a = await first.start(policy(first.endpoint, c)), b = await second.start(policy(second.endpoint, c));
		await seed(a); await seed(b);
		const original = setup(a), sibling = setup(b);
		pending = original.job("shared-storage-unknown").converse(request("SHARED-STORAGE")); await entered.promise;
		async function lockLogs(directory: string): Promise<void> {
			for (const entry of await readdir(directory, { withFileTypes: true })) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) await lockLogs(path);
				else if (entry.name.endsWith(".jsonl")) { await chmod(path, 0o444); lockedPaths.push(path); }
			}
		}
		await lockLogs(join(first.root, "compresser")); assert.ok(lockedPaths.length);
		const rejected = assert.rejects(pending, /unknown|storage|persist|commit|transaction|write|access|EACCES|EPERM|EIO/i);
		release.resolve(); await rejected;
		const count = second.requests.length;
		await assert.rejects(sibling.job("refused-after-shared-fault").converse(request("HEALTHY OTHER SOURCE")), /Compresser.*unavailable|internal fault/i);
		assert.equal(second.requests.length, count, "a healthy source cannot dispatch into an unknown shared storage domain");
		assert.equal(sibling.b.audit().length, 0, "shared-fault admission does not fabricate or spend a provider attempt");
		await writeFile(join(first.root, "shared-fault-observation.json"), JSON.stringify({ lockedPaths, sourceAudit: original.b.audit(), siblingAudit: sibling.b.audit(), siblingRequests: count }, null, 2));
	} finally { release.resolve(); await pending?.catch(() => {}); for (const path of lockedPaths) await chmod(path, 0o666); await first.close(); await second.close(); await c.close().catch(() => {}); }
});

test("aggregate-counter storage rejects implicit migration instead of resetting or inventing per-Conversation counts", async () => {
	const f = await fixture();
	const storageDir = join(f.root, "compresser"); await mkdir(storageDir);
	try {
		const legacy = defineDoc({ kind: "pakka.compresser", version: 1, scope: "session", checkpointWhen: () => true, initial: () => ({ sessionId: "LEGACY-COUNTER-SCOPE", status: "open", toolCallingTolerance: 2, unresolvedErrorTolerance: 2, toolErrors: 1, unresolvedErrors: 1, lastError: null, conversations: {}, incidents: { "unattributed-incident": true } }) });
		const harness = await Harness.open(await openNodeJsonlStorage(storageDir, BACKGROUND_CONTEXT, { fsync: true }), { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
		await harness.commit(async tx => { await tx.doc(legacy); }, BACKGROUND_CONTEXT); await harness.close(BACKGROUND_CONTEXT);
		await assert.rejects(async () => { const reopened = await container(f.root); await reopened.close(); }, /migration|version|scope/i);
		assert.equal(f.requests.length, 0);
	} finally { await f.close(); }
});

test("normal reopen preserves the sealed child but admits a fresh independently authorized Conversation", async () => {
	const f = await fixture({}, p => p.model !== "summary-model" ? { text: "MAIN" } : text(p).includes("BAD") ? { tool: "submit_candidate", args: {} } : complete());
	let c = await container(f.root, 1, 2);
	try {
		const host = await f.start(policy(f.endpoint, c)); await seed(host);
		const bad = setup(host).job("bad"); await bad.converse(request("BAD"));
		const state = await c.snapshot(), count = f.requests.length;
		await host.dispose(); await c.close(); c = await container(f.root, 1, 2);
		assert.deepEqual(await c.snapshot(), state); assert.equal(f.requests.length, count);
		const freshHost = await f.start(policy(f.endpoint, c)); await seed(freshHost);
		assert.equal((await setup(freshHost).job("fresh").converse(request("GOOD"))).status, "completed");
		assert.equal(f.requests.filter(p => p.model === "summary-model").length, 2);
		const after = await c.snapshot();
		assert.equal(after.status, "open"); assert.equal(after.conversations.find(row => row.jobId === bad.id)!.sealed, true);
	} finally { await f.close(); await c.close(); }
});
