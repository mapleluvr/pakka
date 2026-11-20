import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer, request as forward } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { listenHttp } from "@pakka/server/http-listener";
import {
	decodeExtensionRequest,
	decodeExtensionResponse,
	type ExtensionCommandEnvelope,
	type ExtensionResponse,
} from "@pakka/protocol/extension-rpc";
import { isRecord, type ExtensionJson, type ExtensionOperation } from "@pakka/protocol/extensions";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceHooksExtensionRoot, workspaceHooksService } from "../src/workflows.ts";
import definition from "../contributions/hooks/manifest.json" with { type: "json" };

// Retain the former browser regression's native effects, signature, privacy and permission checks.
// Actual UI interaction is verified against the independent frontend, not the retired renderer.
test(
	"Webhook HTTP: exact original recovery survives configuration and reopen without retargeting ingress or replaying effects",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture({ profiles: [{ id: "alternate", systemPrompt: "ALTERNATE-HOOK-PROBE" }] });
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, sessionFile: string | undefined;
		let lateRotation = false,
			dropAction = "",
			drops = 0;
		const writes = { create: 0, rotate: 0, remove: 0 },
			proxyErrors: string[] = [],
			returns: Promise<void>[] = [];
		const dataDir = join(m.f.root, "hooks-product");
		const current = () => {
			assert.ok(app);
			return app;
		};
		const rotation = definition.actions.find((action) => action.id === "rotate");
		assert.ok(rotation);
		const rotationDelay = rotation.timeoutMs + 150;
		async function start() {
			return startPocket({
				runtime: { ...m.config, dataDir, ...(sessionFile ? { reopenSessionFile: sessionFile } : {}) },
				owner: "Owner",
				profiles: ["default", "alternate"],
				initial: [{ name: "Hook project", profile: "default" }],
				extensions: [{ root: workspaceHooksExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => {
					const native = await workspaceHooksService(context, {
						namespace: "http.hooks",
						githubWriters: ["approved-writer"],
					});
					return {
						hooks: {
							...native,
							bind(...args: Parameters<typeof native.bind>) {
								const client = native.bind(...args);
								return Object.freeze({
									...client,
									create: async (...input: Parameters<typeof client.create>) => {
										writes.create++;
										return client.create(...input);
									},
									remove: async (...input: Parameters<typeof client.remove>) => {
										writes.remove++;
										return client.remove(...input);
									},
									rotate: async (...input: Parameters<typeof client.rotate>) => {
										writes.rotate++;
										const result = await client.rotate(...input);
										if (lateRotation) {
											lateRotation = false;
											const waiting = delay(rotationDelay);
											returns.push(waiting);
											await waiting;
										}
										return result;
									},
								});
							},
						},
					};
				},
			});
		}
		const proxy = createServer((request, response) => {
			void (async () => {
				const chunks: Buffer[] = [];
				for await (const chunk of request) chunks.push(Buffer.from(chunk));
				const bytes = Buffer.concat(chunks),
					command = decodeExtensionRequest(JSON.parse(bytes.toString("utf8"))).command;
				const action = command.op === "call" ? command.call.action : "";
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
			const { port } = await listenHttp(proxy, { host: "127.0.0.1" }),
				proxyOrigin = "http://127.0.0.1:" + port;
			assert.ok(app.initialOwner);
			const initialActor = await app.people.authenticate(app.initialOwner.token),
				originalRef = (await app.workspace.bind(initialActor).list())[0]!;
			const invitation = await app.people.invite(initialActor, {
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
						.join("; "),
					csrf = /pakka_csrf=([^;]+)/.exec(cookie)?.[1],
					login = /pakka_pocket=([^;]+)/.exec(cookie)?.[1];
				assert.ok(csrf && login);
				const actor = await current().people.authenticate(login);
				return { Cookie: cookie, "X-Pakka-CSRF": csrf, "X-Pakka-Person": current().people.current(actor).id };
			}
			const ownerAuth = await exchange(app.initialOwner.token),
				viewerAuth = await exchange(viewerSession.token);
			const owner = async () => {
				const token = /pakka_pocket=([^;]+)/.exec(ownerAuth.Cookie)?.[1];
				assert.ok(token);
				return current().people.authenticate(token);
			};
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
			function operation(reply: ExtensionResponse): ExtensionOperation {
				assert.ok("result" in reply && reply.result.kind === "operation");
				return reply.result.operation;
			}
			function changed(result: ExtensionOperation) {
				assert.equal(result.state, "done");
				const value = result.value;
				assert.ok(isRecord(value) && value.state === "done" && isRecord(value.hook));
				const hook = value.hook;
				assert.ok(typeof hook.id === "string" && typeof hook.version === "number");
				return { value, id: hook.id, version: hook.version, target: hook.target };
			}
			let ref = originalRef;
			const registration = async () => {
				const listed = await rpc({ op: "list", target: ref });
				assert.ok("result" in listed && listed.result.kind === "registrations");
				const result = listed.result.registrations.find(
					(row) => row.facet === "backend" && row.manifest.id === "workspace-hooks",
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
					extension: "workspace-hooks",
					generation: backend.generation,
					target: ref,
					action,
					input,
					requestId,
				},
			});
			async function call(action: string, input: ExtensionJson) {
				const result = operation(await rpc(command(action, input)));
				assert.equal(result.state, "done");
				return result;
			}
			async function secret(id: string) {
				const value = (await call("credentials", { id })).value;
				assert.ok(
					isRecord(value) && typeof value.secret === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.secret),
				);
				return value.secret;
			}
			const firstRequest = crypto.randomUUID(),
				firstInput = {
					name: "Before configuration",
					instructions: "Report build.",
					signed: true,
					allowOutside: false,
				};
			dropAction = "create";
			await assert.rejects(rpc(command("create", firstInput, firstRequest)), /fetch failed/);
			assert.equal(drops, 1);
			assert.equal(writes.create, 1);
			const nextDirectory = join(m.f.cwd, "changed");
			await mkdir(nextDirectory);
			ref = await current()
				.workspace.bind(await owner())
				.configureAgent(ref, { cwd: nextDirectory });
			assert.notEqual(ref.incarnation, originalRef.incarnation);
			backend = await registration();
			const query: ExtensionCommandEnvelope = {
				op: "operationByRequest",
				request: { extension: "workspace-hooks", requestId: firstRequest, target: originalRef },
			};
			const recovered = operation(await rpc(query)),
				first = changed(recovered);
			assert.deepEqual(first.target, originalRef);
			const listing = (await call("read", {})).value;
			assert.ok(isRecord(listing) && Array.isArray(listing.hooks));
			assert.equal(listing.hooks.length, 1);
			assert.deepEqual((await call("operation", { requestId: recovered.id })).value, first.value);
			// The old binding is valid only for finding its stored original, never for new effects.
			assert.ok(
				"error" in
					(await rpc({
						op: "operationByRequest",
						request: { extension: "workspace-hooks", requestId: firstRequest, target: ref },
					})),
			);
			assert.ok(
				"error" in
					(await rpc({
						op: "call",
						call: {
							extension: "workspace-hooks",
							generation: backend.generation,
							action: "create",
							input: firstInput,
							requestId: crypto.randomUUID(),
							target: originalRef,
						},
					})),
			);
			assert.ok("error" in (await rpc(query, viewerAuth)));
			assert.equal(writes.create, 1);
			assert.equal(m.f.requests.length, 0);
			const cleaned = changed(await call("remove", { id: first.id, expectedVersion: first.version }));
			assert.deepEqual(cleaned.target, originalRef);
			assert.deepEqual((await call("operation", { requestId: recovered.id })).value, first.value);
			const removedListing = (await call("read", {})).value;
			assert.ok(isRecord(removedListing) && Array.isArray(removedListing.hooks));
			assert.equal(removedListing.hooks.length, 0);

			const signed = changed(
				await call("create", {
					name: "Build events",
					instructions: "Report build.",
					signed: true,
					allowOutside: false,
				}),
			);
			const originalSecret = await secret(signed.id),
				signedRef = ref;
			const body = Buffer.from(
				JSON.stringify({ ref: "refs/heads/main", commits: [{ message: "HTTP-HOOK-FIRST" }] }),
			);
			const post = async (key: string, bytes: Buffer, delivery: string) =>
				fetch(current().http.origin + "/pakka-webui/ingress/workspace-hooks/hooks/" + signed.id, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-github-event": "push",
						"x-github-delivery": delivery,
						"x-hub-signature-256": "sha256=" + createHmac("sha256", key).update(bytes).digest("hex"),
					},
					body: new Uint8Array(bytes),
				});
			assert.equal((await post(originalSecret, body, "first")).status, 202);
			await current().runtime.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.match(JSON.stringify(m.f.requests[0]), /HTTP-HOOK-FIRST/);
			assert.equal((await post(originalSecret, body, "changed-unsigned-header")).status, 202);
			assert.equal(m.f.requests.length, 1);
			lateRotation = true;
			const rotateRequest = crypto.randomUUID(),
				unknown = operation(
					await rpc(command("rotate", { id: signed.id, expectedVersion: signed.version }, rotateRequest)),
				);
			assert.equal(unknown.state, "unknown");
			assert.equal(writes.rotate, 1);
			await Promise.all(returns);
			const currentSecret = await secret(signed.id);
			assert.notEqual(currentSecret, originalSecret);
			const secondBody = Buffer.from(
				JSON.stringify({ ref: "refs/heads/main", commits: [{ message: "HTTP-HOOK-SECOND" }] }),
			);
			assert.equal((await post(originalSecret, secondBody, "old-key")).status, 404);
			assert.equal((await post(currentSecret, secondBody, "second")).status, 202);
			await current().runtime.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			ref = await current()
				.workspace.bind(await owner())
				.configure(ref, "alternate");
			assert.notEqual(ref.incarnation, signedRef.incarnation);
			assert.equal(
				(await post(currentSecret, Buffer.from('{"message":"do-not-retarget"}'), "after-preset")).status,
				404,
			);
			sessionFile = current().runtime.view().sessionFile;
			await current().close();
			app = await start();
			backend = await registration();
			const found = operation(
				await rpc({
					op: "operationByRequest",
					request: { extension: "workspace-hooks", requestId: rotateRequest, target: signedRef },
				}),
			);
			assert.equal(found.id, unknown.id);
			assert.equal(found.state, "unknown");
			const inner = (await call("operation", { requestId: found.id })).value;
			assert.ok(isRecord(inner) && inner.state === "done" && isRecord(inner.hook));
			assert.equal(inner.hook.id, signed.id);
			assert.equal(inner.hook.version, signed.version + 1);
			assert.deepEqual(inner.hook.target, signedRef);
			assert.equal(writes.rotate, 1);
			assert.equal(m.f.requests.length, 2);
			const savedDeliveries = (await call("deliveries", { id: signed.id })).value;
			assert.ok(Array.isArray(savedDeliveries));
			assert.equal(savedDeliveries.length, 2);
			const viewerRead = operation(await rpc(command("read", {}), viewerAuth)).value;
			assert.ok(isRecord(viewerRead) && Array.isArray(viewerRead.hooks));
			assert.equal(viewerRead.hooks.length, 0);
			assert.equal(viewerRead.canManage, false);
			assert.ok("error" in (await rpc(command("credentials", { id: signed.id }), viewerAuth)));
			assert.ok(
				"error" in
					(await rpc(command("remove", { id: signed.id, expectedVersion: signed.version + 1 }), viewerAuth)),
			);
			assert.ok("error" in (await rpc({ op: "operation", id: found.id }, viewerAuth)));
			changed(await call("remove", { id: signed.id, expectedVersion: signed.version + 1 }));
			assert.equal((await post(currentSecret, secondBody, "after-removal")).status, 404);
			assert.deepEqual(writes, { create: 2, rotate: 1, remove: 2 });
			const extensionState = await current()
				.runtime.store({ namespace: "pocket.extensions", maxBytes: 1048576 })
				.snapshot();
			for (const value of [originalSecret, currentSecret]) {
				assert.equal(JSON.stringify(extensionState.data).includes(value), false);
				assert.equal(JSON.stringify(m.f.requests).includes(value), false);
			}
			assert.equal(current().runtime.view().budget.primaryAttempts, 2);
			assert.deepEqual(proxyErrors, []);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await Promise.all(returns);
			await new Promise<void>((resolve) => proxy.close(() => resolve()));
			await app?.close();
			await m.close();
		}
	},
);
