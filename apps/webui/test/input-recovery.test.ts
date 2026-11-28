import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { listenHttp } from "../../../apps/server/src/http-listener.ts";
import { createPocketClient, PocketRemoteError } from "@pakka/client/pocket";
import { createWebUiServiceClient } from "@pakka/client/webui";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";

// Heavy release/webui: real SQLite product, public clients and deterministic model HTTP.
// Cutting the response after the actual commit must recover through observation, never submit again.
test("Input recovery: exact original lookup survives response loss and Session reopen without readmission", async () => {
	const m = await runtimeFixture({ profiles: [{ id: "alternate", model: "alternate-model" }] });
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	let cookie = "",
		csrf = "",
		cut = true,
		submits = 0,
		lookups = 0;
	const proxy = createServer((request, response) => {
		void (async () => {
			const parts: Buffer[] = [];
			for await (const part of request) parts.push(part);
			const body = Buffer.concat(parts);
			const parsed = JSON.parse(body.toString("utf8"));
			if (parsed.command.op === "submit") submits++;
			if (parsed.command.op === "input.lookup") lookups++;
			assert.ok(app);
			const headers = new Headers();
			for (const [name, value] of Object.entries(request.headers))
				if (
					typeof value === "string" &&
					!["host", "connection", "content-length", "cookie", "origin"].includes(name)
				)
					headers.set(name, value);
			headers.set("Cookie", cookie);
			headers.set("Origin", app.http.origin);
			const upstream = await fetch(app.http.origin + request.url, { method: "POST", headers, body });
			const bytes = Buffer.from(await upstream.arrayBuffer());
			if (parsed.command.op === "submit" && cut) {
				assert.equal(upstream.status, 200, bytes.toString());
				cut = false;
				response.destroy();
				return;
			}
			response.writeHead(upstream.status, { "Content-Type": "application/json" });
			response.end(bytes);
		})().catch((error) => response.destroy(error));
	});
	const listening = await listenHttp(proxy, { host: "127.0.0.1" });
	try {
		const runtime = { ...m.config, dataDir: join(m.f.root, "input-product") };
		app = await startPocket({ runtime, owner: "Owner" });
		assert.ok(app.initialOwner);
		const administratorToken = app.initialOwner.token;
		const administrator = await app.people.authenticate(administratorToken);
		const invitation = await app.people.invite(administrator, {
			requestId: "test-operator",
			role: "admin",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const member = await app.people.redeem(invitation.token, "Test operator");
		const login = await fetch(app.http.origin + "/pakka-webui/exchange", {
			method: "POST",
			headers: { Origin: app.http.origin, "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "session", token: member.token }),
		});
		assert.equal(login.status, 200);
		cookie = login.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		csrf = /pakka_csrf=([^;]+)/.exec(cookie)![1]!;
		const origin = `http://127.0.0.1:${listening.port}`;
		const work = createPocketClient({ endpoint: origin + "/pakka-webui/rpc", csrf: () => csrf });
		let hello = await work.request({ op: "hello" });
		assert.equal(hello.kind, "hello");
		if (hello.kind !== "hello") throw Error("Missing identity");
		const personId = hello.person.id;
		let serverId = hello.serverId;
		const services = createWebUiServiceClient({
			endpoint: origin + "/pakka-webui/services",
			csrf: () => csrf,
			personId: () => personId,
			serverId: () => serverId,
		});
		const first = await work.request({
			op: "session.create",
			requestId: "parent-a",
			name: "A",
			cwd: m.f.cwd,
		});
		const second = await work.request({
			op: "session.create",
			requestId: "parent-b",
			name: "B",
			cwd: m.f.cwd,
		});
		if (
			first.kind !== "managed.session" ||
			!first.session ||
			second.kind !== "managed.session" ||
			!second.session
		)
			throw Error("Missing native Sessions");
		const creation = { op: "create" as const, requestId: "same-work", name: "Work", profile: "default" };
		const a = await work.request({ ...creation, sessionId: first.session.id });
		const b = await work.request({ ...creation, sessionId: second.session.id });
		if (a.kind !== "reference" || b.kind !== "reference") throw Error("Missing original resources");
		assert.equal(a.ref.conversationId, b.ref.conversationId);
		assert.notEqual(a.ref.sessionId, b.ref.sessionId);
		const original = {
			target: a.ref,
			input: { requestId: "lost-input", text: "ONE-ORIGINAL-INPUT", mode: "prompt" as const },
		};
		assert.equal((await services.request({ op: "input.lookup", original })).receipt, null);
		assert.equal(m.f.requests.length, 0);
		await assert.rejects(
			work.request({ op: "submit", ...original }, { requestId: original.input.requestId }),
			(error: unknown) => error instanceof PocketRemoteError && error.outcome === "unknown",
		);
		assert.equal(submits, 1);
		// The second login only knows the stable Conversation. It discovers the admitted work itself.
		const invite = await app.people.invite(administrator, {
			requestId: "second-device",
			personId,
			role: "admin",
			resources: "*",
			ttlMs: 60000,
		});
		const host = app.http.origin;
		const exchange = await fetch(host + "/pakka-webui/exchange", {
			method: "POST",
			headers: { Origin: host, "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "invite", token: invite.token, name: "Second device" }),
		});
		assert.equal(exchange.status, 200);
		const jar = exchange.headers
			.getSetCookie()
			.map((line) => line.split(";")[0])
			.join("; ");
		assert.notEqual(jar, cookie);
		const transport: typeof fetch = (url, init) => {
			const headers = new Headers(init?.headers);
			headers.set("Origin", host);
			headers.set("Cookie", jar);
			return fetch(url, { ...init, headers });
		};
		const access = { csrf: () => /pakka_csrf=([^;]+)/.exec(jar)![1]!, fetch: transport };
		const terminal = createPocketClient({ ...access, endpoint: host + "/pakka-webui/rpc" });
		const identity = await terminal.request({ op: "hello" });
		if (identity.kind !== "hello") throw Error("Missing terminal login");
		assert.equal(identity.person.id, personId);
		const peer = createWebUiServiceClient({
			...access,
			endpoint: host + "/pakka-webui/services",
			personId: () => identity.person.id,
			serverId: () => identity.serverId,
		});
		const history = await peer.request({ op: "input.history", target: a.ref });
		const admitted = history.page.items[0]!.receipt;
		await terminal.request({ op: "wait", id: admitted.id, sessionId: a.ref.sessionId });
		const changed = await peer.request({
			op: "conversation-configuration.write",
			change: {
				requestId: "change-model",
				target: a.ref,
				selection: { kind: "agent", change: { model: "alternate-model" } },
			},
		});
		const currentRef = changed.receipt.ref;
		assert.notEqual(currentRef.incarnation, a.ref.incarnation);
		assert.equal(
			(await peer.request({ op: "input.history", target: currentRef })).page.items[0]?.receipt.id,
			admitted.id,
		);
		const found = await services.request({ op: "input.lookup", original });
		assert.ok(found.receipt);
		assert.deepEqual(found.target, a.ref);
		assert.equal(found.receipt.requestId, original.input.requestId);
		assert.equal(found.receipt.id, admitted.id);
		const completed = await work.request({ op: "wait", id: found.receipt.id, sessionId: a.ref.sessionId });
		assert.equal(completed.kind, "receipt");
		assert.equal(m.f.requests.length, 1);
		assert.equal(
			(await services.request({ op: "input.lookup", original: { ...original, target: b.ref } })).receipt,
			null,
		);
		await assert.rejects(
			services.request({
				op: "input.lookup",
				original: {
					...original,
					input: { ...original.input, text: "ALTERED" },
				},
			}),
			{ outcome: "unknown" },
		);
		const file = app.runtime.view().sessionFile;
		await app.close();
		app = undefined;
		app = await startPocket({ runtime: { ...runtime, reopenSessionFile: file }, owner: "Owner" });
		hello = await work.request({ op: "hello" });
		assert.notEqual(hello.serverId, serverId);
		serverId = hello.serverId;
		const after = await services.request({ op: "input.lookup", original });
		assert.equal(after.receipt?.id, found.receipt.id);
		assert.equal(after.receipt?.status, "done");
		const inputs = await services.request({ op: "input.history", target: currentRef });
		assert.equal(inputs.page.items[0]?.receipt.id, found.receipt.id);
		assert.equal(inputs.page.items[0]?.preview, original.input.text);
		assert.deepEqual((await services.request({ op: "input.history", target: b.ref })).page.items, []);
		assert.equal(submits, 1);
		assert.equal(m.f.requests.length, 1);
		assert.equal(lookups, 5);
		await assert.rejects(
			services.request({ op: "input.lookup", original: { ...original, target: currentRef } }),
		);
		const fresh = { requestId: "stale-new-input", text: "STALE-INPUT", mode: "prompt" as const };
		await assert.rejects(
			work.request({ op: "submit", target: a.ref, input: fresh }, { requestId: fresh.requestId }),
		);
		assert.deepEqual(
			(await services.request({ op: "input.history", target: currentRef })).page.items.map(
				(item) => item.receipt.id,
			),
			[admitted.id],
		);
		const actor = await app.people.authenticate(administratorToken);
		await app.people.setPerson(actor, personId, {
			role: "viewer",
			resources: [app.people.resourceId(b.ref)],
		});
		await assert.rejects(services.request({ op: "input.lookup", original }), { code: "UNAUTHORIZED" });
		await assert.rejects(services.request({ op: "input.history", target: currentRef }), {
			code: "UNAUTHORIZED",
		});
		assert.equal(submits, 2); // One accepted input, one rejected stale command.
		assert.equal(m.f.requests.length, 1);
	} finally {
		await new Promise<void>((resolve, reject) => {
			proxy.close((error) => (error ? reject(error) : resolve()));
			proxy.closeAllConnections();
		});
		await app?.close();
		await m.close();
	}
});
