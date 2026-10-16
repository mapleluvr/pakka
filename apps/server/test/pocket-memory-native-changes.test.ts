import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketMemory } from "../src/pocket-memory.ts";

test(
	"Pocket memory native changes: repeated updates are idempotent and a model cannot replace or forget approved context before human approval",
	{ timeout: 15000 },
	async () => {
		let lessonId = "",
			version = 1;
		const prepared = createPocketMemory({
				namespace: "native.changes",
				profiles: ["default"],
				projects: [{ id: "all", name: "Project", resources: "*" }],
			}),
			m = await runtimeFixture(
				{ tools: prepared.tools, contextSources: [prepared.source] },
				undefined,
				(_payload, n) => {
					if (n === 1 || n === 3)
						return {
							tool: "memory",
							args: {
								action: "update",
								requestId: "same-native-update",
								id: lessonId,
								expectedVersion: 1,
								text: "NEW-MODEL-LESSON",
							},
						};
					if (n === 5)
						return {
							tool: "memory",
							args: { action: "remove", requestId: "native-remove", id: lessonId, expectedVersion: version },
						};
					return { text: "LOCAL-ANSWER" };
				},
			);
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "native.people" }),
				owner = await people.authenticate((await people.initializeOwner("Owner")).token),
				service = await prepared.attach({ runtime: m.runtime, people }),
				ref = m.runtime.view().conversations[0]!,
				memory = service.bind(owner, ref);
			const original = await memory.add({
				requestId: "original",
				scope: "project",
				text: "ORIGINAL-HUMAN-LESSON",
			});
			assert.ok(original.lesson);
			lessonId = original.lesson.id;
			const host = m.runtime.root(),
				client = host.connect("operator", ["input.submit"]);
			await client.submit({ key: "update", text: "PROPOSE-UPDATE" });
			await host.waitForIdle();
			const proposed = (await memory.read()).lessons[0]!;
			assert.equal(proposed.text, "ORIGINAL-HUMAN-LESSON");
			assert.equal(proposed.proposal?.text, "NEW-MODEL-LESSON");
			assert.equal(proposed.proposal?.byAgent, true);
			const system = (n: number) =>
				JSON.stringify(m.f.requests[n]!.messages.filter((message) => message.role === "system"));
			assert.ok(system(1).includes("ORIGINAL-HUMAN-LESSON"));
			assert.ok(!system(1).includes("NEW-MODEL-LESSON"));
			await client.submit({ key: "repeat-update", text: "REPEAT-ORIGINAL-UPDATE" });
			await host.waitForIdle();
			assert.equal((await memory.read()).lessons[0]!.version, proposed.version);
			const changed = await memory.change({
				requestId: "approve-edit",
				id: lessonId,
				expectedVersion: proposed.version,
				action: "approve",
			});
			assert.ok(changed.lesson);
			version = changed.lesson.version;
			await client.submit({ key: "remove", text: "PROPOSE-FORGET" });
			await host.waitForIdle();
			const removal = (await memory.read()).lessons[0]!;
			assert.equal(removal.proposal?.text, null);
			assert.equal(removal.text, "NEW-MODEL-LESSON");
			assert.ok(system(5).includes("NEW-MODEL-LESSON"));
			await memory.change({
				requestId: "approve-remove",
				id: lessonId,
				expectedVersion: removal.version,
				action: "approve",
			});
			assert.equal((await memory.read()).lessons.length, 0);
			await client.submit({ key: "after-remove", text: "AFTER-APPROVED-REMOVAL" });
			await host.waitForIdle();
			assert.ok(!system(6).includes("NEW-MODEL-LESSON"));
			assert.equal(m.f.requests.length, 7);
			assert.equal(m.runtime.view().budget.primaryAttempts, 7);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await m.close();
		}
	},
);
