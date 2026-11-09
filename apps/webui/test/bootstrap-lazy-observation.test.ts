import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, UserEntry, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";

test(
	"WebUI default bootstrap: absent observation configuration keeps root and reopened managed Session cold while their original history remains readable",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			await m.runtime.close();
			assert.equal(
				Object.hasOwn(m.config, "observation"),
				false,
				"this is the normal public product composition, not a lazy-only fixture",
			);
			app = await startPocket({ runtime: m.config, owner: "Owner", initial: [] });
			assert.ok(app.initialOwner);
			const token = app.initialOwner.token;
			const actor = await app.people.authenticate(token),
				client = app.workspace.bind(actor);
			const rootRef = await client.create({
				requestId: "default-root-history",
				name: "Root archive",
				profile: "default",
			});
			const child = await app.sessions.create(actor, {
				requestId: "default-child-session",
				name: "Child archive",
				cwd: m.config.cwd,
			});
			const childRef = await client.create({
				requestId: "default-child-history",
				name: "Child archive",
				profile: "default",
				sessionId: child.id,
			});
			const targets = [
				{ ref: rootRef, file: app.runtime.view().sessionFile, text: "ROOT-ORIGINAL-IS-RETAINED" },
				{
					ref: childRef,
					file: app.sessions.runtimeFor(childRef).view().sessionFile,
					text: "CHILD-ORIGINAL-IS-RETAINED",
				},
			];
			await app.close();
			app = undefined;
			for (const target of targets) {
				const session = createSession(await openNodeSqliteStorage(target.file));
				try {
					assert.match(target.ref.conversationId, /^\d+$/);
					const id = Number(target.ref.conversationId);
					assert.ok(Number.isSafeInteger(id) && id > 0);
					await session.commit(
						(tx) =>
							tx.appendEntry(UserEntry, id as ConversationId, {
								model: [
									{
										role: "user",
										content: [{ type: "text", text: target.text + "\n" + "X".repeat(8 * 1024 * 1024) }],
										timestamp: 1,
									},
								],
							}),
						BACKGROUND_CONTEXT,
					);
				} finally {
					await session.close(BACKGROUND_CONTEXT);
				}
			}
			app = await startPocket({
				runtime: { ...m.config, reopenSessionFile: targets[0]!.file },
				owner: "Owner",
				initial: [],
			});
			assert.equal(app.sessions.runtimes().length, 2);
			for (const target of targets) {
				const runtime = app.sessions.runtimeFor(target.ref);
				assert.equal(
					runtime.root().view().historyLoaded,
					false,
					"ordinary root/child bootstrap must not hydrate full execution history",
				);
				const preview = await runtime.previewConversation(target.ref, () => {});
				assert.ok(
					preview.entries.some((entry) =>
						entry.messages.some((message) => JSON.stringify(message.content).includes(target.text)),
					),
					"cold browsing retains the original native rows",
				);
				assert.ok(
					Buffer.byteLength(JSON.stringify(preview), "utf8") < 128 * 1024,
					"previewing two 8 MiB originals does not copy their full bodies",
				);
				assert.equal(runtime.root().view().historyLoaded, false, "previewing does not prepare execution");
			}
			assert.equal(m.f.requests.length, 0);
		} finally {
			await app?.close();
			await m.close();
		}
	},
);
