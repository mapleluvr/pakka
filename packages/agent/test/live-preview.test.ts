import { test } from "node:test";
import { strict as assert } from "node:assert";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, LiveDoc, type ConversationId, type LiveState } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

const allow = () => {};
const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
async function liveFixture(state: LiveState) {
	const m = await runtimeFixture({ observation: "lazy" });
	const ref = m.runtime.view().conversations[0]!;
	const file = m.runtime.root().view().sessionFile;
	try {
		await m.runtime.close();
		// A passive, native committed presentation fixture: no model or executable task is created.
		const session = createSession(await openNodeSqliteStorage(file));
		try {
			await session.commit(async (tx) => {
				const live = await tx.doc(LiveDoc, Number(ref.conversationId) as ConversationId);
				Object.assign(live, state);
			}, BACKGROUND_CONTEXT);
		} finally {
			await session.close(BACKGROUND_CONTEXT);
		}
		const runtime = await createRuntime({ ...m.config, reopenSessionFile: file });
		return {
			runtime,
			ref,
			m,
			close: async () => {
				await runtime.close();
				await m.close();
			},
		};
	} catch (error) {
		await m.close();
		throw error;
	}
}

const specimens: { name: string; arguments: Record<string, string | string[]>; needle: string }[] = [
	{
		name: "large string",
		arguments: { content: "ARG-FIRST\n" + "x".repeat(768 * 1024) + "ARG-LAST" },
		needle: "ARG-FIRST",
	},
	{
		name: "wide collection",
		arguments: { rows: Array.from({ length: 12000 }, (_, at) => "ROW-" + at + "-" + "y".repeat(64)) },
		needle: "ROW-0-",
	},
];
for (const specimen of specimens) {
	test(
		"Live preview: " + specimen.name + " arguments stay bounded while retaining the call identity",
		async () => {
			const f = await liveFixture({
				generation: {
					attempt: 1,
					message: {
						role: "assistant",
						api: "openai-completions",
						provider: "local",
						model: "local-model",
						timestamp: 1,
						stopReason: "toolUse",
						usage,
						content: [
							{ type: "toolCall", id: "large-live-call", name: "write", arguments: specimen.arguments },
						],
					},
				},
			});
			try {
				const snapshot = await f.runtime.previewConversation(f.ref, allow);
				assert.ok(
					Buffer.byteLength(JSON.stringify(snapshot)) <= 16 * 1024,
					"an in-flight body must not fill the hot page",
				);
				const part = snapshot.live.message?.content[0];
				assert.ok(part && typeof part === "object" && !Array.isArray(part));
				assert.equal(part.type, "toolCall");
				assert.equal(part.id, "large-live-call");
				assert.equal(part.name, "write");
				const args = JSON.stringify(part.arguments);
				assert.ok(args.includes(specimen.needle));
				assert.ok(/preview/i.test(args), "a clipped in-flight body must identify itself as a preview");
				if (specimen.name === "large string") assert.ok(args.includes("ARG-LAST"));
				assert.equal(f.runtime.root().view().historyLoaded, false);
				assert.equal(f.m.f.requests.length, 0);
			} finally {
				await f.close();
			}
		},
	);
}

test("Live preview: small arguments retain their actual values", async () => {
	const f = await liveFixture({
		generation: {
			attempt: 1,
			message: {
				role: "assistant",
				api: "openai-completions",
				provider: "local",
				model: "local-model",
				timestamp: 1,
				stopReason: "toolUse",
				usage,
				content: [
					{
						type: "toolCall",
						id: "small-call",
						name: "read",
						arguments: { path: "README.md", offset: 2, enabled: false, options: [null, "small"] },
					},
				],
			},
		},
	});
	try {
		const snapshot = await f.runtime.previewConversation(f.ref, allow);
		const part = snapshot.live.message?.content[0];
		assert.ok(part && typeof part === "object" && !Array.isArray(part));
		assert.deepEqual(part.arguments, {
			path: "README.md",
			offset: 2,
			enabled: false,
			options: [null, "small"],
		});
	} finally {
		await f.close();
	}
});

test("Live preview: provider errors have bounded first/last text", async () => {
	const f = await liveFixture({
		generation: {
			attempt: 1,
			message: {
				role: "assistant",
				api: "openai-completions",
				provider: "local",
				model: "local-model",
				timestamp: 1,
				stopReason: "error",
				usage,
				content: [],
				errorMessage: "ERROR-FIRST\n" + "z".repeat(768 * 1024) + "ERROR-LAST",
			},
		},
	});
	try {
		const snapshot = await f.runtime.previewConversation(f.ref, allow);
		assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 16 * 1024);
		assert.ok(snapshot.live.message?.errorMessage?.startsWith("ERROR-FIRST"));
		assert.ok(snapshot.live.message?.errorMessage?.includes("ERROR-LAST"));
		assert.equal(snapshot.live.message?.stopReason, "error");
	} finally {
		await f.close();
	}
});

test("Live preview: native capture omissions remain distinct from a display preview", async () => {
	const f = await liveFixture({
		tools: [
			{
				callId: "captured-call",
				name: "command",
				status: "running",
				output: "RETAINED-OUTPUT",
				droppedBytes: 1234,
				droppedLines: 7,
			},
		],
	});
	try {
		const snapshot = await f.runtime.previewConversation(f.ref, allow);
		const tool = snapshot.live.tools[0];
		assert.ok(tool);
		assert.equal(tool.output, "RETAINED-OUTPUT");
		assert.equal(Reflect.get(tool, "droppedBytes"), 1234);
		assert.equal(Reflect.get(tool, "droppedLines"), 7);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.close();
	}
});
