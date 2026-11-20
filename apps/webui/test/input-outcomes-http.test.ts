import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { ConversationRef, Receipt } from "@pakka/agent";
import type { PocketConversationSource } from "@pakka/server/pocket";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { loginHttpSession } from "./fixtures/http-session.ts";
type Fixture = Awaited<ReturnType<typeof runtimeFixture>>;
type Product = Awaited<ReturnType<typeof startPocket>>;

// Release/webui heavy: preserve native outcome distinctions through real HTTP and production decoding.
test("Input outcomes HTTP: policy-blocked input retains its reason and spends no Provider request", async () => {
	const m = await runtimeFixture();
	await m.runtime.close();
	let app: Product | undefined;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "blocked") },
			owner: "Owner",
			initial: [{ name: "Policy", profile: "default" }],
		});
		assert.ok(app.initialOwner);
		const owner = await loginHttpSession(app.http.origin, app.initialOwner.token);
		const target = app.runtime.view().conversations.find((ref) => ref.key !== "root")!;
		const host = await app.runtime.conversation(target),
			policy = host.connect("policy-owner", ["real_context.write"]);
		policy.activateStrategy({ id: "policy", hooks: ["real_context.write"] });
		policy
			.bindStrategy("policy")
			.installProjector((frame) => ({ status: "blocked", basis: frame.basis, reason: "policy refused" }));
		const sent = await owner.workbench({
			op: "submit",
			target,
			input: { requestId: "blocked", text: "REFUSE-THIS", mode: "prompt" },
		});
		assert.equal(sent.response.status, 200);
		assert.ok("result" in sent.decoded && sent.decoded.result.kind === "receipt");
		const done = await owner.workbench({ op: "wait", id: sent.decoded.result.receipt.id });
		assert.ok("result" in done.decoded && done.decoded.result.kind === "receipt");
		assert.equal(done.decoded.result.receipt.status, "unanswered");
		assert.equal(done.decoded.result.receipt.reason, "blocked");
		const observed = await owner.workbench({ op: "receipt", id: sent.decoded.result.receipt.id });
		assert.ok("result" in observed.decoded && observed.decoded.result.kind === "receipt");
		assert.deepEqual(observed.decoded.result.receipt, done.decoded.result.receipt);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.f.close();
	}
});

test("Input outcomes HTTP: native Host uncertainty remains unknown through a registered source and observation", async () => {
	const m = await runtimeFixture({
		prepareInput: async ({ text }) => {
			if (text === "UNKNOWN-RESULT") throw Error("TEST PRE-ADMISSION OUTCOME UNKNOWN");
			return { action: "text", text };
		},
	});
	await m.runtime.close();
	let app: Product | undefined;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "unknown") },
			owner: "Owner",
			extensionServices: ({ runtime }) => ({
				unknown: {
					permission: "read",
					conversations: hostSource(runtime.root(), runtime.view().conversations[0]!),
					bind: () => Object.freeze({}),
				},
			}),
		});
		assert.ok(app.initialOwner);
		const owner = await loginHttpSession(app.http.origin, app.initialOwner.token);
		const target = app.runtime.view().conversations[0]!;
		const sent = await owner.workbench({
			op: "submit",
			target,
			input: { requestId: "unknown", text: "UNKNOWN-RESULT", mode: "prompt" },
		});
		assert.equal(sent.response.status, 200);
		assert.ok("result" in sent.decoded && sent.decoded.result.kind === "receipt");
		assert.equal(sent.decoded.result.receipt.status, "unknown");
		const observed = await owner.workbench({ op: "receipt", id: sent.decoded.result.receipt.id });
		assert.ok("result" in observed.decoded && observed.decoded.result.kind === "receipt");
		assert.deepEqual(observed.decoded.result.receipt, sent.decoded.result.receipt);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.f.close();
	}
});

test("Input outcomes HTTP: queued withdrawal is unanswered/aborted while original work finishes once", async (t) => {
	const gate = deferred();
	const m = await runtimeFixture({}, undefined, async () => {
		await gate.promise;
		return { text: "FINISHED" };
	});
	await m.runtime.close();
	let app: Product | undefined;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "withdraw") },
			owner: "Owner",
			initial: [{ name: "Withdraw", profile: "default" }],
		});
		assert.ok(app.initialOwner);
		const owner = await loginHttpSession(app.http.origin, app.initialOwner.token);
		const target = app.runtime.view().conversations.find((ref) => ref.key !== "root")!;
		const first = await owner.workbench({
			op: "submit",
			target,
			input: { requestId: "hold", text: "HOLD-THE-TURN", mode: "prompt" },
		});
		assert.ok("result" in first.decoded && first.decoded.result.kind === "receipt");
		await t.waitFor(() => assert.equal(m.f.requests.length, 1), { timeout: 5000 });
		const second = await owner.workbench({
			op: "submit",
			target,
			input: { requestId: "withdraw", text: "WITHDRAW-THIS", mode: "steer" },
		});
		assert.ok("result" in second.decoded && second.decoded.result.kind === "receipt");
		assert.equal(second.decoded.result.receipt.status, "queued");
		const withdrawn = await owner.workbench({ op: "withdraw", id: second.decoded.result.receipt.id });
		assert.ok("result" in withdrawn.decoded && withdrawn.decoded.result.kind === "receipt");
		assert.equal(withdrawn.decoded.result.receipt.status, "unanswered");
		assert.equal(withdrawn.decoded.result.receipt.reason, "aborted");
		gate.resolve();
		const done = await owner.workbench({ op: "wait", id: first.decoded.result.receipt.id });
		assert.ok("result" in done.decoded && done.decoded.result.kind === "receipt");
		assert.equal(done.decoded.result.receipt.status, "done");
		assert.equal(m.f.requests.length, 1);
		assert.doesNotMatch(JSON.stringify(m.f.requests), /WITHDRAW-THIS/);
	} finally {
		gate.resolve();
		await app?.close();
		await m.f.close();
	}
});

// The source adapts a real public Host receipt; no HTTP/receipt DTO is fabricated.
function hostSource(
	host: ReturnType<Fixture["runtime"]["root"]>,
	ref: ConversationRef,
): PocketConversationSource {
	const receipts = new Map<string, Receipt>();
	let client: ReturnType<ReturnType<Fixture["runtime"]["root"]>["connect"]> | undefined;
	const dto = (receipt: Receipt) => ({
		id: receipt.id,
		requestId: receipt.key,
		actorId: receipt.principal,
		target: ref,
		status:
			receipt.state === "committed" || receipt.state === "handled"
				? ("done" as const)
				: receipt.state === "released"
					? ("unanswered" as const)
					: receipt.state === "unknown"
						? ("unknown" as const)
						: ("placed" as const),
		...(receipt.reason ? { reason: receipt.reason } : {}),
	});
	return {
		bind(actor) {
			client ??= host.connect(actor.person.id, ["input.submit"]);
			const connected = client;
			const original = connected.receipt;
			return {
				navigation: async () => {
					actor.check("read", ref.conversationId);
					return [{ ref, name: "Host source", version: 0, archived: false }];
				},
				canManage: () => false,
				ownsReceipt: async (id) => receipts.has(id),
				configure: async () => {
					throw new Error("This source is read-only for the test");
				},
				configureAgent: async () => {
					throw new Error("This source is read-only for the test");
				},
				submit: async (_target, input) => {
					actor.check("send", ref.conversationId);
					const unsubscribe = host.subscribe((event) => {
						if (event.type === "receipt" && event.receipt.key === input.requestId)
							receipts.set(event.receipt.id, event.receipt);
					});
					try {
						const submitted = await connected.submit({
							key: input.requestId,
							text: input.text,
							mode: input.mode,
						});
						receipts.set(submitted.id, submitted);
					} catch (error) {
						const receipt = [...receipts.values()].find((row) => row.key === input.requestId);
						if (receipt?.state === "unknown") return dto(receipt);
						throw error;
					} finally {
						unsubscribe();
					}
					const receipt = [...receipts.values()].find((row) => row.key === input.requestId);
					if (receipt?.state === "unknown") return dto(receipt);
					throw new Error("The controlled source did not produce an unknown receipt");
				},
				receipt: async (id) => {
					const receipt = receipts.get(id) ?? original(id);
					if (!receipt) throw new Error("Unknown source receipt");
					return dto(receipt);
				},
				wait: async (id) => {
					const receipt = receipts.get(id) ?? original(id);
					if (!receipt) throw new Error("Unknown source receipt");
					return dto(receipt);
				},
				withdraw: async (id) => {
					const receipt = receipts.get(id) ?? original(id);
					if (!receipt) throw new Error("Unknown source receipt");
					return dto(receipt);
				},
				abort: async () => {
					throw new Error("This source does not offer abort in the test");
				},
			};
		},
	};
}
