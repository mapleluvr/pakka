import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRuntime, type Runtime } from "@pakka/agent";
import { PocketRemoteError } from "@pakka/client/pocket";
import {
	WEBUI_SERVICE_API,
	decodeWebUiResponse,
	type ConversationReference,
	type WebUiCommand,
} from "@pakka/protocol/webui";
import { startPocket } from "../src/bootstrap.ts";
import { fixture } from "../../../packages/agent/test/fixture.ts";
import { runtimeLimits } from "../../../packages/agent/test/runtime-fixture.ts";

type Product = Awaited<ReturnType<typeof startPocket>>;
const address = (ref: { sessionId: string; conversationId: string }): ConversationReference => ({
	kind: "conversation",
	sessionId: ref.sessionId,
	conversationId: ref.conversationId,
});

async function login(app: Product, token: string) {
	const origin = app.http.origin;
	const response = await fetch(origin + "/pakka-webui/exchange", {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "session", token }),
	});
	assert.equal(response.status, 200);
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	const csrf = /pakka_csrf=([^;]+)/.exec(cookie)![1]!;
	const sessionToken = /pakka_pocket=([^;]+)/.exec(cookie)![1]!;
	const actor = await app.people.authenticate(sessionToken);
	const personId = app.people.current(actor).id;
	async function raw(command: WebUiCommand, api: number = WEBUI_SERVICE_API) {
		const requestId = crypto.randomUUID();
		const response = await fetch(origin + "/pakka-webui/services", {
			method: "POST",
			headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "X-Pakka-CSRF": csrf },
			body: JSON.stringify({ api, requestId, binding: { personId, serverId: app.http.serverId }, command }),
		});
		return { status: response.status, value: decodeWebUiResponse(await response.json(), requestId) };
	}
	async function service(command: WebUiCommand) {
		const reply = await raw(command);
		if ("error" in reply.value)
			throw new PocketRemoteError(reply.value.error.code, reply.value.error.outcome, reply.value.requestId);
		assert.equal(reply.status, 200);
		return reply.value.result;
	}
	return { actor, personId, token: sessionToken, raw, service };
}

// Removing confirmed-source resolution, original identity checks, fork attribution redaction, or read authorization must fail on real HTTP.
test("Stored history HTTP: an unloaded original Session is readable without taking its active writer or granting inherited source authority", async () => {
	const f = await fixture();
	const config = {
		cwd: f.cwd,
		dataDir: f.dataDir,
		endpoint: f.endpoint,
		model: "local-model",
		apiKey: "local-only",
		limits: runtimeLimits,
		observation: "lazy" as const,
	};
	let app: Product | undefined;
	let external: Runtime | undefined;
	try {
		app = await startPocket({ runtime: config, owner: "Owner" });
		assert.ok(app.initialOwner);
		let owner = await login(app, app.initialOwner.token);
		const token = owner.token;
		const child = await app.sessions!.create(owner.actor, {
			requestId: "original-source",
			name: "Original Session",
			cwd: f.cwd,
		});
		const root = app.runtime.view().conversations[0]!;
		const childRuntime = app.sessions!.runtimeFor({ sessionId: child.id });
		const childRoot = childRuntime.view().conversations[0]!;
		assert.equal(
			root.conversationId,
			childRoot.conversationId,
			"the two real Sessions deliberately reuse a native number",
		);
		const parent = await app.workspace
			.bind(owner.actor)
			.create({ requestId: "parent", name: "Original work", profile: "default", sessionId: child.id });
		await childRuntime.writeDisplay(
			childRoot,
			{
				namespace: "history",
				actorId: owner.personId,
				requestId: "child-root",
				kind: "chat",
				text: "CHILD-ROOT-ONLY",
			},
			() => {},
		);
		const original = "CHILD-FIRST\n" + '中🙂\\\"\n'.repeat(1200) + "CHILD-LAST";
		await app.runtime.writeDisplay(
			root,
			{
				namespace: "history",
				actorId: owner.personId,
				requestId: "root-only",
				kind: "chat",
				text: "ROOT-ONLY",
			},
			() => {},
		);
		const written = await childRuntime.writeDisplay(
			parent,
			{ namespace: "history", actorId: owner.personId, requestId: "original", kind: "chat", text: original },
			() => {},
		);
		const fork = await app.workspace.bind(owner.actor).fork(parent, {
			requestId: "fork",
			name: "Authorized fork",
			profile: "default",
			sessionId: child.id,
			entryId: written.entryId,
		});
		const invited = await app.people.invite(owner.actor, {
			requestId: "fork-reader",
			role: "viewer",
			resources: [app.people.resourceId(fork)],
			ttlMs: 60000,
		});
		assert.ok(invited.token);
		const viewerToken = (await app.people.redeem(invited.token, "Fork reader")).token;
		const rootFile = app.runtime.view().sessionFile;
		const childFile = childRuntime.view().sessionFile;
		const cwdRoots = childRuntime.directoryRoots(["default"]);
		await app.close();
		app = undefined;
		// Real writer ownership prevents the product from loading this registered Session; the reader must coexist instead.
		external = await createRuntime({
			...config,
			cwdRoots,
			reservedSessionId: child.id,
			reopenSessionFile: childFile,
		});
		app = await startPocket({ runtime: { ...config, reopenSessionFile: rootFile }, owner: "Owner" });
		owner = await login(app, token);
		const viewer = await login(app, viewerToken);
		assert.throws(() => app!.sessions!.runtimeFor(parent), /unavailable/i);
		assert.equal(
			(await app.sessions!.list(owner.actor)).find((row) => row.id === child.id)?.status,
			"unavailable",
		);
		const beforeDatabase = await readFile(childFile);
		const beforeWal = await readFile(childFile + "-wal");

		const resolved = await viewer.service({ op: "resource.resolve", reference: address(fork) });
		assert.equal(resolved.kind, "resource");
		if (resolved.kind !== "resource") throw Error("Wrong result");
		assert.equal(resolved.resolution.status, "unloaded", JSON.stringify(resolved));
		assert.equal("history" in resolved.resolution && resolved.resolution.history, "readable");
		assert.equal("target" in resolved.resolution, false);
		assert.throws(() => app!.people.check(owner.actor, "send", app!.people.resourceId(parent)), /denied/i);
		const history = await viewer.service({
			op: "resource.history",
			reference: address(fork),
			options: { maxBytes: 16384 },
		});
		assert.equal(history.kind, "resource-history");
		if (history.kind !== "resource-history" || history.history.status !== "unloaded")
			throw Error("Expected original stored history");
		const page = history.history.page;
		assert.deepEqual(page.reference, address(fork));
		assert.equal("ref" in page, false);
		assert.equal("live" in page, false);
		assert.equal(JSON.stringify(page).includes("ROOT-ONLY"), false);
		const inherited = page.entries.find((entry) => entry.id === written.entryId)!;
		assert.ok(inherited);
		assert.equal(inherited.sourceConversationId, undefined);
		const content = inherited.display?.contentReference;
		assert.ok(content);
		assert.equal(content.sourceConversationId, undefined);
		let rebuilt = "",
			offset = 0;
		while (offset < content.byteLength) {
			const result = await viewer.service({
				op: "resource.content",
				reference: address(fork),
				content,
				range: { offset, length: 1024 },
			});
			assert.equal(result.kind, "resource-content");
			if (result.kind !== "resource-content") throw Error("Wrong result");
			assert.equal(result.chunk.reference.sourceConversationId, undefined);
			assert.ok(result.chunk.nextOffset > offset);
			rebuilt += result.chunk.text;
			offset = result.chunk.nextOffset;
		}
		assert.equal(rebuilt, original);
		await assert.rejects(
			viewer.service({
				op: "resource.content",
				reference: address(parent),
				content,
				range: { offset: 0, length: 1024 },
			}),
			{ code: "FORBIDDEN" },
		);
		await assert.rejects(
			viewer.service({
				op: "resource.content",
				reference: address(fork),
				content: { ...content, path: "/data/actorId" },
				range: { offset: 0, length: 1024 },
			}),
		);
		const loaded = await owner.service({ op: "resource.history", reference: address(root) });
		assert.equal(loaded.kind, "resource-history");
		if (loaded.kind !== "resource-history" || loaded.history.status !== "loaded")
			throw Error("Expected existing owner history");
		assert.ok(loaded.history.snapshot.entries.some((entry) => entry.display?.text === "ROOT-ONLY"));
		assert.equal(JSON.stringify(loaded).includes("CHILD-FIRST"), false);
		const otherRoot = await owner.service({ op: "resource.history", reference: address(childRoot) });
		if (otherRoot.kind !== "resource-history" || otherRoot.history.status !== "unloaded")
			throw Error("Expected other Session source");
		assert.ok(otherRoot.history.page.entries.some((entry) => entry.display?.text === "CHILD-ROOT-ONLY"));

		assert.equal(
			otherRoot.history.page.entries.some((entry) => entry.display?.text === "ROOT-ONLY"),
			false,
		);
		const foreign = await viewer.service({ op: "resource.resolve", reference: address(parent) });
		assert.equal(foreign.kind === "resource" && foreign.resolution.status, "forbidden");
		const provenancePath = join(dirname(childFile), "provenance.json");
		const provenance = await readFile(provenancePath, "utf8");
		try {
			await writeFile(
				provenancePath,
				JSON.stringify({ ...JSON.parse(provenance), sessionId: root.sessionId }),
			);
			const mismatch = await owner.service({ op: "resource.resolve", reference: address(parent) });
			assert.equal(mismatch.kind === "resource" && mismatch.resolution.status, "identity-mismatch");
		} finally {
			await writeFile(provenancePath, provenance);
		}
		await app.people.setPerson(owner.actor, viewer.personId, {
			role: "viewer",
			resources: [app.people.resourceId(root)],
		});
		await assert.rejects(viewer.service({ op: "resource.history", reference: address(fork) }), {
			code: "UNAUTHORIZED",
		});
		const oldApi = await owner.raw({ op: "capabilities" }, 1);
		assert.ok("error" in oldApi.value);
		assert.equal(oldApi.value.error.code, "VERSION_MISMATCH");
		assert.deepEqual(await readFile(childFile), beforeDatabase);
		assert.deepEqual(await readFile(childFile + "-wal"), beforeWal);
		assert.equal(external.view().phase, "ready");
		assert.throws(() => app!.sessions!.runtimeFor(parent), /unavailable/i);
		assert.equal(f.requests.length, 0, "browsing and source resolution never dispatch model work");
	} finally {
		await app?.close();
		await external?.close();
		await f.close();
	}
});
