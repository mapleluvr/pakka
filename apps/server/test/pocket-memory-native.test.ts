import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketMemory } from "../src/pocket-memory.ts";

const options = {
	namespace: "native.memory",
	profiles: ["default"],
	projects: [{ id: "project", name: "Project", resources: "*" as const }],
};

test(
	"Pocket memory native tool: a real model invocation creates only an attributed proposal until a human owner approves it",
	{ timeout: 15000 },
	async () => {
		const prepared = createPocketMemory(options),
			m = await runtimeFixture(
				{ tools: prepared.tools, contextSources: [prepared.source] },
				undefined,
				(_payload, n) =>
					n === 1
						? {
								tool: "memory",
								args: {
									action: "add",
									requestId: "native-lesson",
									scope: "project",
									text: "MODEL-PROPOSED-LESSON-CANARY",
								},
							}
						: { text: "LOCAL-ANSWER" },
			);
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "native.people" }),
				owner = await people.authenticate((await people.initializeOwner("Owner")).token),
				service = await prepared.attach({ runtime: m.runtime, people }),
				ref = m.runtime.view().conversations[0]!;
			const host = m.runtime.root();
			await host.connect("operator", ["input.submit"]).submit({ key: "tool", text: "PROPOSE-ONE-LESSON" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			const pending = (await service.bind(owner, ref).read()).lessons[0]!;
			assert.equal(pending.pending, true);
			assert.equal(pending.byAgent, true);
			assert.equal(pending.authorName, "Agent");
			const content = m.f.requests[1]!.messages.find((message) => message.role === "tool")?.content;
			assert.ok(typeof content === "string");
			const toolResult: unknown = JSON.parse(content);
			assert.ok(
				toolResult && typeof toolResult === "object" && !Array.isArray(toolResult) && "lesson" in toolResult,
			);
			const lesson = toolResult.lesson;
			assert.ok(lesson && typeof lesson === "object" && !Array.isArray(lesson) && "pending" in lesson);
			assert.equal(lesson.pending, true);
			assert.ok(
				!JSON.stringify(m.f.requests[1]!.messages.filter((message) => message.role === "system")).includes(
					"MODEL-PROPOSED-LESSON-CANARY",
				),
			);
			const other = await m.runtime.createConversation({ key: "another-conversation", profile: "default" }),
				otherHost = await m.runtime.conversation(other),
				client = otherHost.connect("operator", ["input.submit"]);
			await client.submit({ key: "before-approval", text: "OTHER-BEFORE-APPROVAL" });
			await otherHost.waitForIdle();
			assert.ok(!JSON.stringify(m.f.requests[2]).includes("MODEL-PROPOSED-LESSON-CANARY"));
			await service.bind(owner, ref).change({
				requestId: "approve-native",
				id: pending.id,
				expectedVersion: pending.version,
				action: "approve",
			});
			await client.submit({ key: "after-approval", text: "OTHER-AFTER-APPROVAL" });
			await otherHost.waitForIdle();
			assert.ok(JSON.stringify(m.f.requests[3]).includes("MODEL-PROPOSED-LESSON-CANARY"));
			assert.equal(m.runtime.view().budget.primaryAttempts, 4);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await m.close();
		}
	},
);

test(
	"Pocket memory native authority: forged invocation scopes cannot create a proposal or select a human owner",
	{ timeout: 10000 },
	async () => {
		const prepared = createPocketMemory(options),
			m = await runtimeFixture({ tools: prepared.tools, contextSources: [prepared.source] });
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "native.people" }),
				owner = await people.authenticate((await people.initializeOwner("Owner")).token),
				service = await prepared.attach({ runtime: m.runtime, people }),
				ref = m.runtime.view().conversations[0]!;
			const tool = prepared.tools[0]!;
			await assert.rejects(
				async () =>
					Reflect.apply(tool.execute, tool, [
						{ action: "add", requestId: "forged", scope: "project", text: "FORGED-MODEL-INSTRUCTIONS" },
						undefined,
						{},
					]),
				/invocation|scope|denied/i,
			);
			assert.equal((await service.bind(owner, ref).read()).lessons.length, 0);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);

test(
	"Pocket memory facet isolation: human-only assembly neither advertises a memory tool nor injects approved lessons into actual model input",
	{ timeout: 10000 },
	async () => {
		const prepared = createPocketMemory(options),
			m = await runtimeFixture();
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "native.people" }),
				owner = await people.authenticate((await people.initializeOwner("Owner")).token),
				service = await prepared.attach({ runtime: m.runtime, people }),
				ref = m.runtime.view().conversations[0]!;
			await service
				.bind(owner, ref)
				.add({ requestId: "human-only", scope: "project", text: "HUMAN-ONLY-MEMORY-CANARY" });
			const host = m.runtime.root();
			await host.connect("operator", ["input.submit"]).submit({ key: "human-only", text: "NO-AGENT-FACET" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.ok(!JSON.stringify(m.f.requests[0]).includes("HUMAN-ONLY-MEMORY-CANARY"));
			assert.ok(!JSON.stringify(m.f.requests[0]?.tools ?? []).includes('"name":"memory"'));
		} finally {
			await m.close();
		}
	},
);
