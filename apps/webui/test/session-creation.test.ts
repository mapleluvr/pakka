import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend } from "./frontend-controls.ts";

type Product = Awaited<ReturnType<typeof startPocket>>;
async function signIn(app: Product, token = app.initialOwner?.token) {
	assert.ok(token);
	const origin = app.http.origin;
	const response = await fetch(origin + "/pocket/exchange", {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "session", token }),
	});
	assert.equal(response.status, 200);
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	const csrf = /pakka_csrf=([^;]+)/.exec(cookie)?.[1];
	assert.ok(csrf);
	return Object.assign(rpcFor(app, { cookie, csrf }), { cookie, csrf });
}
function rpcFor(app: Product, { cookie, csrf }: { cookie: string; csrf: string }) {
	const origin = app.http.origin;
	return async (command: Record<string, unknown>) => {
		const requestId = crypto.randomUUID();
		const result = await fetch(origin + "/pocket/rpc", {
			method: "POST",
			headers: { Origin: origin, Cookie: cookie, "X-Pakka-CSRF": csrf, "Content-Type": "application/json" },
			body: JSON.stringify({ version: 2, requestId, command }),
		});
		const body = await result.json();
		assert.equal(result.status, 200, JSON.stringify(body));
		return body.result;
	};
}

// A second name in the old catalog cannot satisfy separate native Session identity/storage/budgets.
test("Session creation: authenticated creation makes independent native Sessions and opens Conversations in the chosen parent without inference", async () => {
	const m = await runtimeFixture({
		profiles: [
			{ id: "alternate", model: "alternate-local-model" },
			{ id: "same-model", model: "local-model" },
		],
	});
	let app: Product | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({ runtime: { ...m.config, dataDir: join(m.f.root, "managed") }, owner: "Owner" });
		const rpc = await signIn(app);
		const empty = await rpc({ op: "session.list" });
		assert.deepEqual(empty.sessions, [], "the empty bootstrap Session is not a user-created parent");
		assert.equal(
			empty.defaults.profile,
			"default",
			"creation uses a service Agent template, not a model grant",
		);
		assert.deepEqual(
			empty.defaults.choices,
			[
				{ id: "default", model: "local-model" },
				{ id: "alternate", model: "alternate-local-model" },
			],
			"duplicate presets do not replace the first model catalog entry",
		);
		assert.equal((await rpc({ op: "creation.directories", path: m.f.cwd })).view.path, m.f.cwd);
		const firstInput = {
			op: "session.create",
			requestId: "first-session",
			name: "First Session",
			cwd: m.f.cwd,
		};
		const first = (await rpc(firstInput)).session;
		const second = (await rpc({ ...firstInput, requestId: "second-session", name: "Second Session" }))
			.session;
		assert.equal(first.status, "ready");
		assert.equal(second.status, "ready");
		assert.notEqual(first.id, second.id);
		assert.notEqual(first.id, app.runtime.view().sessionId);
		assert.deepEqual(
			(await rpc(firstInput)).session,
			first,
			"identical requests must not create another Session",
		);
		assert.deepEqual((await rpc({ op: "session.lookup", original: firstInput })).session, first);
		const create = {
			op: "create",
			requestId: "same-request-in-each-session",
			name: "Project",
			profile: "default",
			configuration: { model: "alternate-local-model", cwd: m.f.cwd },
		};
		const a = (await rpc({ ...create, sessionId: first.id })).ref;
		const b = (await rpc({ ...create, sessionId: second.id })).ref;
		assert.equal(a.sessionId, first.id);
		assert.equal(b.sessionId, second.id);
		assert.equal(
			a.conversationId,
			b.conversationId,
			"exercise colliding native IDs across independent storage domains",
		);
		assert.deepEqual((await rpc({ op: "configuration", target: a })).configuration.current, {
			model: "alternate-local-model",
			cwd: m.f.cwd,
		});
		assert.deepEqual((await rpc({ op: "configuration", target: b })).configuration.current, {
			model: "alternate-local-model",
			cwd: m.f.cwd,
		});
		assert.equal((await rpc({ op: "session.list" })).sessions.length, 2);
		assert.equal(m.f.requests.length, 0);
		assert.equal((await rpc({ op: "notification.status", target: a })).kind, "notification");
		assert.equal((await rpc({ op: "notification.status", target: b })).kind, "notification");
		const sent = (
			await rpc({
				op: "submit",
				target: a,
				input: { requestId: "first-work", text: "FIRST-SESSION-ONLY", mode: "prompt" },
			})
		).receipt;
		const originals = await app
			.sessions!.runtimeFor(a)
			.catalog({ namespace: "pocket.workspace", maxDeliveries: 512, maxPending: 32 })
			.received(a, () => {});
		assert.equal(originals.length, 1);
		assert.equal(sent.id, originals[0]!.id, "the browser receipt keeps the actual catalog identity");
		assert.equal((await rpc({ op: "wait", id: sent.id, sessionId: a.sessionId })).receipt.status, "done");
		assert.equal(m.f.requests.length, 1);
		assert.equal(m.f.requests[0]?.model, "alternate-local-model");
		let completions = [];
		for (let attempt = 0; attempt < 40; attempt++) {
			const state = await app.runtime
				.store({ namespace: "pocket.notifications", maxBytes: 1048576 })
				.snapshot();
			completions = Array.isArray(state.data.events)
				? state.data.events.filter(
						(row) => row && typeof row === "object" && !Array.isArray(row) && row.kind === "done",
					)
				: [];
			if (completions.length) break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		assert.equal(completions.length, 1, "the actual child Runtime completion must be observed exactly once");
		assert.equal(
			(await rpc({ op: "configuration", target: a })).configuration.session.budget.primaryAttempts,
			1,
		);
		assert.equal(
			(await rpc({ op: "configuration", target: b })).configuration.session.budget.primaryAttempts,
			0,
		);
		assert.equal(
			(await rpc({ op: "read", target: b })).snapshot.entries.some((entry: { messages: unknown }) =>
				JSON.stringify(entry.messages).includes("FIRST-SESSION-ONLY"),
			),
			false,
		);
		const controlFile = app.runtime.view().sessionFile;
		await app.close();
		app = undefined;
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "managed"), reopenSessionFile: controlFile },
			owner: "Owner",
		});
		const reopened = rpcFor(app, rpc);
		assert.deepEqual(
			(await reopened({ op: "session.list" })).sessions.map((row: { id: string }) => row.id),
			[first.id, second.id],
		);
		assert.deepEqual(
			(await reopened({ ...create, sessionId: first.id })).ref,
			a,
			"the original Conversation request remains idempotent after reopen",
		);
		assert.equal((await reopened(firstInput)).session.id, first.id);
		assert.deepEqual((await reopened({ op: "configuration", target: a })).configuration.current, {
			model: "alternate-local-model",
			cwd: m.f.cwd,
		});
		assert.equal(
			(await reopened({ op: "configuration", target: a })).configuration.session.budget.primaryAttempts,
			1,
		);
		assert.equal(
			(await reopened({ op: "configuration", target: b })).configuration.session.budget.primaryAttempts,
			0,
		);
		assert.equal(
			(await reopened({ op: "receipt", id: sent.id, sessionId: a.sessionId })).receipt.status,
			"done",
		);
		assert.equal(m.f.requests.length, 1, "reopen and original-result reads never replay model input");
	} finally {
		await app?.close();
		await m.close();
	}
});

// Equal native Conversation IDs in two children must still have distinct resource grants.
test("Session authorization: a Conversation grant never reads its same-ID peer or parent metadata in another Session", async () => {
	const m = await runtimeFixture();
	let app: Product | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({ runtime: { ...m.config, dataDir: join(m.f.root, "scope") }, owner: "Owner" });
		const rpc = await signIn(app);
		const visibleParent = (
			await rpc({ op: "session.create", requestId: "visible-session", name: "Visible Parent", cwd: m.f.cwd })
		).session;
		const parent = (
			await rpc({ op: "session.create", requestId: "private-session", name: "PRIVATE-PARENT", cwd: m.f.cwd })
		).session;
		const visible = (
			await rpc({
				op: "create",
				sessionId: visibleParent.id,
				requestId: "visible-conversation",
				name: "Visible Conversation",
				profile: "default",
			})
		).ref;
		const peer = (
			await rpc({
				op: "create",
				sessionId: parent.id,
				requestId: "private-conversation",
				name: "PRIVATE-PEER",
				profile: "default",
			})
		).ref;
		assert.equal(visible.conversationId, peer.conversationId, "the grant-collision premise must be real");
		const navigation = (await rpc({ op: "list" })).navigation;
		const grant = navigation.find(
			(row: { ref: { sessionId: string } }) => row.ref.sessionId === visibleParent.id,
		)?.resourceId;
		assert.equal(
			typeof grant,
			"string",
			"a child Conversation must expose an existing-resource grant, not a bare ambiguous native ID",
		);
		const invitation = await rpc({
			op: "invite",
			requestId: "child-viewer",
			role: "viewer",
			resources: [grant],
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const issued = await app.people.redeem(invitation.token, "Viewer");
		const actor = await app.people.authenticate(issued.token);
		const viewer = app.workspace.bind(actor);
		await viewer.read(visible);
		const extensions = app.extensions;
		assert.deepEqual(extensions.list(actor, visible), []);
		assert.throws(() => extensions.list(actor, peer), { code: "FORBIDDEN" });
		await assert.rejects(viewer.read(peer), /denied|authority|resource/i);
		assert.deepEqual(
			(await viewer.navigation()).map((row) => row.name),
			["Visible Conversation"],
		);
		const visibleSessions = await app.sessions!.list(actor);
		assert.equal(
			visibleSessions.some((row) => row.id === parent.id),
			false,
		);
		assert.equal(
			visibleSessions.find((row) => row.id === visibleParent.id)?.cwd,
			undefined,
			"a Conversation reader is not granted parent configuration",
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.close();
	}
});

// A dialog layered over the old home-name composer is still a second creation path: cancel must leave no naming form/resource.
test(
	"Conversation creation browser: New Session opens a dedicated configuration dialog and cancel leaves neither a home naming form nor native effects",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture();
		let app: Product | undefined, browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "dialog") },
				owner: "Owner",
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "dialog-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector(".app-shell")');
			await settleFrontend(page);
			await page.click(".primary-nav .new-session");
			await page.wait('document.querySelector("[data-creation-form] input[name=sessionName]")');
			await settleFrontend(page);
			const dialog = await page.evaluate(
				`(()=>{const d=document.querySelector('[role="dialog"]');return {open:Boolean(d),name:d?.querySelector('h1,h2')?.textContent?.trim(),hasName:Boolean(d?.querySelector('input[name="sessionName"]')),hasConfiguration:Boolean(d?.querySelector('[name="cwd"]'))};})()`,
			);
			assert.deepEqual(dialog, { open: true, name: "New Session", hasName: true, hasConfiguration: true });
			await page.type('input[name="sessionName"]', "CANCELLED-SESSION", { replace: true });
			await page.key("Escape");
			await page.wait('!document.querySelector("[role=dialog]")');
			assert.equal(
				await page.evaluate('Boolean(document.querySelector(".home-view textarea, [data-home-create]"))'),
				false,
			);
			assert.equal(app.runtime.view().conversations.length, 1);
			const listed = (await page.evaluate(
				`fetch('/pocket/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Pakka-CSRF':document.cookie.match(/(?:^|; )pakka_csrf=([^;]+)/)[1]},body:JSON.stringify({version:2,requestId:'after-cancel',command:{op:'session.list'}})}).then(r=>r.json())`,
			)) as { result?: { sessions?: unknown[] } };
			assert.deepEqual(listed.result?.sessions, []);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
