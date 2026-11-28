import test from "node:test";
import assert from "node:assert/strict";
import { Server } from "node:http";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedBrowser } from "./browser.ts";

// Must reject the OS's first forbidden allocation before starting a native CDP client.
test("owned test browser selects a Fetch-compatible CDP port before launching Chrome", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pakka-cdp-port-"));
	const original = Server.prototype.listen;
	const originalSpawn = childProcess.spawn;
	let intercepted = false;
	// Simulate the OS's forbidden first allocation at either native port-0 consumer.
	t.mock.method(childProcess, "spawn", function (...args: unknown[]) {
		if (Array.isArray(args[1]))
			args[1] = args[1].map((value) =>
				value === "--remote-debugging-port=0" ? "--remote-debugging-port=1723" : value,
			);
		return Reflect.apply(originalSpawn, childProcess, args);
	});
	syncBuiltinESMExports();
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	t.mock.method(Server.prototype, "listen", function (this: Server, ...args: unknown[]) {
		if (!intercepted && args[0] === 0) {
			intercepted = true;
			args[0] = 1723;
		}
		return Reflect.apply(original, this, args);
	});
	let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
	try {
		browser = await ownedBrowser(root);
		const page = await browser.page("data:text/html,<p>ACTUAL CDP READY</p>");
		await page.wait('document.querySelector("p")?.textContent === "ACTUAL CDP READY"');
		assert.equal(await page.evaluate('document.querySelector("p").textContent'), "ACTUAL CDP READY");
	} finally {
		await browser?.close();
	}
});

// A real Chrome and a real WebSocket are used; only the attempted endpoint is faulted.
test("owned test browser reaps its launched process when the native CDP connection fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "pakka-cdp-failure-"));
	const NativeSocket = globalThis.WebSocket;
	let endpoint: string | undefined;
	globalThis.WebSocket = class extends NativeSocket {
		constructor(url: string | URL, protocols?: string | string[]) {
			endpoint = String(url);
			const refused = new URL(url);
			refused.port = "1723";
			super(refused, protocols);
		}
	};
	try {
		await assert.rejects(ownedBrowser(root), /CDP failed/);
		assert.ok(endpoint);
		const health = new URL("/json/version", endpoint);
		health.protocol = "http:";
		await assert.rejects(fetch(health, { signal: AbortSignal.timeout(2000) }), /fetch failed/);
	} finally {
		globalThis.WebSocket = NativeSocket;
		// Reap the known orphan on the failing old helper as well; never touch another browser.
		if (endpoint)
			await new Promise<void>((resolve) => {
				const ws = new NativeSocket(endpoint!);
				const timer = setTimeout(() => {
					ws.close();
					resolve();
				}, 2000);
				const done = () => {
					clearTimeout(timer);
					resolve();
				};
				ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "Browser.close" })), {
					once: true,
				});
				ws.addEventListener("close", done, { once: true });
				ws.addEventListener("error", done, { once: true });
			});
	}
});
