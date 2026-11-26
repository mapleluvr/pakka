import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "node:http";
import { listenHttp } from "@pakka/server/http-listener";

import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { startPocket } from "../../../apps/webui/src/bootstrap.ts";
import { createExtensionClient, bindExtensionService } from "@pakka/client/extensions";
import { createPocketClient, PocketRemoteError } from "@pakka/client/pocket";
import { reconcileTicketWrite, type PendingTicketWrite } from "../src/browser/pending.ts";
import { createTicketService, type NativeTicketService } from "@pakka/rsi";
import { createMasTicketDispatcher } from "@pakka/rsi/mas";
import { createMas } from "@pakka/mas";
import { readTicketResult, ticketCall, TicketCallError } from "@pakka/rsi/client";
import type { ExtensionJson } from "@pakka/protocol/extensions";

async function backend(): Promise<typeof import("../src/backend.ts")> {
	const module = await import(new URL("../src/backend.ts", import.meta.url).href).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
			return {};
		},
	);
	assert.equal(typeof module.ticketExtensionService, "function", "Ticket public Backend service is missing");
	return module;
}

test(
	"tickets HTTP: outer and inner receipts reconcile committed writes; bounds and disabled Backend preserve the original outcome",
	{ timeout: 45000 },
	async () => {
		const module = await backend(),
			m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, service!: NativeTicketService;
		let proxy: ReturnType<typeof createServer> | undefined;
		let holdEdit = false,
			releaseEdit = () => {};
		const held = new Promise<void>((resolve) => {
			releaseEdit = resolve;
		});
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "product") },
				owner: "Owner",
				initial: [],
				extensions: [
					{
						root: fileURLToPath(new URL("../dist/", import.meta.url)),
						facets: ["backend", "client", "webui"],
					},
				],
				extensionServices: async (context) => {
					service = await createTicketService({ runtime: context.runtime, namespace: "tickets" });
					const original = module.ticketExtensionService(context, service);
					return {
						tickets: {
							...original,
							bind(...args: Parameters<typeof original.bind>) {
								const client = original.bind(...args);
								return {
									...client,
									async edit(input: Parameters<typeof client.edit>[0]) {
										const result = await client.edit(input);
										if (holdEdit) {
											holdEdit = false;
											await held;
										}
										return result;
									},
								};
							},
						},
					};
				},
			});
			const signed = await fetch(app.http.origin + "/pakka-webui/exchange", {
				method: "POST",
				headers: { Origin: app.http.origin, "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "session", token: app.initialOwner!.token }),
			});
			assert.equal(signed.status, 200);
			const cookies = signed.headers
				.getSetCookie()
				.map((row) => row.split(";")[0]!)
				.join("; ");
			const csrf = /pakka_csrf=([^;]+)/.exec(cookies)![1]!;
			const calls: string[] = [];
			let drop = true;
			proxy = createServer((request, response) => {
				void (async () => {
					if (!request.url?.startsWith("/pakka-webui/")) {
						response.writeHead(404).end();
						return;
					}
					const chunks: Buffer[] = [];
					for await (const chunk of request) chunks.push(Buffer.from(chunk));
					const body = Buffer.concat(chunks);
					let action: unknown;
					try {
						action = JSON.parse(body.toString()).command?.call?.action;
					} catch {
						action = null;
					}
					if (typeof action === "string") calls.push(action);
					const upstream = await fetch(app!.http.origin + request.url, {
						method: request.method,
						body,
						headers: {
							Origin: app!.http.origin,
							Cookie: cookies,
							"Content-Type": "application/json",
							"X-Pakka-CSRF": String(request.headers["x-pakka-csrf"] ?? ""),
							"X-Pakka-Person": String(request.headers["x-pakka-person"] ?? ""),
							"X-Pakka-Server": String(request.headers["x-pakka-server"] ?? ""),
						},
					});
					const bytes = Buffer.from(await upstream.arrayBuffer());
					// Real committed bytes arrive before the downstream socket is cut.
					if (drop && action === "submit") {
						drop = false;
						response.destroy();
						return;
					}
					response.writeHead(upstream.status, { "Content-Type": "application/json" }).end(bytes);
				})().catch((reason) => response.destroy(reason instanceof Error ? reason : undefined));
			});
			const address = await listenHttp(proxy, { host: "127.0.0.1" });
			const origin = "http://127.0.0.1:" + address.port;
			const workbench = createPocketClient({ endpoint: origin + "/pakka-webui/rpc", csrf: () => csrf });
			const hello = await workbench.request({ op: "hello" });
			assert.equal(hello.kind, "hello");
			if (hello.kind !== "hello") throw new Error("Handshake failed");
			const extensions = createExtensionClient({
				endpoint: origin + "/pakka-webui/extensions/rpc",
				csrf: () => csrf,
				timeoutMs: 15000,
				personId: () => hello.person.id,
				serverId: () => hello.serverId,
			});
			let registration = (await extensions.list()).find(
				(row) => row.facet === "backend" && row.manifest.id === "rsi",
			)!;
			const signal = new AbortController().signal;
			const binding = bindExtensionService(extensions, {
				extensionId: "rsi",
				personId: hello.person.id,
				serverId: hello.serverId,
				signal,
				backend: () => registration,
			});
			const original: PendingTicketWrite = {
				version: 1,
				action: "submit",
				requestId: "original-submit",
				ticketId: null,
			};
			await assert.rejects(
				binding.call(
					"submit",
					{ title: "Bounded collaboration", body: "Original evidence", sources: [] },
					{ requestId: original.requestId },
				),
				(error) => error instanceof PocketRemoteError && error.outcome === "unknown",
			);
			const manager = service.connect({ id: "manager", role: () => "manager", check() {} });
			assert.equal((await manager.list()).items.length, 1);
			const confirmed = await reconcileTicketWrite(binding, original, signal);
			assert.equal(confirmed.status, "saved");
			if (confirmed.status !== "saved") throw new Error("Submission was not confirmed");
			const first = confirmed.receipt;
			assert.equal(calls.filter((action) => action === "submit").length, 1);
			const outer = await binding.operationByRequest(original.requestId);
			assert.equal(first.requestId, outer.id);
			assert.notEqual(first.requestId, original.requestId);

			// A real durable edit commits, but the approved Backend action misses its deadline.
			holdEdit = true;
			const edit: PendingTicketWrite = {
				version: 1,
				action: "edit",
				requestId: "original-edit",
				ticketId: first.id,
			};
			const timed = await binding.call(
				"edit",
				{
					id: first.id,
					expectedVersion: first.version,
					title: "Bounded collaboration",
					body: "Saved before timeout",
					sources: [],
				},
				{ requestId: edit.requestId },
			);
			assert.equal(timed.state, "unknown");
			// A different ledger receipt cannot confirm a pending edit, even with matching IDs.
			const wrongKind = {
				...binding,
				async call(...args: Parameters<typeof binding.call>) {
					assert.equal(args[0], "lookup");
					const lookup = await binding.call(...args);
					return {
						...lookup,
						value: {
							status: "ok",
							value: {
								kind: "report",
								requestId: timed.id,
								id: first.id,
								workId: "work",
								contentRevision: 1,
								reportId: "report",
								reportVersion: 1,
							},
						},
					};
				},
			};
			await assert.rejects(reconcileTicketWrite(wrongKind, edit, signal), /回执类型/);
			const recovered = await reconcileTicketWrite(binding, edit, signal);
			assert.equal(recovered.status, "saved");
			if (recovered.status !== "saved") throw new Error("Inner receipt was not confirmed");
			assert.equal(recovered.receipt.requestId, timed.id);
			assert.equal(calls.filter((action) => action === "edit").length, 1);
			assert.equal((await manager.get(first.id)).ticket.revisions.length, 2);
			releaseEdit();
			const closed = await ticketCall(binding, "set-state", {
				id: first.id,
				expectedVersion: recovered.receipt.version,
				state: "closed",
				text: "Evidence retained",
				links: [],
			});
			assert.equal(closed.state, "closed");
			let version = closed.version;
			for (let index = 0; index < 45; index++)
				version = (
					await manager.edit({
						requestId: "history-" + index,
						id: first.id,
						expectedVersion: version,
						title: "Historical " + index,
						body: "BODY-" + index,
						sources: [],
					})
				).version;
			const latest = await ticketCall(binding, "get", { id: first.id });
			assert.equal(latest.ticket.revisions.length, 32);
			const earlier = await ticketCall(binding, "history", {
				id: first.id,
				kind: "revisions",
				cursor: latest.cursors.revisions,
				limit: 32,
			});
			assert.equal(earlier.items.length, 15);
			assert.equal(latest.ticket.title, "Historical 44");

			await extensions.control({
				extension: "rsi",
				facet: "backend",
				action: "disable",
				expectedGeneration: registration.generation,
				requestId: "disable",
			});
			registration = (await extensions.list()).find(
				(row) => row.facet === "backend" && row.manifest.id === "rsi",
			)!;
			assert.equal(registration.phase, "disabled");
			await assert.rejects(
				binding.call("edit", {
					id: first.id,
					expectedVersion: version,
					title: "No",
					body: "No",
					sources: [],
				}),
				(error) => error instanceof PocketRemoteError && error.outcome === "denied",
			);
			assert.deepEqual(await reconcileTicketWrite(binding, original, signal), confirmed);
			assert.equal((await manager.get(first.id)).ticket.version, version);
			assert.equal(m.f.requests.length, 0);
		} finally {
			releaseEdit();
			if (proxy)
				await new Promise<void>((resolve) => {
					proxy!.close(() => resolve());
					proxy!.closeAllConnections();
				});
			await app?.close();
			await m.close();
		}
	},
);

test("tickets Backend: refreshing a native run remains readable for a ticket with large progress history", async () => {
	const module = await backend(),
		m = await runtimeFixture();
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined, service!: NativeTicketService;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "product") },
			owner: "Owner",
			initial: [],
			extensions: [
				{ root: fileURLToPath(new URL("../dist/", import.meta.url)), facets: ["backend", "client", "webui"] },
			],
			extensionServices: async (context) => {
				const mas = await createMas({
					runtime: context.runtime,
					namespace: "mas",
					maxDeliveries: 8,
					maxPending: 2,
				});
				await mas.bootstrap([{ key: "worker", owner: "operator" }]);
				await mas.activate();
				const target = (await mas.view()).members[0]!.ref;
				const client = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
				service = await createTicketService({
					runtime: context.runtime,
					namespace: "tickets",
					handlers: [{ id: "worker", label: "Worker", actorId: "worker" }],
					dispatcher: createMasTicketDispatcher({ routes: [{ handlerId: "worker", target, client }] }),
				});
				return { tickets: module.ticketExtensionService(context, service) };
			},
		});
		const manager = service.connect({ id: "manager", role: () => "manager", check() {} });
		const created = await manager.submit({
			requestId: "create",
			title: "Long evidence",
			body: "Read workload",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "assign",
			id: created.id,
			expectedVersion: 1,
			handlerId: "worker",
		});
		const dispatched = await manager.dispatch({
			requestId: "dispatch",
			id: created.id,
			expectedVersion: assigned.version,
		});
		await app.runtime.waitForIdle();
		const ticket = (await manager.get(created.id)).ticket;
		await manager.setState({
			requestId: "large-report",
			id: created.id,
			expectedVersion: ticket.version,
			state: "active",
			text: "据".repeat(12000),
			links: [],
		});
		const owner = await app.people.authenticate(app.initialOwner!.token),
			registration = app.extensions.list(owner).find((row) => row.manifest.id === "rsi")!;
		const result = await app.extensions.call(owner, {
			extension: "rsi",
			generation: registration.generation,
			action: "refresh",
			requestId: "refresh-run",
			input: { id: created.id, runId: dispatched.runId },
		});
		assert.equal(
			result.state,
			"done",
			"large progress history must remain transport-readable after a native observation",
		);
		assert.equal(readTicketResult("refresh", result.value).ticket.runs[0]!.state, "done");
		assert.equal((await manager.get(created.id)).ticket.state, "active");
		assert.equal(m.f.requests.length, 1);
	} finally {
		await app?.close();
		await m.close();
	}
});

test("tickets Backend: current people roles filter records, reject foreign edits and revoke held bindings", async () => {
	const module = await backend(),
		m = await runtimeFixture();
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined, service!: NativeTicketService;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "product") },
			owner: "Owner",
			initial: [],
			extensions: [
				{ root: fileURLToPath(new URL("../dist/", import.meta.url)), facets: ["backend", "client", "webui"] },
			],
			extensionServices: async (context) => {
				service = await createTicketService({ runtime: context.runtime, namespace: "tickets" });
				return { tickets: module.ticketExtensionService(context, service) };
			},
		});
		const owner = await app.people.authenticate(app.initialOwner!.token);
		const invitation = await app.people.invite(owner, {
			requestId: "invite",
			role: "sender",
			resources: "*",
			ttlMs: 60000,
		});
		const session = await app.people.redeem(invitation.token!, "Other author"),
			other = await app.people.authenticate(session.token);
		const registration = app.extensions.list(owner).find((r) => r.manifest.id === "rsi")!;
		const call = (actor: typeof owner, action: string, requestId: string, input: ExtensionJson) =>
			app!.extensions.call(actor, {
				extension: "rsi",
				generation: registration.generation,
				action,
				requestId,
				input,
			});
		const first = await call(owner, "submit", "owner-submit", {
			title: "Private canary",
			body: "OWNER-PRIVATE-CONTENT",
			sources: [],
		});
		assert.equal(first.state, "done");
		const ticketId = readTicketResult("submit", first.value).id;
		const list = await call(other, "list", "other-list", {});
		assert.equal(JSON.stringify(list).includes("OWNER-PRIVATE-CONTENT"), false);
		assert.equal(readTicketResult("list", list.value).items.length, 0);
		const denied = await call(other, "edit", "steal", {
			id: ticketId,
			expectedVersion: 1,
			title: "Changed",
			body: "Changed",
			sources: [],
		});
		assert.throws(
			() => readTicketResult("edit", denied.value),
			(error) => error instanceof TicketCallError && error.status === "denied",
		);
		const own = await call(other, "submit", "own", { title: "Mine", body: "OTHER-CONTENT", sources: [] });
		assert.equal(readTicketResult("submit", own.value).state, "open");
		assert.equal(
			(await service.connect({ id: "reader", role: () => "manager", check() {} }).list()).items.length,
			2,
		);
		await app.people.revokePerson(owner, session.person.id);
		await assert.rejects(call(other, "list", "revoked", {}));
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.close();
	}
});
