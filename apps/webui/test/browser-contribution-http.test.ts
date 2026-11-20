import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { join } from "node:path";
import { PNG } from "pngjs";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { decodeExtensionResponse, type ExtensionCommandEnvelope } from "@pakka/protocol/extension-rpc";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceBrowserExtensionRoot, workspaceBrowserService } from "../src/workflows.ts";
import { browserExecutable } from "./browser.ts";

test(
	"WebUI browser HTTP: real page controls, two receipt identities and native unknown remain distinct",
	{ timeout: 20000 },
	async (t) => {
		let effects = 0;
		const site = createServer((req, res) => {
			if (req.url === "/effect") {
				effects++;
				res.end("RECORDED");
				return;
			}
			res.setHeader("content-type", "text/html; charset=utf-8");
			res.end(
				"<!doctype html><title>Local project page</title><h1>REAL-PROJECT-PAGE</h1><input id=message><button id=record onclick=\"fetch('/effect').then(()=>document.querySelector('#result').textContent='PAGE-EFFECT:'+document.querySelector('#message').value)\">Record</button><output id=result></output>",
			);
		});
		await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
		const address = site.address();
		assert.ok(address && typeof address !== "string");
		const origin = "http://127.0.0.1:" + address.port,
			m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "browser-product") },
				owner: "Owner",
				initial: [{ name: "Project browser", profile: "default" }],
				extensions: [{ root: workspaceBrowserExtensionRoot, facets: ["backend", "webui", "client"] }],
				extensionServices: async (context) => ({
					browser: await workspaceBrowserService(context, {
						namespace: "project.browser",
						origins: [origin],
						executable: await browserExecutable(),
						resources: [context.runtime.view().conversations.at(-1)!.conversationId],
					}),
				}),
			});
			const product = app;
			assert.ok(product.initialOwner);
			const actor = await product.people.authenticate(product.initialOwner.token);
			const ref = (await product.workspace.bind(actor).navigation())[0]!.ref;
			const invite = await product.people.invite(actor, {
				requestId: "viewer",
				role: "viewer",
				resources: [ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const session = await product.people.redeem(invite.token, "Viewer");
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
				const current = await product.people.authenticate(login);
				return {
					Cookie: cookie,
					"X-Pakka-CSRF": csrf,
					"X-Pakka-Person": product.people.current(current).id,
					"X-Pakka-Server": product.http.serverId,
				};
			}
			const owner = await exchange(product.initialOwner.token),
				viewer = await exchange(session.token);
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
				(row) => row.facet === "backend" && row.manifest.id === "workspace-browser",
			);
			assert.ok(backend);
			const generation = backend.generation;
			const command = (
				action: string,
				input: ExtensionJson,
				requestId = crypto.randomUUID(),
			): ExtensionCommandEnvelope => ({
				op: "call",
				call: { extension: "workspace-browser", generation, target: ref, action, requestId, input },
			});
			async function call(
				action: string,
				input: ExtensionJson,
				requestId = crypto.randomUUID(),
				auth = owner,
			) {
				const reply = await rpc(command(action, input, requestId), auth);
				assert.ok("result" in reply && reply.result.kind === "operation");
				return reply.result.operation;
			}
			async function view(auth = owner) {
				const result = await call("view", {}, crypto.randomUUID(), auth);
				assert.equal(result.state, "done");
				assert.ok(isRecord(result.value) && isRecord(result.value.view));
				return { view: result.value.view, frame: result.value.frame, canAct: result.value.canAct };
			}
			assert.equal((await view()).view.open, false);
			const navigation = await call("navigate", { url: origin });
			assert.equal(navigation.state, "done");
			await t.waitFor(async () => assert.match(String((await view()).view.text), /REAL-PROJECT-PAGE/));
			assert.equal(
				(await call("fill", { selector: "#message", text: "FROM-PUBLIC-BROWSER-CONTROLS" })).state,
				"done",
			);
			const originalId = crypto.randomUUID(),
				clicked = await call("click", { selector: "#record" }, originalId);
			assert.equal(clicked.state, "done");
			assert.ok(isRecord(clicked.value));
			assert.equal(clicked.value.state, "done");
			assert.equal(clicked.value.requestId, clicked.id);
			assert.notEqual(clicked.id, originalId);
			await t.waitFor(() => assert.equal(effects, 1));
			await t.waitFor(async () =>
				assert.match(String((await view(viewer)).view.text), /PAGE-EFFECT:FROM-PUBLIC-BROWSER-CONTROLS/),
			);
			const readOnly = await view(viewer);
			assert.equal(readOnly.canAct, false);
			assert.ok(isRecord(readOnly.frame) && typeof readOnly.frame.base64 === "string");
			const frame = PNG.sync.read(Buffer.from(readOnly.frame.base64, "base64"));
			assert.ok(frame.width > 0 && frame.height > 0);
			const lookup: ExtensionCommandEnvelope = {
				op: "operationByRequest",
				request: { extension: "workspace-browser", requestId: originalId, target: ref },
			};
			const recovered = await rpc(lookup);
			assert.ok("result" in recovered && recovered.result.kind === "operation");
			assert.deepEqual(recovered.result.operation, clicked);
			const inner = await call("receipt", { requestId: clicked.id });
			assert.equal(inner.state, "done");
			assert.deepEqual(inner.value, clicked.value);
			const wrongIdentity = await call("receipt", { requestId: originalId });
			assert.equal(wrongIdentity.state, "unknown");
			assert.equal(wrongIdentity.value, undefined);
			const refused = await rpc(command("click", { selector: "#record" }), viewer);
			assert.ok("error" in refused && refused.error.outcome === "denied");
			const foreign = await rpc(lookup, viewer);
			assert.ok("error" in foreign && foreign.error.outcome === "denied");
			const foreignInner = await call("receipt", { requestId: clicked.id }, crypto.randomUUID(), viewer);
			assert.equal(foreignInner.state, "unknown");
			assert.equal(foreignInner.value, undefined);
			const missing = await call("click", { selector: "#nonexistent-native-control" });
			assert.equal(missing.state, "done");
			assert.ok(isRecord(missing.value));
			assert.equal(missing.value.state, "unknown");
			const nativeUnknown = await call("receipt", { requestId: missing.id });
			assert.equal(nativeUnknown.state, "done");
			assert.deepEqual(nativeUnknown.value, missing.value);
			assert.equal(effects, 1);
			assert.equal(m.f.requests.length, 0);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await app?.close();
			await m.f.close();
			site.closeAllConnections();
			await new Promise<void>((resolve) => site.close(() => resolve()));
		}
	},
);
