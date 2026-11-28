import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createServer, request as forward } from "node:http";
import { listenHttp } from "@pakka/server/http-listener";
import { createPocketSchedules } from "@pakka/server/pocket";
import {
	decodeExtensionRequest,
	decodeExtensionResponse,
	type ExtensionCommandEnvelope,
} from "@pakka/protocol/extension-rpc";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceSchedulesExtensionRoot, workspaceSchedulesService } from "../src/workflows.ts";

// Preserve the original browser regressions' cross-layer identity/effect checks at the real HTTP boundary.
// The proxy closes an actual socket only after the product has finished its response; no handler is replayed.
test(
	"WebUI schedules HTTP: lost replies and writer reopen retain original operations; cancel and reads do not submit again",
	{ timeout: 25000 },
	async (t) => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let sessionFile: string | undefined;
		const dataDir = join(m.f.root, "schedules-product");
		const current = () => {
			assert.ok(app);
			return app;
		};
		const start = async () => {
			const prepared = createPocketSchedules({ namespace: "http.schedules", maxSchedules: 8 });
			return startPocket({
				runtime: {
					...m.config,
					dataDir,
					jobs: [prepared.definition],
					...(sessionFile ? { reopenSessionFile: sessionFile } : {}),
				},
				owner: "Owner",
				initial: [{ name: "Scheduled project", profile: "default" }],
				extensions: [{ root: workspaceSchedulesExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => ({
					schedules: await workspaceSchedulesService(context, prepared),
				}),
			});
		};
		let dropAction = "",
			drops = 0,
			adds = 0,
			cancels = 0,
			lookups = 0;
		const proxyErrors: string[] = [];
		const proxy = createServer((request, response) => {
			void (async () => {
				const chunks: Buffer[] = [];
				for await (const chunk of request) chunks.push(Buffer.from(chunk));
				const bytes = Buffer.concat(chunks);
				const command = decodeExtensionRequest(JSON.parse(bytes.toString("utf8"))).command;
				const action = command.op === "call" ? command.call.action : "";
				if (action === "add") adds++;
				if (action === "cancel") cancels++;
				if (command.op === "operationByRequest") lookups++;
				const drop = action !== "" && action === dropAction;
				if (drop) dropAction = "";
				const origin = current().http.origin;
				const remote = forward(
					origin + request.url,
					{ method: request.method, headers: { ...request.headers, host: new URL(origin).host } },
					(incoming) => {
						if (drop) {
							incoming.resume();
							incoming.once("end", () => {
								drops++;
								response.destroy();
							});
						} else {
							response.writeHead(incoming.statusCode ?? 502, incoming.headers);
							incoming.pipe(response);
						}
					},
				);
				remote.on("error", (error) => {
					proxyErrors.push(error.message);
					response.destroy(error);
				});
				response.once("close", () => remote.destroy());
				remote.end(bytes);
			})().catch((error) => {
				proxyErrors.push(String(error));
				response.destroy(error);
			});
		});
		try {
			app = await start();
			const { port } = await listenHttp(proxy, { host: "127.0.0.1" });
			const proxyOrigin = `http://127.0.0.1:${port}`;
			assert.ok(app.initialOwner);
			const owner = await app.people.authenticate(app.initialOwner.token);
			const originalRef = (await app.workspace.bind(owner).navigation())[0]!.ref;
			const invitation = await app.people.invite(owner, {
				requestId: "viewer",
				role: "viewer",
				resources: [originalRef.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewerSession = await app.people.redeem(invitation.token, "Viewer");
			async function exchange(token: string) {
				const origin = current().http.origin;
				const response = await fetch(origin + "/pakka-webui/exchange", {
					method: "POST",
					headers: { Origin: origin, "Content-Type": "application/json" },
					body: JSON.stringify({ kind: "session", token }),
				});
				assert.equal(response.status, 200);
				const cookie = response.headers
					.getSetCookie()
					.map((value) => value.split(";")[0]!)
					.join("; ");
				const csrf = /pakka_csrf=([^;]+)/.exec(cookie)?.[1],
					login = /pakka_pocket=([^;]+)/.exec(cookie)?.[1];
				assert.ok(csrf && login);
				const actor = await current().people.authenticate(login);
				return { Cookie: cookie, "X-Pakka-CSRF": csrf, "X-Pakka-Person": current().people.current(actor).id };
			}
			const ownerAuth = await exchange(app.initialOwner.token),
				viewerAuth = await exchange(viewerSession.token);
			async function rpc(command: ExtensionCommandEnvelope, auth = ownerAuth) {
				const requestId = crypto.randomUUID(),
					product = current();
				const response = await fetch(proxyOrigin + "/pakka-webui/extensions/rpc", {
					method: "POST",
					headers: {
						Origin: product.http.origin,
						"Content-Type": "application/json",
						"X-Pakka-Server": product.http.serverId,
						...auth,
					},
					body: JSON.stringify({ version: 3, requestId, command }),
				});
				return decodeExtensionResponse(await response.json(), requestId);
			}
			const registration = async () => {
				const listed = await rpc({ op: "list", target: originalRef });
				assert.ok("result" in listed && listed.result.kind === "registrations");
				const result = listed.result.registrations.find(
					(row) => row.facet === "backend" && row.manifest.id === "workspace-schedules",
				);
				assert.ok(result);
				return result;
			};
			let backend = await registration();
			const command = (
				action: string,
				input: ExtensionJson,
				requestId = crypto.randomUUID(),
			): ExtensionCommandEnvelope => ({
				op: "call",
				call: {
					extension: "workspace-schedules",
					generation: backend.generation,
					target: originalRef,
					action,
					input,
					requestId,
				},
			});
			async function call(action: string, input: ExtensionJson, auth = ownerAuth) {
				const response = await rpc(command(action, input), auth);
				assert.ok("result" in response && response.result.kind === "operation");
				assert.equal(response.result.operation.state, "done");
				assert.ok(isRecord(response.result.operation.value));
				return response.result.operation.value;
			}
			const requestId = crypto.randomUUID(),
				input = { text: "HTTP-ONCE-AFTER-LOST-SCHEDULE-REPLY", dueAt: Date.now() + 3000 };
			dropAction = "add";
			await assert.rejects(rpc(command("add", input, requestId)), /fetch failed/);
			assert.equal(drops, 1);
			assert.equal(adds, 1);
			assert.equal(m.f.requests.length, 0);
			const query: ExtensionCommandEnvelope = {
				op: "operationByRequest",
				request: { extension: "workspace-schedules", requestId, target: originalRef },
			};
			const found = await rpc(query);
			assert.ok("result" in found && found.result.kind === "operation");
			const original = found.result.operation;
			assert.equal(original.state, "done");
			assert.ok(isRecord(original.value) && typeof original.value.jobId === "string");
			assert.equal(
				original.value.requestId,
				original.id,
				"service identity is the extension operation, not the browser request",
			);
			assert.equal(original.value.text, input.text);
			const jobId = original.value.jobId;
			sessionFile = app.runtime.view().sessionFile;
			await app.close();
			app = await start();
			backend = await registration();
			const recovered = await rpc(query);
			assert.ok("result" in recovered && recovered.result.kind === "operation");
			assert.deepEqual(recovered.result.operation, original);
			await t.waitFor(
				async () => {
					const view = await call("list", {});
					assert.ok(
						Array.isArray(view.schedules) && view.schedules.length === 1 && isRecord(view.schedules[0]),
					);
					assert.equal(view.schedules[0].state, "done");
					assert.equal(view.schedules[0].completed, 1);
					assert.equal(view.schedules[0].jobId, jobId);
				},
				{ timeout: 8000 },
			);
			await app.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.ok(JSON.stringify(m.f.requests[0]).includes(input.text));
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			assert.equal(adds, 1, "original queries never resubmit a schedule");
			assert.equal(lookups, 2);
			const history = await call("deliveries", { id: original.value.id });
			assert.equal(history.originalBinding, true);
			assert.ok(Array.isArray(history.items) && history.items.length === 1);
			assert.ok(isRecord(history.items[0]) && history.items[0].status === "done");
			const foreignHistory = await rpc(command("deliveries", { id: original.value.id }), viewerAuth);
			assert.ok(
				"error" in foreignHistory ||
					(foreignHistory.result.kind === "operation" && foreignHistory.result.operation.state !== "done"),
			);
			const readOnly = await call("list", {}, viewerAuth);
			assert.equal(readOnly.canWrite, false);
			assert.ok(Array.isArray(readOnly.schedules) && readOnly.schedules.length === 1);
			const foreign = await rpc(query, viewerAuth);
			assert.ok("error" in foreign && foreign.error.outcome === "denied");
			const denied = await rpc(
				command("add", { text: "FORGED-VIEWER-WORK", dueAt: Date.now() + 60000 }),
				viewerAuth,
			);
			assert.ok("error" in denied && denied.error.outcome === "denied");
			const cancelRow = await call("add", { text: "NO-EFFECT-AFTER-CANCEL", dueAt: Date.now() + 60000 });
			assert.equal(typeof cancelRow.id, "string");
			const cancelId = crypto.randomUUID();
			dropAction = "cancel";
			await assert.rejects(rpc(command("cancel", { id: cancelRow.id }, cancelId)), /fetch failed/);
			const cancelled = await rpc({
				op: "operationByRequest",
				request: { extension: "workspace-schedules", requestId: cancelId, target: originalRef },
			});
			assert.ok("result" in cancelled && cancelled.result.kind === "operation");
			assert.equal(cancelled.result.operation.state, "done");
			const result = cancelled.result.operation.value;
			assert.ok(isRecord(result));
			assert.equal(result.id, cancelRow.id);
			assert.equal(
				result.cancellationRequested,
				true,
				"the original result confirms intent, not synchronous native termination",
			);
			await t.waitFor(
				async () => {
					const view = await call("list", {});
					assert.ok(Array.isArray(view.schedules));
					const currentRow = view.schedules.find((row) => isRecord(row) && row.id === cancelRow.id);
					assert.ok(isRecord(currentRow));
					assert.equal(currentRow.cancellationRequested, true);
					assert.equal(currentRow.state, "cancelled");
					assert.equal(currentRow.nativeTerminal, "aborted");
				},
				{ timeout: 3000 },
			);
			const originalAgain = await rpc({
				op: "operationByRequest",
				request: { extension: "workspace-schedules", requestId: cancelId, target: originalRef },
			});
			assert.ok("result" in originalAgain && originalAgain.result.kind === "operation");
			assert.deepEqual(
				originalAgain.result.operation,
				cancelled.result.operation,
				"later native termination does not rewrite the original response",
			);
			assert.equal(cancels, 1);
			assert.equal(drops, 2);
			assert.equal(m.f.requests.length, 1);
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			assert.deepEqual(proxyErrors, []);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await new Promise<void>((resolve) => {
				proxy.close(() => resolve());
				proxy.closeAllConnections();
			});
			await app?.close();
			await m.close();
		}
	},
);
