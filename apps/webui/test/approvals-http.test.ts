import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import type { ConversationRef } from "@pakka/agent";
import { approvalTool, createPocketApprovals, type PocketApprovals } from "@pakka/server/pocket";
import { decodeExtensionResponse, type ExtensionCommandEnvelope } from "@pakka/protocol/extension-rpc";
import { isRecord } from "@pakka/protocol/extensions";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceApprovalsExtensionRoot, workspaceApprovalsService } from "../src/workflows.ts";

test(
	"WebUI approvals HTTP: decisions release the original tool, receipts are read-only, and viewers cannot decide",
	{ timeout: 20000 },
	async (t) => {
		let approvals!: PocketApprovals,
			target!: ConversationRef,
			effects = 0;
		const tool = approvalTool(
			{
				name: "human_approved_write",
				description: "Local file effect requiring approval",
				parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
				execute: async (args: Record<string, unknown>) => {
					effects++;
					await writeFile(join(m.f.cwd, "human-effect.txt"), String(args.text));
					return "HUMAN-APPROVED-TOOL-DONE";
				},
			},
			() => ({ approvals, target }),
		);
		const m = await runtimeFixture({ tools: [tool] }, undefined, (payload) =>
			payload.messages.at(-1)?.role === "tool"
				? { text: "APPROVAL-WORK-FINISHED" }
				: { tool: "human_approved_write", args: { text: "ORIGINAL-TOOL-PAYLOAD" } },
		);
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "approval-product") },
				owner: "Owner",
				initial: [{ name: "Approved work", profile: "default" }],
				extensions: [{ root: workspaceApprovalsExtensionRoot, facets: ["backend", "webui", "client"] }],
				extensionServices: async (context) => {
					approvals = await createPocketApprovals({
						runtime: context.runtime,
						people: context.people,
						notifications: context.notifications,
						namespace: "http.approvals",
						timeoutMs: 15000,
					});
					target = context.runtime.view().conversations.at(-1)!;
					return { approvals: workspaceApprovalsService(approvals) };
				},
			});
			assert.ok(app.initialOwner);
			const product = app,
				admin = await product.people.authenticate(app.initialOwner.token),
				invite = await product.people.invite(admin, {
					requestId: "read-only",
					role: "viewer",
					resources: [target.conversationId],
					ttlMs: 60000,
				});
			assert.ok(invite.token);
			const viewerSession = await product.people.redeem(invite.token, "Viewer");
			async function exchange(token: string) {
				const response = await fetch(product.http.origin + "/pakka-webui/exchange", {
					method: "POST",
					headers: { Origin: product.http.origin, "Content-Type": "application/json" },
					body: JSON.stringify({ kind: "session", token }),
				});
				assert.equal(response.status, 200);
				const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]!);
				const csrf = cookies.find((value) => value.startsWith("pakka_csrf="))?.slice("pakka_csrf=".length);
				assert.ok(csrf);
				const tokenValue = cookies
					.find((value) => value.startsWith("pakka_pocket="))
					?.slice("pakka_pocket=".length);
				assert.ok(tokenValue);
				const actor = await product.people.authenticate(tokenValue);
				return {
					actor,
					headers: {
						Cookie: cookies.join("; "),
						"X-Pakka-CSRF": csrf,
						"X-Pakka-Person": product.people.current(actor).id,
						"X-Pakka-Server": product.http.serverId,
					},
				};
			}
			const owner = await exchange(app.initialOwner.token),
				viewer = await exchange(viewerSession.token);
			async function rpc(command: ExtensionCommandEnvelope, auth = owner) {
				const requestId = crypto.randomUUID(),
					response = await fetch(product.http.origin + "/pakka-webui/extensions/rpc", {
						method: "POST",
						headers: { "Content-Type": "application/json", Origin: product.http.origin, ...auth.headers },
						body: JSON.stringify({ version: 3, requestId, command }),
					});
				return decodeExtensionResponse(await response.json(), requestId);
			}
			const registration = await rpc({ op: "list", target });
			assert.ok("result" in registration && registration.result.kind === "registrations");
			const backend = registration.result.registrations.find((row) => row.facet === "backend")!;
			for (const allow of [true, false]) {
				const admission = await product.workspace.bind(owner.actor).submit(target, {
					requestId: allow ? "allow-original-tool" : "deny-original-tool",
					text: "REQUEST-EXACT-TOOL",
					mode: "prompt",
				});
				await t.waitFor(async () =>
					assert.ok((await approvals.bind(owner.actor).list(target)).some((row) => row.state === "pending")),
				);
				const pending = (await approvals.bind(owner.actor).list(target)).find(
					(row) => row.state === "pending",
				)!;
				const listed = await rpc(
					{
						op: "call",
						call: {
							extension: "workspace-approvals",
							generation: backend.generation,
							target,
							action: "list",
							requestId: crypto.randomUUID(),
							input: {},
						},
					},
					viewer,
				);
				assert.ok("result" in listed && listed.result.kind === "operation");
				assert.equal(listed.result.operation.state, "done");
				assert.ok(isRecord(listed.result.operation.value));
				assert.equal(listed.result.operation.value.canDecide, false);
				const rows = listed.result.operation.value.approvals;
				assert.ok(
					Array.isArray(rows) &&
						rows.some((row) => isRecord(row) && row.id === pending.id && row.state === "pending"),
				);
				const call = {
					extension: "workspace-approvals",
					generation: backend.generation,
					target,
					action: "decide",
					requestId: crypto.randomUUID(),
					input: { id: pending.id, allow },
				};
				const refused = await rpc({ op: "call", call }, viewer);
				assert.ok("error" in refused && refused.error.outcome === "denied");
				assert.equal(effects, allow ? 0 : 1);
				const decided = await rpc({ op: "call", call });
				assert.ok("result" in decided && decided.result.kind === "operation");
				assert.equal(decided.result.operation.state, "done");
				assert.ok(isRecord(decided.result.operation.value));
				assert.equal(decided.result.operation.value.state, allow ? "done" : "denied");
				const lookup = {
					op: "operationByRequest" as const,
					request: { extension: call.extension, requestId: call.requestId, target },
				};
				const found = await rpc(lookup);
				assert.ok("result" in found);
				assert.deepEqual(found.result, decided.result);
				const foreign = await rpc(lookup, viewer);
				assert.ok("error" in foreign && foreign.error.outcome === "denied");
				assert.equal((await product.workspace.bind(owner.actor).wait(admission.id)).status, "done");
				assert.equal(effects, 1);
			}
			assert.equal(await readFile(join(m.f.cwd, "human-effect.txt"), "utf8"), "ORIGINAL-TOOL-PAYLOAD");
			const native = await product.runtime.readConversation(target, () => {});
			assert.ok(JSON.stringify(native).includes("APPROVAL-DENIED"));
			await t.waitFor(async () => {
				const stored = await product.runtime
					.store({ namespace: "pocket.notifications", maxBytes: 1048576 })
					.snapshot();
				assert.ok(
					Array.isArray(stored.data.events) &&
						stored.data.events.some(
							(row) => row && typeof row === "object" && !Array.isArray(row) && row.kind === "approval",
						),
				);
			});
			assert.equal(m.f.requests.length, 4);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await app?.close();
			await m.f.close();
		}
	},
);
