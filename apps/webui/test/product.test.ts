import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";

// A static mock GUI or a second Durable backend would not produce this real native receipt/request history.
test(
	"Pocket product: actual assets and approved workspace run without MAS, then reopen the same identity and admission",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: m.f.dataDir + "/product" },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			});
			const origin = app.http.origin,
				token = app.initialOwner?.token;
			assert.ok(token);
			const html = await fetch(origin + "/");
			assert.equal(html.status, 200);
			assert.match(await html.text(), /Pakka-Pocket/);
			const script = await fetch(origin + "/app.js");
			assert.equal(script.status, 200);
			assert.match(script.headers.get("content-type") ?? "", /javascript/);
			const signed = await fetch(origin + "/pocket/exchange", {
				method: "POST",
				headers: { Origin: origin, "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "session", token }),
			});
			assert.equal(signed.status, 200);
			const cookies = signed.headers
					.getSetCookie()
					.map((c) => c.split(";")[0]!)
					.join("; "),
				csrf = /pakka_csrf=([^;]+)/.exec(cookies)![1]!;
			async function rpc(command: object) {
				const response = await fetch(origin + "/pocket/rpc", {
					method: "POST",
					headers: {
						Cookie: cookies,
						Origin: origin,
						"X-Pakka-CSRF": csrf,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ version: 2, requestId: crypto.randomUUID(), command }),
				});
				assert.equal(response.status, 200, await response.clone().text());
				return response.json();
			}
			const list = await rpc({ op: "list" });
			assert.equal(list.result.conversations.length, 1);
			const target = list.result.conversations[0],
				submitted = await rpc({
					op: "submit",
					target,
					input: { requestId: "product-input", text: "PRODUCT-REAL", mode: "prompt" },
				});
			const done = await rpc({ op: "wait", id: submitted.result.receipt.id });
			assert.equal(done.result.receipt.status, "done");
			const file = app.runtime.view().sessionFile;
			await app.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: m.f.dataDir + "/product", reopenSessionFile: file },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			});
			assert.equal(app.initialOwner, null);
			const actor = await app.people.authenticate(/pakka_pocket=([^;]+)/.exec(cookies)![1]!);
			const receipt = await app.workspace.bind(actor).receipt(submitted.result.receipt.id);
			assert.equal(receipt.status, "done");
			assert.equal(m.f.requests.length, 1);
		} finally {
			await app?.close();
			await m.f.close();
		}
	},
);
