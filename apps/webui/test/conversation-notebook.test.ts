import { isPocketContentReference } from "@pakka/protocol/pocket";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRuntime, type Runtime } from "@pakka/agent";
import { createPocketWorkspace, createPocketPeople, createPocketCollaboration } from "@pakka/server/pocket";
import { collaborationIntent, type CollaborationRequest, type NotebookAction } from "@pakka/protocol/webui";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createConversationNotebook } from "../src/conversation-notebook.ts";
import { createResourceHistory } from "../src/resource-history.ts";

test("legacy singleton imports once; note delete, pin cleanup and original receipt survive lost CAS return and reopen", async () => {
	const f = await runtimeFixture();
	let runtime = f.runtime;
	try {
		const people = await createPocketPeople({ runtime, namespace: "test.people" }),
			login = await people.initializeOwner("Owner"),
			actor = await people.authenticate(login.token),
			target = runtime.view().conversations[0]!;
		const old: CollaborationRequest = {
			requestId: "old-note",
			target,
			action: { kind: "note", expectedVersion: 0, text: "kept legacy note" },
		};
		const store = runtime.store({ namespace: "test.chat", maxBytes: 1024 * 1024 });
		await store.compareAndSet(
			0,
			{
				schema: 3,
				sessionId: target.sessionId,
				resources: [
					{
						id: target.conversationId,
						version: 1,
						note: { version: 1, text: "kept legacy note", authorId: actor.person.id, updatedAt: 12345 },
						driver: { version: 0, expiresAt: null, personId: null },
						driverGeneration: 0,
						messages: [],
						requests: [
							{
								actorId: actor.person.id,
								requestId: old.requestId,
								target: { ...target },
								version: 1,
								at: 12345,
								fingerprint: createHash("sha256").update(collaborationIntent(old)).digest("hex"),
								result: { kind: "note", version: 1 },
							},
						],
					},
				],
			},
			() => {},
		);
		let lost = false;
		const native = runtime;
		const wrapped: Runtime = {
			...native,
			store(options) {
				const store = native.store(options);
				return {
					...store,
					async compareAndSet(...args) {
						const result = await store.compareAndSet(...args);
						if (lost) {
							lost = false;
							throw Error("lost committed CAS return");
						}
						return result;
					},
				};
			},
		};
		const collaboration = await createPocketCollaboration({ runtime, people, namespace: "test.chat" }),
			chat = collaboration.bind(actor);
		await people.change(actor, {
			requestId: "personal",
			action: { op: "mode.set", expectedVersion: (await people.settings(actor)).version, mode: "personal" },
		});
		await assert.rejects(chat.snapshot(target));
		assert.equal((await chat.lookup(old))?.at, 12345);
		await assert.rejects(chat.write({ ...old, requestId: "stale-write" }));
		const notebook = createConversationNotebook({
			runtimeFor: () => wrapped,
			people,
			collaboration,
			history: createResourceHistory({ runtime, people }),
		});
		const list = async (collection: "notes" | "pins") => {
			const r = await notebook(actor, { op: "notebook.list", target, collection, offset: 0, query: "" });
			assert.equal(r.kind, "notebook-page");
			return r;
		};
		const write = (action: NotebookAction) =>
			notebook(actor, { op: "notebook.write", change: { requestId: crypto.randomUUID(), target, action } });
		const imported = (await list("notes")).notes[0]!;
		assert.match(imported.id, /^legacy-/);
		assert.deepEqual(
			[imported.version, imported.body, imported.updatedBy, imported.updatedAt],
			[1, "kept legacy note", actor.person.id, 12345],
		);
		await write({
			kind: "save",
			id: "other",
			title: "",
			body: "PRIVATE-CANARY",
			sources: [],
			expectedVersion: 0,
		});
		await write({
			kind: "save",
			id: imported.id,
			title: "edited",
			body: "new text",
			sources: [],
			expectedVersion: 1,
		});
		await assert.rejects(
			write({
				kind: "save",
				id: imported.id,
				title: "stale",
				body: "lost edit",
				sources: [],
				expectedVersion: 1,
			}),
		);
		await write({
			kind: "save",
			id: "other",
			title: "independent",
			body: "PRIVATE-CANARY",
			sources: [],
			expectedVersion: 1,
		});
		const targetRef = {
			sessionId: target.sessionId,
			conversationId: target.conversationId,
			kind: "note" as const,
			noteId: imported.id,
		};
		await write({ kind: "pin", target: targetRef });
		await write({ kind: "pin", target: targetRef });
		assert.equal((await list("pins")).total, 1);
		const change = {
			requestId: "delete-imported",
			target,
			action: { kind: "delete" as const, id: imported.id, expectedVersion: 2 },
		};
		lost = true;
		await assert.rejects(notebook(actor, { op: "notebook.write", change }), /lost committed/);
		const file = runtime.view().sessionFile;
		await runtime.close();
		runtime = await createRuntime({ ...f.config, reopenSessionFile: file });
		const restored = await createPocketPeople({ runtime, namespace: "test.people" }),
			owner = await restored.authenticate(login.token),
			original = await createPocketCollaboration({ runtime, people: restored, namespace: "test.chat" });
		const reread = createConversationNotebook({
			runtimeFor: () => runtime,
			people: restored,
			collaboration: original,
			history: createResourceHistory({ runtime, people: restored }),
		});
		assert.equal((await original.bind(owner).lookup(old))?.at, 12345);
		const result = await reread(owner, { op: "notebook.lookup", original: change });
		assert.equal(result.kind, "notebook-operation");
		assert.equal(result.receipt?.version, 3);
		for (const collection of ["notes", "pins"] as const) {
			const r = await reread(owner, { op: "notebook.list", target, collection, offset: 0, query: "" });
			assert.equal(r.kind, "notebook-page");
			assert.equal(r.total, collection === "pins" ? 0 : 1);
			if (collection === "notes") assert.equal(r.notes[0]?.id, "other");
		}
		assert.equal(f.f.requests.length, 0);
	} finally {
		await runtime.close();
		await f.close();
	}
});
test("fork view pin and original excerpt use the child grant; old source outage does not make independent note body read-only", async () => {
	const f = await runtimeFixture();
	try {
		const runtime = f.runtime,
			people = await createPocketPeople({ runtime, namespace: "fork.people" }),
			owner = await people.authenticate((await people.initializeOwner("Owner")).token),
			workspace = createPocketWorkspace({
				runtime,
				people,
				catalog: { namespace: "fork.workspace", maxPending: 4 },
				profileCeiling: () => ["default"],
			}),
			admin = workspace.bind(owner);
		const parent = await admin.create({ requestId: "parent", name: "Parent", profile: "default" });
		const submitted = await admin.submit(parent, {
				requestId: "short",
				mode: "prompt",
				text: "A stable short message",
			}),
			done = await admin.wait(submitted.id);
		assert.equal(done.status, "done");
		assert.ok(done.entryId);
		const child = await admin.fork(parent, {
			requestId: "fork",
			name: "Child",
			profile: "default",
			entryId: done.entryId,
		});
		const invite = await people.invite(owner, {
			requestId: "child-only",
			role: "driver",
			resources: [child.conversationId],
			ttlMs: 60000,
		});
		const person = await people.authenticate((await people.redeem(invite.token!, "Child only")).token);
		const history = createResourceHistory({ runtime, people });
		let online = true;
		const notebook = createConversationNotebook({
			runtimeFor: () => runtime,
			people,
			collaboration: await createPocketCollaboration({ runtime, people, namespace: "fork.chat" }),
			history: {
				...history,
				content: (...args) => {
					if (!online) throw Error("original unavailable");
					return history.content(...args);
				},
			},
		});
		const getContent = async (actor: typeof owner) => {
			const e = (await workspace.bind(actor).preview(child)).entries.find((e) => e.id === done.entryId);
			const r = e?.messages.find((m) => m.role === "user")?.contentReference;
			assert.ok(isPocketContentReference(r) && r.previewComplete);
			return r;
		};
		const visible = await getContent(owner),
			scoped = await getContent(person);
		assert.equal(visible.sourceConversationId, parent.conversationId);
		assert.equal(scoped.sourceConversationId, undefined);
		const ref = (c: typeof visible) => ({
			kind: "message" as const,
			sessionId: child.sessionId,
			conversationId: child.conversationId,
			content: c,
		});
		const write = (actor: typeof owner, action: NotebookAction) =>
			notebook(actor, {
				op: "notebook.write",
				change: { requestId: crypto.randomUUID(), target: child, action },
			});
		await write(owner, { kind: "pin", target: ref(visible) });
		await write(person, { kind: "pin", target: ref(scoped) });
		const pins = await notebook(person, {
			op: "notebook.list",
			target: child,
			collection: "pins",
			query: "",
			offset: 0,
		});
		assert.equal(pins.kind, "notebook-page");
		assert.equal(pins.total, 1);
		const r = pins.pins[0]!.target;
		assert.equal(r.kind, "message");
		assert.equal(r.content.sourceConversationId, undefined);
		const result = await history.content(
			person,
			{ kind: "conversation", sessionId: r.sessionId, conversationId: r.conversationId },
			r.content,
			{ offset: 0, length: 1024 },
		);
		assert.equal(result.chunk.text, "A stable short message");
		await assert.rejects(workspace.bind(person).preview(parent));
		const save = {
			kind: "save" as const,
			id: "copy",
			title: "",
			body: "independent excerpt",
			sources: [ref(scoped)],
			expectedVersion: 0,
		};
		await write(person, save);
		online = false;
		await write(person, { ...save, expectedVersion: 1, body: "my own notes" });
		await assert.rejects(write(person, { ...save, id: "new-source" }), /unavailable/);
		const later = await admin.submit(child, {
			requestId: "after-notebook",
			mode: "prompt",
			text: "EXPLICIT-AFTER-NOTE",
		});
		assert.equal((await admin.wait(later.id)).status, "done");
		await people.revokePerson(owner, person.person.id);
		await assert.rejects(
			notebook(person, { op: "notebook.list", target: child, collection: "pins", query: "", offset: 0 }),
		);
		assert.equal(f.f.requests.length, 2);
		assert.doesNotMatch(JSON.stringify(f.f.requests), /my own notes|independent excerpt/);
		await history.close();
	} finally {
		await f.close();
	}
});
