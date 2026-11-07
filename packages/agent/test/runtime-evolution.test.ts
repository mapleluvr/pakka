import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime, type Runtime } from "../src/index.ts";
import { runtimeFixture, runtimeLimits } from "./runtime-fixture.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { blockSqliteWrites, readNativeDocument } from "./native-storage.ts";

const allow = () => {};

// Controlled stored-schema fixture, not an assertion that a historical binary was run.
async function legacyPolicyFixture(file: string, version: 1 | 2): Promise<void> {
	const storage = await openNodeSqliteStorage(file);
	try {
		const runtime = await storage.findDocument(
			{ scope: { kind: "session" }, kind: "pakka.runtime" },
			"current",
			BACKGROUND_CONTEXT,
		);
		const policy = await storage.findDocument(
			{ scope: { kind: "session" }, kind: "pakka.budget-policy" },
			"current",
			BACKGROUND_CONTEXT,
		);
		assert.ok(runtime);
		assert.ok(policy);
		const document = await storage.document(runtime.id, "current", BACKGROUND_CONTEXT);
		assert.ok(document);
		const value = structuredClone(document.value);
		delete value.policyVersion;
		if (version === 1) delete value.strategyAttempts;
		await storage.commit(
			[
				{ type: "document.retire", id: policy.id },
				{ type: "document.change", id: runtime.id, content: { kind: "base", version, value } },
			],
			BACKGROUND_CONTEXT,
		);
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
}

for (const version of [1, 2] as const)
	test(`Runtime budget: stored schema v${version} upgrades with preserved identity and spending`, async () => {
		const m = await runtimeFixture();
		let reopened: Runtime | undefined;
		try {
			await m.runtime
				.root()
				.connect("user", ["input.submit"])
				.submit({ key: "seed", text: "PRE-UPGRADE CALL" });
			await m.runtime.waitForIdle();
			const before = m.runtime.view();
			await m.runtime.close();
			await legacyPolicyFixture(before.sessionFile, version);
			assert.equal((await readNativeDocument(before.sessionFile, "pakka.runtime")).version, version);
			await assert.doesNotReject(async () => {
				reopened = await createRuntime({ ...m.config, reopenSessionFile: before.sessionFile });
			});
			assert.ok(reopened);
			assert.deepEqual(reopened.view().conversations, before.conversations);
			assert.deepEqual(reopened.view().budget, { primaryAttempts: 1, auxiliaryAttempts: 0 });
			assert.deepEqual(await reopened.budgetPolicy(allow), {
				version: 0,
				limits: runtimeLimits,
				budget: before.budget,
				conversationCount: 1,
			});
			assert.equal((await readNativeDocument(before.sessionFile, "pakka.runtime")).version, 3);
			assert.equal(m.f.requests.length, 1);
		} finally {
			await reopened?.close();
			await m.close();
		}
	});

test("Runtime budget: missing declared policy cannot be mistaken for a legacy upgrade", async () => {
	const m = await runtimeFixture();
	try {
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		const storage = await openNodeSqliteStorage(file);
		try {
			const policy = await storage.findDocument(
				{ scope: { kind: "session" }, kind: "pakka.budget-policy" },
				"current",
				BACKGROUND_CONTEXT,
			);
			assert.ok(policy);
			await storage.commit([{ type: "document.retire", id: policy.id }], BACKGROUND_CONTEXT);
		} finally {
			await storage.close(BACKGROUND_CONTEXT);
		}
		await assert.rejects(createRuntime({ ...m.config, reopenSessionFile: file }), /policy.*unavailable/i);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// An exact whole-profile equality gate would reject this harmless extension.
test("Runtime evolution: additional profiles preserve existing identities and cannot replace old definitions", async () => {
	const m = await runtimeFixture();
	let reopened: Runtime | undefined;
	try {
		const before = m.runtime.view();
		await m.runtime.close();
		const profiles = [{ id: "research", systemPrompt: "READ-ONLY RESEARCH" }];
		await assert.doesNotReject(async () => {
			reopened = await createRuntime({ ...m.config, profiles, reopenSessionFile: before.sessionFile });
		});
		assert.ok(reopened);
		assert.deepEqual(reopened.view().conversations, before.conversations);
		assert.equal(reopened.view().sessionId, before.sessionId);
		const peer = await reopened.createConversation({ key: "research-peer", profile: "research" });
		assert.equal(peer.profile, "research");
		const history = await reopened.budgetHistory({}, allow);
		assert.equal(history.items.length, 1);
		assert.equal(history.items[0]?.source, "bootstrap");
		assert.deepEqual(history.items[0]?.addedProfiles, ["research"]);
		await reopened.close();
		reopened = undefined;
		await assert.rejects(
			createRuntime({
				...m.config,
				profiles: [{ id: "research", systemPrompt: "DIFFERENT CAPABILITY" }],
				reopenSessionFile: before.sessionFile,
			}),
			/profile|mismatch|migration/i,
		);
		reopened = await createRuntime({ ...m.config, profiles, reopenSessionFile: before.sessionFile });
		assert.ok(reopened.view().conversations.some((ref) => ref.conversationId === peer.conversationId));
		assert.equal((await reopened.budgetHistory({}, allow)).items.length, 1);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

// An in-memory-only policy or reapplying initial limits on every restart loses this change.
test("Runtime budget: owner top-up preserves spending, exact receipts and the same storage across reopen", async () => {
	const initial = { ...runtimeLimits, maxPrimaryAttempts: 1 };
	const m = await runtimeFixture({}, initial);
	let reopened: Runtime | undefined;
	try {
		const runtime = m.runtime,
			user = runtime.root().connect("user", ["input.submit"]);
		await user.submit({ key: "one", text: "ONE LOCAL CALL" });
		await runtime.waitForIdle();
		assert.equal(runtime.view().budget.primaryAttempts, 1);
		const before = await runtime.budgetPolicy(allow);
		const request = {
			actorId: "owner",
			requestId: "top-up",
			expectedVersion: before.version,
			limits: { ...initial, maxPrimaryAttempts: 2 },
			reason: "Continue this workspace",
		};
		const receipt = await runtime.changeBudget(request, allow);
		assert.equal(receipt.source, "management");
		assert.equal(receipt.version, 1);
		assert.deepEqual(receipt.before, initial);
		assert.deepEqual(receipt.after, request.limits);
		assert.equal(receipt.budget.primaryAttempts, 1);
		assert.deepEqual(await runtime.changeBudget(request, allow), receipt);
		assert.equal(Object.isFrozen(receipt.after), true);
		await assert.rejects(
			runtime.changeBudget({ ...request, reason: "Different original" }, allow),
			/conflict/i,
		);
		await user.submit({ key: "two", text: "SECOND LOCAL CALL" });
		await runtime.waitForIdle();
		assert.equal(m.f.requests.length, 2);
		const file = runtime.view().sessionFile,
			identities = runtime.view().conversations;
		await runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.equal(
			reopened.view().limits.maxPrimaryAttempts,
			2,
			"the old startup default is not a new policy action",
		);
		assert.equal(reopened.view().budget.primaryAttempts, 2);
		assert.deepEqual(reopened.view().conversations, identities);
		assert.deepEqual(await reopened.budgetReceipt({ actorId: "owner", requestId: "top-up" }, allow), receipt);
		assert.deepEqual(await reopened.changeBudget(request, allow), receipt);
		assert.equal(m.f.requests.length, 2, "reopening and receipt lookup must not replay generation");
		await reopened.close();
		reopened = await createRuntime({
			...m.config,
			limits: { ...initial, maxPrimaryAttempts: 3 },
			reopenSessionFile: file,
		});
		assert.equal(reopened.view().limits.maxPrimaryAttempts, 3);
		assert.equal(reopened.view().budget.primaryAttempts, 2);
		const newest = await reopened.budgetHistory({ limit: 1 }, allow);
		assert.equal(newest.items[0]?.source, "bootstrap");
		assert.equal(newest.items[0]?.before.maxPrimaryAttempts, 2);
		assert.equal(newest.items[0]?.after.maxPrimaryAttempts, 3);
		const older = await reopened.budgetHistory({ beforeVersion: newest.nextBeforeVersion, limit: 1 }, allow);
		assert.deepEqual(older.items, [receipt]);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("Runtime budget: lower ceilings block only new reservations, and stale or unauthorized changes do not commit", async () => {
	const m = await runtimeFixture();
	try {
		const runtime = m.runtime,
			user = runtime.root().connect("user", ["input.submit"]);
		for (const key of ["a", "b"]) {
			await user.submit({ key, text: key });
			await runtime.waitForIdle();
		}
		const proposal = {
			actorId: "owner",
			requestId: "lower",
			expectedVersion: 0,
			limits: { ...runtimeLimits, maxPrimaryAttempts: 1 },
			reason: "Pause future spending",
		};
		await assert.rejects(
			runtime.changeBudget(proposal, () => {
				throw Error("revoked");
			}),
			/denied|revoked/i,
		);
		assert.equal(await runtime.budgetReceipt({ actorId: "owner", requestId: "lower" }, allow), null);
		await runtime.changeBudget(proposal, allow);
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		await assert.rejects(
			runtime.changeBudget({ ...proposal, requestId: "stale" }, allow),
			/version|conflict/i,
		);
		await user.submit({ key: "blocked", text: "NO NEW CALL" });
		await runtime.waitForIdle();
		assert.equal(m.f.requests.length, 2);
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		assert.equal(runtime.view().phase, "ready");
		await runtime.changeBudget(
			{
				...proposal,
				requestId: "resume",
				expectedVersion: 1,
				limits: { ...runtimeLimits, maxPrimaryAttempts: 3 },
			},
			allow,
		);
		await user.submit({ key: "new-after-top-up", text: "NEW EXPLICIT INPUT" });
		await runtime.waitForIdle();
		assert.equal(m.f.requests.length, 3);
		assert.equal(runtime.view().budget.primaryAttempts, 3);
		await assert.rejects(
			runtime.budgetHistory({}, () => {
				throw Error("revoked");
			}),
			/denied|revoked/i,
		);
		for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
			await assert.rejects(
				runtime.changeBudget(
					{
						...proposal,
						requestId: "invalid",
						expectedVersion: 2,
						limits: { ...runtimeLimits, maxPrimaryAttempts: limit },
					},
					allow,
				),
				/invalid/i,
			);
		assert.equal((await runtime.budgetPolicy(allow)).version, 2);
	} finally {
		await m.close();
	}
});

// A policy-side write outside Native Tx would leave a raised quota without its audit.
test("Runtime budget: unknown SQLite writes seal the Session and leave neither a partial raise nor a false receipt", async () => {
	const m = await runtimeFixture();
	let release: (() => void) | undefined, reopened: Runtime | undefined;
	try {
		const request = {
			actorId: "owner",
			requestId: "locked",
			expectedVersion: 0,
			limits: { ...runtimeLimits, maxPrimaryAttempts: 999 },
			reason: "Must be atomic",
		};
		const file = m.runtime.view().sessionFile;
		release = blockSqliteWrites(file);
		await assert.rejects(m.runtime.changeBudget(request, allow));
		assert.equal(m.runtime.view().phase, "failed");
		assert.equal(m.runtime.view().limits.maxPrimaryAttempts, runtimeLimits.maxPrimaryAttempts);
		release();
		release = undefined;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.deepEqual(reopened.view().limits, runtimeLimits);
		assert.equal(await reopened.budgetReceipt({ actorId: "owner", requestId: "locked" }, allow), null);
		assert.deepEqual((await reopened.budgetHistory({}, allow)).items, []);
		assert.equal(m.f.requests.length, 0);
	} finally {
		release?.();
		await reopened?.close();
		await m.close();
	}
});
