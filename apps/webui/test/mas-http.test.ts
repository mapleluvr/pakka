import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createMas, type Mas } from "@pakka/mas";
import { masExtensionRoot, masWorkbenchService } from "@pakka/mas-devpack/backend";
import type { AgentRef } from "@pakka/protocol/pocket";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred, text } from "../../../packages/agent/test/fixture.ts";
import { startPocket, type PocketProductOptions } from "../src/bootstrap.ts";
import { loginHttpSession, connectHttpSession } from "./fixtures/http-session.ts";

test(
	"MAS HTTP: native queued modes, abort, scoped receipts and UI removal preserve original work across reopen",
	{ timeout: 45000 },
	async (t) => {
		const release = deferred(),
			abortRelease = deferred(),
			removalRelease = deferred();
		let first = true,
			aborting = false,
			removing = false;
		const m = await runtimeFixture({}, undefined, async (payload) => {
			if (first) {
				first = false;
				await release.promise;
			} else if (text(payload).includes("HTTP-ABORT") && !aborting) {
				aborting = true;
				await abortRelease.promise;
			} else if (text(payload).includes("HTTP-REMOVE-UI") && !removing) {
				removing = true;
				await removalRelease.promise;
			}
			return { text: "MAS-HTTP-DONE" };
		});
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, mas: Mas | undefined;
		const options: PocketProductOptions = {
			runtime: { ...m.config, dataDir: join(m.f.root, "mas-http") },
			owner: "Owner",
			initial: [{ name: "Ordinary", profile: "default" }],
			extensions: [{ root: masExtensionRoot }],
			extensionServices: async (context) => {
				mas = await createMas({
					runtime: context.runtime,
					namespace: "http.team",
					maxDeliveries: 32,
					maxPending: 8,
				});
				await mas.bootstrap([
					{ key: "visible", owner: context.ownerId },
					{ key: "PRIVATE-TEAM-CANARY", owner: context.ownerId },
				]);
				await mas.activate();
				return { mas: masWorkbenchService({ ...context, mas }) };
			},
		};
		try {
			app = await startPocket(options);
			assert.ok(app.initialOwner && mas);
			const product = app,
				admin = await product.people.authenticate(product.initialOwner!.token);
			const members = (await mas.view()).members,
				visible = members.find((row) => row.key === "visible")!,
				hidden = members.find((row) => row.key === "PRIVATE-TEAM-CANARY")!;
			const invite = await app.people.invite(admin, {
				requestId: "reader",
				role: "viewer",
				resources: [visible.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const owner = await loginHttpSession(app.http.origin, app.initialOwner.token);
			const viewer = await loginHttpSession(
				app.http.origin,
				(await app.people.redeem(invite.token, "Viewer")).token,
			);
			const listed = (await owner.extensions({ op: "list" })).decoded;
			assert.ok("result" in listed && listed.result.kind === "registrations");
			const backend = listed.result.registrations.find(
					(row) => row.manifest.id === "mas-devpack" && row.facet === "backend",
				)!,
				ui = listed.result.registrations.find(
					(row) => row.manifest.id === "mas-devpack" && row.facet === "webui",
				)!;
			assert.ok(backend && ui);
			const command = (
				action: string,
				input: ExtensionJson,
				target?: AgentRef,
				requestId = crypto.randomUUID(),
			) => ({
				op: "call" as const,
				call: { extension: "mas-devpack", generation: backend.generation, action, input, target, requestId },
			});
			async function call(
				action: string,
				input: ExtensionJson,
				target?: AgentRef,
				client = owner,
				requestId = crypto.randomUUID(),
			) {
				const reply = (await client.extensions(command(action, input, target, requestId))).decoded;
				assert.ok("result" in reply && reply.result.kind === "operation");
				assert.equal(reply.result.operation.state, "done");
				return reply.result.operation;
			}
			async function value(action: string, input: ExtensionJson, target?: AgentRef, client = owner) {
				const operation = await call(action, input, target, client);
				assert.ok(isRecord(operation.value));
				return operation.value;
			}
			const restricted = await value("view", {}, undefined, viewer);
			assert.ok(Array.isArray(restricted.members) && restricted.members.length === 1);
			assert.ok(!JSON.stringify(restricted).includes("PRIVATE-TEAM-CANARY"));
			assert.ok(
				!JSON.stringify(restricted).includes('"conversationId":' + JSON.stringify(hidden.ref.conversationId)),
			);
			for (const action of ["send", "abort", "retire"] as const) {
				const denied = (
					await viewer.extensions(command(action, action === "send" ? { text: "DENIED" } : {}, visible.ref))
				).decoded;
				assert.ok("error" in denied && denied.error.outcome === "denied");
			}
			assert.equal(m.f.requests.length, 0);
			const originalId = crypto.randomUUID();
			const sent = await call("send", { text: "HTTP-NATIVE-START" }, visible.ref, owner, originalId);
			assert.ok(isRecord(sent.value) && typeof sent.value.id === "string");
			const receiptId = sent.value.id;
			await t.waitFor(() => assert.equal(m.f.requests.length, 1), { timeout: 5000, interval: 10 });
			assert.equal(JSON.stringify(m.f.requests[0]!.tools ?? []).includes("mas_spawn"), false);
			const query = {
				op: "operationByRequest" as const,
				request: { extension: "mas-devpack", requestId: originalId, target: visible.ref },
			};
			const found = (await owner.extensions(query)).decoded;
			assert.ok("result" in found && found.result.kind === "operation");
			assert.equal(found.result.operation.id, sent.id);
			assert.deepEqual(found.result.operation.value, sent.value);
			const foreign = (await viewer.extensions(query)).decoded;
			assert.ok("error" in foreign && foreign.error.outcome === "denied");
			const queued: string[] = [];
			for (const [mode, message] of [
				["steer", "HTTP-NATIVE-STEER"],
				["followUp", "HTTP-NATIVE-FOLLOWUP"],
			]) {
				const result = await value("steer", { mode: mode!, text: message! }, visible.ref);
				assert.equal(result.status, "queued");
				assert.equal(typeof result.id, "string");
				queued.push(String(result.id));
				assert.equal(m.f.requests.length, 1);
			}
			release.resolve();
			const catalog = product.runtime.catalog({ namespace: "http.team", maxDeliveries: 32, maxPending: 8 });
			for (const id of [receiptId, ...queued])
				assert.equal((await catalog.wait(id, () => {})).status, "done");
			assert.match(JSON.stringify(m.f.requests.slice(1)), /HTTP-NATIVE-STEER/);
			assert.match(JSON.stringify(m.f.requests.slice(1)), /HTTP-NATIVE-FOLLOWUP/);
			const beforeAbort = m.f.requests.length;
			const abort = await value("send", { text: "HTTP-ABORT" }, visible.ref);
			assert.equal(typeof abort.id, "string");
			await t.waitFor(() => assert.equal(aborting, true), { timeout: 5000, interval: 10 });
			assert.equal(m.f.requests.length, beforeAbort + 1);
			assert.equal((await value("abort", {}, visible.ref)).phase, "active");
			await t.waitFor(
				async () => assert.equal((await catalog.receipt(String(abort.id), () => {})).reason, "aborted"),
				{ timeout: 5000, interval: 10 },
			);
			assert.equal((await catalog.receipt(String(abort.id), () => {})).status, "unanswered");
			assert.equal((await product.runtime.readConversation(visible.ref, () => {})).live.busy, false);
			abortRelease.resolve();
			const pending = await value("send", { text: "HTTP-REMOVE-UI" }, visible.ref);
			assert.equal(typeof pending.id, "string");
			await t.waitFor(() => assert.equal(removing, true), { timeout: 5000, interval: 10 });
			const count = m.f.requests.length;
			const disabled = (
				await owner.extensions({
					op: "control",
					change: {
						extension: "mas-devpack",
						facet: "webui",
						action: "disable",
						expectedGeneration: ui.generation,
						requestId: "remove-view",
					},
				})
			).decoded;
			assert.ok("result" in disabled && disabled.result.kind === "control");
			assert.equal((await catalog.receipt(String(pending.id), () => {})).status, "placed");
			assert.equal((await product.runtime.readConversation(visible.ref, () => {})).live.busy, true);
			assert.deepEqual((await mas.view()).members, members);
			assert.equal(m.f.requests.length, count);
			assert.ok(!JSON.stringify(await value("view", {}, undefined, viewer)).includes("PRIVATE-TEAM-CANARY"));
			removalRelease.resolve();
			assert.equal((await catalog.wait(String(pending.id), () => {})).status, "done");
			assert.match(
				JSON.stringify((await product.runtime.readConversation(visible.ref, () => {})).entries),
				/MAS-HTTP-DONE/,
			);
			const original = product.runtime.view();
			await product.close();
			app = await startPocket({
				...options,
				runtime: { ...options.runtime, reopenSessionFile: original.sessionFile },
				extensions: [],
			});
			assert.equal(app.runtime.view().sessionId, original.sessionId);
			assert.equal(app.initialOwner, null);
			assert.deepEqual((await mas.view()).members, members);
			assert.equal(
				(
					await app.runtime
						.catalog({ namespace: "http.team", maxDeliveries: 32, maxPending: 8 })
						.receipt(String(pending.id), () => {})
				).status,
				"done",
			);
			const resumed = await connectHttpSession(app.http.origin, owner.cookies);
			const registrations = (await resumed.extensions({ op: "list" })).decoded;
			assert.ok("result" in registrations && registrations.result.kind === "registrations");
			assert.deepEqual(registrations.result.registrations, []);
			const navigation = (await resumed.workbench({ op: "list" })).decoded;
			assert.ok("result" in navigation && navigation.result.kind === "list");
			const ordinary = navigation.result.conversations.find(
				(ref) => ref.key !== "visible" && ref.key !== "PRIVATE-TEAM-CANARY",
			);
			assert.ok(ordinary);
			const input = (
				await resumed.workbench({
					op: "submit",
					target: ordinary,
					input: { requestId: "ordinary-after-removal", text: "NORMAL-WORK", mode: "prompt" },
				})
			).decoded;
			assert.ok("result" in input && input.result.kind === "receipt");
			const done = (await resumed.workbench({ op: "wait", id: input.result.receipt.id })).decoded;
			assert.ok("result" in done && done.result.kind === "receipt" && done.result.receipt.status === "done");
			assert.equal(m.f.requests.length, count + 1);
			assert.deepEqual(m.f.errors, []);
		} finally {
			release.resolve();
			abortRelease.resolve();
			removalRelease.resolve();
			await app?.close();
			await m.f.close();
		}
	},
);
