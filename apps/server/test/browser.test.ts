import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMas } from "@pakka/mas";
import { createMasServer } from "../src/http-server.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { browserExecutable } from "../../webui/test/browser.ts";

type CdpResult = Record<string, unknown>;
const record = (value: unknown): value is CdpResult =>
	value !== null && typeof value === "object" && !Array.isArray(value);
async function connectCdp(address: string) {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		throw new Error("Invalid owned browser endpoint");
	}
	if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1") throw new Error("Nonlocal browser endpoint");
	const ws = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		ws.addEventListener("open", () => resolve(), { once: true });
		ws.addEventListener("error", () => reject(new Error("Owned browser connection failed")), { once: true });
	});
	let next = 0;
	const pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void }>(),
		loads = new Map<string, () => void>();
	ws.addEventListener("message", (event) => {
		try {
			const message: unknown = JSON.parse(String(event.data));
			if (!record(message)) throw new Error("Invalid browser message");
			if (typeof message.id === "number") {
				const item = pending.get(message.id);
				if (!item) return;
				pending.delete(message.id);
				if (message.error) item.reject(new Error("Browser command failed"));
				else if (record(message.result)) item.resolve(message.result);
				else item.reject(new Error("Invalid browser result"));
			}
			if (message.method === "Page.loadEventFired" && typeof message.sessionId === "string") {
				loads.get(message.sessionId)?.();
				loads.delete(message.sessionId);
			}
		} catch {
			for (const item of pending.values()) item.reject(new Error("Browser message unconfirmed"));
			pending.clear();
		}
	});
	ws.addEventListener("close", () => {
		for (const item of pending.values()) item.reject(new Error("Browser closed"));
		pending.clear();
	});
	return {
		call: (method: string, params: CdpResult = {}, sessionId?: string): Promise<CdpResult> =>
			new Promise((resolve, reject) => {
				const id = ++next;
				pending.set(id, { resolve, reject });
				ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
			}),
		loaded: (sessionId: string) => new Promise<void>((resolve) => loads.set(sessionId, resolve)),
		close: () => ws.close(),
	};
}

test(
	"M5 browser: compiled shared client connects with no Node globals and executes real authenticated admission",
	{ timeout: 30000 },
	async () => {
		const chrome = await browserExecutable(); // Mandatory real browser acceptance, never a skipped pass.
		const m = await runtimeFixture(),
			dir = await mkdtemp(join(process.env.PAKKA_TEST_ARTIFACTS ?? tmpdir(), "browser-"));
		const assets = new Map<string, string>([
			["/client.js", await readFile("packages/client/dist/index.js", "utf8")],
			["/protocol.js", await readFile("packages/protocol/dist/index.js", "utf8")],
			[
				"/",
				'<!doctype html><meta charset="utf-8"><title>Pakka browser acceptance</title><script type="importmap">{"imports":{"@pakka/protocol":"/protocol.js"}}</script>',
			],
		]);
		const web = createServer((req, res) => {
			const body = assets.get(req.url ?? "");
			if (body === undefined) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, {
				"Content-Type": req.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
			});
			res.end(body);
		});
		let api: Awaited<ReturnType<typeof createMasServer>> | undefined,
			browser: ReturnType<typeof spawn> | undefined,
			cdp: Awaited<ReturnType<typeof connectCdp>> | undefined;
		let browserStderr = "";
		try {
			await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
			const address = web.address();
			if (!address || typeof address === "string") assert.fail("Missing browser page origin");
			const origin = "http://127.0.0.1:" + address.port;
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "browser",
				maxDeliveries: 8,
				maxPending: 2,
			});
			await mas.bootstrap([{ key: "peer", owner: "operator" }]);
			await mas.activate();
			const credential = "local-browser-test-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
			api = await createMasServer({
				mas,
				sessionId: m.runtime.view().sessionId,
				origins: [origin],
				roles: [
					{ token: credential, principal: "operator", source: null, grants: ["discover", "observe", "send"] },
				],
			});
			// The full runner intentionally removes host AppData; Chrome needs owned known-folder roots.
			const localAppData = join(dir, "AppData", "Local"),
				appData = join(dir, "AppData", "Roaming");
			await Promise.all([mkdir(localAppData, { recursive: true }), mkdir(appData, { recursive: true })]);
			browser = spawn(
				chrome,
				[
					"--headless=new",
					"--disable-gpu",
					"--disable-background-networking",
					"--disable-component-update",
					"--disable-sync",
					"--disable-extensions",
					"--no-first-run",
					"--no-default-browser-check",
					"--remote-debugging-address=127.0.0.1",
					"--remote-debugging-port=0",
					"--user-data-dir=" + dir,
					"about:blank",
				],
				{
					stdio: ["ignore", "ignore", "pipe"],
					env: { ...process.env, HOME: dir, USERPROFILE: dir, LOCALAPPDATA: localAppData, APPDATA: appData },
				},
			);
			const socket = await new Promise<string>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error("Owned browser launch deadline")), 10000);
				browser!.once("error", (error) => {
					clearTimeout(timeout);
					reject(error);
				});
				browser!.once("exit", (code, signal) => {
					clearTimeout(timeout);
					reject(new Error("Owned browser exited before startup: " + code + "/" + signal));
				});
				browser!.stderr!.on("data", (chunk) => {
					browserStderr += chunk;
					const match = browserStderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/);
					if (match) {
						clearTimeout(timeout);
						resolve(match[1]!);
					}
				});
			});
			cdp = await connectCdp(socket);
			const target = await cdp.call("Target.createTarget", { url: "about:blank" });
			assert.equal(typeof target.targetId, "string");
			const attached = await cdp.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
			if (typeof attached.sessionId !== "string") assert.fail("No browser session");
			const session = attached.sessionId;
			await cdp.call("Page.enable", {}, session);
			const loaded = cdp.loaded(session);
			await cdp.call("Page.navigate", { url: origin + "/" }, session);
			await loaded;
			const expression = `(async()=>{const module=await import('/client.js');const client=module.createClient(${JSON.stringify({ endpoint: api.endpoint, token: credential })});const snapshot=await client.reconnect();const peer=snapshot.members[0];const sent=await client.request({op:'send',target:peer.ref,input:{requestId:'browser-input',text:'BROWSER-REAL-HTTP'}});const done=await client.request({op:'wait',id:sent.receipt.id});return {nodeGlobalsAbsent:typeof process==='undefined'&&typeof require==='undefined',sessionId:snapshot.sessionId,memberKey:peer.key,status:done.receipt.status};})()`;
			const evaluated = await cdp.call(
				"Runtime.evaluate",
				{ expression, awaitPromise: true, returnByValue: true },
				session,
			);
			assert.equal(evaluated.exceptionDetails, undefined, JSON.stringify(evaluated));
			if (!record(evaluated.result) || !record(evaluated.result.value))
				assert.fail("No actual browser value");
			assert.equal(evaluated.result.value.nodeGlobalsAbsent, true);
			assert.equal(evaluated.result.value.memberKey, "peer");
			assert.equal(evaluated.result.value.status, "done");
			assert.equal(evaluated.result.value.sessionId, m.runtime.view().sessionId);
			assert.equal(m.f.requests.length, 1);
			await writeFile(
				join(dir, "evidence.json"),
				JSON.stringify(
					{ browserPid: browser.pid, result: evaluated.result.value, providerRequests: m.f.requests.length },
					null,
					2,
				),
			);
		} finally {
			if (cdp) {
				try {
					await cdp.call("Browser.close");
				} catch {
					/* Browser exits before close reply on some versions. */
				}
				cdp.close();
			}
			if (browser && browser.exitCode === null && browser.signalCode === null) {
				await new Promise<void>((resolve, reject) => {
					const kill = setTimeout(() => browser!.kill(), 3000),
						deadline = setTimeout(() => reject(new Error("Owned browser exit unconfirmed")), 6000);
					browser!.once("exit", () => {
						clearTimeout(kill);
						clearTimeout(deadline);
						resolve();
					});
				});
			}
			await writeFile(
				join(dir, "launch-evidence.json"),
				JSON.stringify(
					{
						pid: browser?.pid,
						exitCode: browser?.exitCode,
						signalCode: browser?.signalCode,
						isolatedProfile: true,
						parentLocalAppDataPresent: !!process.env.LOCALAPPDATA,
						parentAppDataPresent: !!process.env.APPDATA,
						stderr: browserStderr,
					},
					null,
					2,
				),
			);
			await api?.close();
			web.closeAllConnections();
			await new Promise<void>((resolve) => web.close(() => resolve()));
			await m.close();
			if (!process.env.PAKKA_TEST_ARTIFACTS) await rm(dir, { recursive: true, force: true });
		}
	},
);
