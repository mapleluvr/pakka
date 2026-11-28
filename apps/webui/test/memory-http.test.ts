import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketMemory } from "../../server/src/pocket-memory.ts";
import { decodeExtensionResponse, type ExtensionCommandEnvelope } from "@pakka/protocol/extension-rpc";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceMemoryExtensionRoot, workspaceMemoryService } from "../src/workflows.ts";

test(
	"WebUI memory HTTP: approved context, private proposals, conflicts and both original receipt identities",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let loseReply = false;
		try {
			const prepared = createPocketMemory({
				namespace: "http.memory",
				profiles: ["default"],
				projects: [{ id: "all", name: "Approved project", resources: "*" }],
			});
			app = await startPocket({
				runtime: {
					...m.config,
					dataDir: join(m.f.root, "memory-product"),
					contextSources: [prepared.source],
				},
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				extensions: [{ root: workspaceMemoryExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => {
					const native = await workspaceMemoryService(context, prepared);
					return {
						memory: {
							...native,
							bind(actor, target, check) {
								const bound = native.bind(actor, target, check);
								return {
									...bound,
									async add(input: Parameters<typeof bound.add>[0]) {
										const result = await bound.add(input);
										if (loseReply) {
											loseReply = false;
											throw new Error("TEST LOST COMMITTED MEMORY REPLY");
										}
										return result;
									},
								};
							},
						},
					};
				},
			});
			const product = app;
			assert.ok(product.initialOwner);
			const admin = await product.people.authenticate(product.initialOwner.token);
			const ref = (await product.workspace.bind(admin).navigation())[0]!.ref;
			const tokens: string[] = [];
			for (const role of ["sender", "viewer", "sender"] as const) {
				const invitation = await product.people.invite(admin, {
					requestId: "member-" + tokens.length,
					role,
					resources: [ref.conversationId],
					ttlMs: 60000,
				});
				assert.ok(invitation.token);
				tokens.push((await product.people.redeem(invitation.token, role + "-" + tokens.length)).token);
			}
			async function exchange(token: string) {
				const response = await fetch(product.http.origin + "/pakka-webui/exchange", {
					method: "POST",
					headers: { Origin: product.http.origin, "Content-Type": "application/json" },
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
				const actor = await product.people.authenticate(login);
				return {
					Cookie: cookie,
					"X-Pakka-CSRF": csrf,
					"X-Pakka-Person": product.people.current(actor).id,
					"X-Pakka-Server": product.http.serverId,
				};
			}
			const owner = await exchange(product.initialOwner.token),
				sender = await exchange(tokens[0]!),
				viewer = await exchange(tokens[1]!),
				other = await exchange(tokens[2]!);
			async function rpc(command: ExtensionCommandEnvelope, auth = owner) {
				const requestId = crypto.randomUUID();
				const response = await fetch(product.http.origin + "/pakka-webui/extensions/rpc", {
					method: "POST",
					headers: { Origin: product.http.origin, "Content-Type": "application/json", ...auth },
					body: JSON.stringify({ version: 3, requestId, command }),
				});
				return decodeExtensionResponse(await response.json(), requestId);
			}
			const listed = await rpc({ op: "list", target: ref });
			assert.ok("result" in listed && listed.result.kind === "registrations");
			const backend = listed.result.registrations.find(
				(row) => row.facet === "backend" && row.manifest.id === "workspace-memory",
			);
			assert.ok(backend);
			const command = (
				action: string,
				input: ExtensionJson,
				requestId = crypto.randomUUID(),
			): ExtensionCommandEnvelope => ({
				op: "call",
				call: {
					extension: "workspace-memory",
					generation: backend.generation,
					target: ref,
					action,
					input,
					requestId,
				},
			});
			async function call(
				action: string,
				input: ExtensionJson,
				auth = owner,
				requestId = crypto.randomUUID(),
			) {
				const response = await rpc(command(action, input, requestId), auth);
				assert.ok("result" in response && response.result.kind === "operation");
				return response.result.operation;
			}
			async function value(action: string, input: ExtensionJson, auth = owner) {
				const operation = await call(action, input, auth);
				assert.equal(operation.state, "done");
				assert.ok(isRecord(operation.value));
				return operation.value;
			}
			const proposal = await value("add", { scope: "project", text: "HTTP-APPROVED-MEMORY-CANARY" }, sender);
			assert.ok(isRecord(proposal.lesson));
			assert.equal(proposal.lesson.pending, true);
			assert.deepEqual((await value("read", {}, viewer)).lessons, []);
			assert.deepEqual((await value("read", {}, other)).lessons, []);
			const approval = {
				id: proposal.lesson.id,
				expectedVersion: proposal.lesson.version,
				action: "approve",
			};
			const forbidden = await call("change", approval, sender);
			assert.equal(forbidden.state, "unknown");
			assert.equal(forbidden.value, undefined);
			assert.equal((await value("change", approval)).state, "done");
			const shown = await value("read", {}, viewer);
			assert.equal(shown.canWrite, false);
			assert.ok(Array.isArray(shown.lessons) && shown.lessons.length === 1);
			const host = await product.runtime.conversation(ref),
				client = host.connect("operator", ["input.submit"]);
			await client.submit({ key: "approved", text: "USE-APPROVED-MEMORY" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.ok(JSON.stringify(m.f.requests[0]).includes("HTTP-APPROVED-MEMORY-CANARY"));
			assert.equal(
				(
					await value("change", {
						id: proposal.lesson.id,
						expectedVersion: proposal.lesson.version,
						action: "edit",
						text: "STALE-CANNOT-OVERWRITE",
					})
				).state,
				"conflict",
			);
			assert.ok(JSON.stringify(await value("read", {})).includes("HTTP-APPROVED-MEMORY-CANARY"));
			loseReply = true;
			const originalId = crypto.randomUUID(),
				lost = await call("add", { scope: "global", text: "RECOVER-ONE-MEMORY-MUTATION" }, owner, originalId);
			assert.equal(lost.state, "unknown");
			const query: ExtensionCommandEnvelope = {
				op: "operationByRequest",
				request: { extension: "workspace-memory", requestId: originalId, target: ref },
			};
			const outer = await rpc(query);
			assert.ok("result" in outer && outer.result.kind === "operation");
			assert.equal(outer.result.operation.id, lost.id);
			const inner = await value("operation", { requestId: lost.id });
			assert.equal(inner.state, "done");
			assert.ok(isRecord(inner.lesson));
			assert.equal(inner.lesson.text, "RECOVER-ONE-MEMORY-MUTATION");
			const wrongIdentity = await call("operation", { requestId: originalId });
			assert.equal(wrongIdentity.state, "unknown");
			assert.equal(wrongIdentity.value, undefined);
			const foreign = await rpc(query, viewer);
			assert.ok("error" in foreign && foreign.error.outcome === "denied");
			assert.equal((await call("operation", { requestId: lost.id }, viewer)).state, "unknown");
			const writeDenied = await rpc(
				command("add", { scope: "global", text: "FORGED-VIEWER-MEMORY" }),
				viewer,
			);
			assert.ok("error" in writeDenied && writeDenied.error.outcome === "denied");
			const saved = await value("read", {});
			assert.ok(Array.isArray(saved.lessons) && saved.lessons.length === 2);
			await value("activation", { enabled: false });
			await client.submit({ key: "paused", text: "AFTER-MEMORY-PAUSED" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			assert.ok(!JSON.stringify(m.f.requests[1]).includes("HTTP-APPROVED-MEMORY-CANARY"));
			assert.ok(!JSON.stringify(m.f.requests[1]).includes("RECOVER-ONE-MEMORY-MUTATION"));
			assert.deepEqual(m.f.errors, []);
		} finally {
			await app?.close();
			await m.close();
		}
	},
);
