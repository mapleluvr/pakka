import assert from "node:assert/strict";
import test from "node:test";
import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import * as completions from "@earendil-works/pi-ai/api/openai-completions";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

function models(endpoint: string, second = true) {
	const registry = createModels();
	for (const provider of second ? ["alpha", "beta"] : ["alpha"]) {
		const model: Model<"openai-completions"> = {
			id: "chat",
			provider,
			name: `${provider} chat`,
			api: "openai-completions",
			baseUrl: endpoint,
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 54321,
			maxTokens: 1234,
			cost: { input: 0.2, output: 0.6, cacheRead: 0.1, cacheWrite: 0.2 },
			compat: { maxTokensField: "max_tokens", supportsReasoningEffort: true, thinkingFormat: "openai" },
		};
		registry.setProvider(
			createProvider({
				id: provider,
				models: [model],
				api: { "openai-completions": completions },
				auth: {
					apiKey: { name: provider, resolve: async () => ({ auth: { apiKey: `local-${provider}` } }) },
				},
			}),
		);
	}
	return registry;
}

test("native Models select real provider identity, reasoning and metadata without profile aliases", async () => {
	const m = await runtimeFixture((endpoint) => ({
		models: models(endpoint),
		model: "alpha/chat",
		thinkingLevel: "high",
	}));
	try {
		const choices = await m.runtime.modelChoices();
		const alpha = choices.find((choice) => choice.key === "alpha/chat")!;
		assert.equal(alpha.contextWindow, 54321);
		assert.equal(alpha.maxOutputTokens, 1234);
		assert.equal(alpha.reasoning, true);
		const catalog = m.runtime.catalog({ namespace: "native.models", maxDeliveries: 8, maxPending: 4 });
		const [member] = await catalog.enroll(
			[{ key: "chat", profile: "default", data: { phase: "active" } }],
			() => {},
		);
		await catalog.deliver(
			{
				requestId: "alpha",
				principal: "user",
				source: null,
				target: member!.ref,
				text: "ALPHA",
				mode: "prompt",
			},
			() => {},
		);
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests[0]!.model, "chat");
		assert.equal(m.f.requests[0]!.max_tokens, 1234);
		assert.equal(m.f.requests[0]?.reasoning_effort, "high");
		assert.equal(m.f.authorization[0], "Bearer local-alpha");
		const changed = await catalog.configureAgent(member!.ref, { model: "beta/chat" }, () => {});
		await assert.rejects(
			catalog.deliver(
				{
					requestId: "stale",
					principal: "user",
					source: null,
					target: member!.ref,
					text: "STALE",
					mode: "prompt",
				},
				() => {},
			),
		);
		await catalog.deliver(
			{
				requestId: "beta",
				principal: "user",
				source: null,
				target: changed.ref,
				text: "BETA",
				mode: "prompt",
			},
			() => {},
		);
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 2);
		assert.equal(m.f.authorization[1], "Bearer local-beta");
	} finally {
		await m.close();
	}
});

test("a native Models getter refreshes the catalog and credentials without reopening the Session", async () => {
	let registry = createModels();
	const m = await runtimeFixture((endpoint) => {
		registry = models(endpoint, false);
		return { models: () => registry, model: "alpha/chat" };
	});
	try {
		const sessionId = m.runtime.view().sessionId;
		assert.equal(
			(await m.runtime.modelChoices()).some((choice) => choice.key === "beta/chat"),
			false,
		);
		registry = models(m.f.endpoint);
		assert.equal(
			(await m.runtime.modelChoices()).some((choice) => choice.key === "beta/chat"),
			true,
		);
		await m.runtime.root().connect("user", ["input.submit"]).submit({ key: "fresh", text: "FRESH" });
		await m.runtime.waitForIdle();
		assert.equal(m.f.authorization[0], "Bearer local-alpha");
		assert.equal(m.runtime.view().sessionId, sessionId);
	} finally {
		await m.close();
	}
});

test("an unselected native model permits durable workspace opening and refuses inference without a request", async () => {
	const m = await runtimeFixture({ models: createModels(), model: "" });
	try {
		const root = m.runtime.view().conversations.find((ref) => ref.key === "root")!;
		assert.equal((await m.runtime.configuration(root)).model, "");
		assert.deepEqual(await m.runtime.modelChoices(), []);
		await m.runtime.root().connect("user", ["input.submit"]).submit({ key: "missing", text: "NO-MODEL" });
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 0);
		assert.equal(m.runtime.root().view().phase, "ready");
	} finally {
		await m.close();
	}
});

test("native model selection survives catalog refresh and original storage reopen", async () => {
	const m = await runtimeFixture((endpoint) => ({ models: models(endpoint), model: "alpha/chat" }));
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const before = m.runtime.view();
		const catalog = m.runtime.catalog({ namespace: "native.restore", maxDeliveries: 8, maxPending: 4 });
		const [member] = await catalog.enroll(
			[{ key: "chat", profile: "default", configuration: { model: "beta/chat" }, data: { phase: "active" } }],
			() => {},
		);
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: before.sessionFile });
		assert.equal(reopened.view().sessionId, before.sessionId);
		assert.equal((await reopened.configuration(member!.ref)).model, "beta/chat");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("native model inheritance and fork preserve the registered provider rather than requiring a profile alias", async () => {
	const m = await runtimeFixture((endpoint) => ({ models: models(endpoint), model: "alpha/chat" }));
	const allow = () => {};
	try {
		const catalog = m.runtime.catalog({ namespace: "native.inheritance", maxDeliveries: 8, maxPending: 4 });
		const [source] = await catalog.enroll(
			[{ key: "source", configuration: { model: "beta/chat" }, data: { phase: "active" } }],
			allow,
		);
		assert.ok(source);
		const [child] = await catalog.enroll(
			[{ key: "child", inherit: source.ref, data: { phase: "active" } }],
			allow,
		);
		assert.ok(child);
		assert.equal((await m.runtime.configuration(child.ref)).model, "beta/chat");
		await catalog.deliver(
			{
				requestId: "cut",
				principal: "user",
				source: null,
				target: source.ref,
				text: "FORK CUT",
				mode: "prompt",
			},
			allow,
		);
		await m.runtime.waitForIdle();
		const cutoff = (await m.runtime.readConversation(source.ref, allow)).entries.at(-1)!.id;
		const [fork] = await catalog.enroll(
			[{ key: "fork", fork: { source: source.ref, entryId: cutoff }, data: { phase: "active" } }],
			allow,
		);
		assert.ok(fork);
		assert.equal((await m.runtime.configuration(fork.ref)).model, "beta/chat");
		assert.equal(m.f.requests.length, 1);
	} finally {
		await m.close();
	}
});

test("native thinking is configurable for enrollment and inherited independently of the profile default", async () => {
	const m = await runtimeFixture((endpoint) => ({
		models: models(endpoint),
		model: "alpha/chat",
		thinkingLevel: "off",
	}));
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	const allow = () => {};
	try {
		const catalog = m.runtime.catalog({ namespace: "native.thinking", maxDeliveries: 8, maxPending: 4 });
		const [source] = await catalog.enroll(
			[{ key: "source", configuration: { thinkingLevel: "high" }, data: { phase: "active" } }],
			allow,
		);
		assert.ok(source);
		const [child] = await catalog.enroll(
			[{ key: "child", inherit: source.ref, data: { phase: "active" } }],
			allow,
		);
		assert.ok(child);
		assert.equal((await m.runtime.configuration(child.ref)).thinkingLevel, "high");
		const changed = await catalog.configureAgent(child.ref, { thinkingLevel: "low" }, allow);
		assert.equal((await m.runtime.configuration(changed.ref)).thinkingLevel, "low");
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.equal((await reopened.configuration(changed.ref)).thinkingLevel, "low");
		assert.equal((await reopened.configuration(source.ref)).thinkingLevel, "high");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});
