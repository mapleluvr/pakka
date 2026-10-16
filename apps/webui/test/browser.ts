import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";

type Value = Record<string, unknown>;
export async function ownedBrowser(dir: string, options: { readonly push?: boolean } = {}) {
	const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
	await access(chrome);
	const local = join(dir, "AppData", "Local"),
		roaming = join(dir, "AppData", "Roaming");
	await Promise.all([mkdir(local, { recursive: true }), mkdir(roaming, { recursive: true })]);
	const processHandle = spawn(
		chrome,
		[
			"--headless=new",
			"--disable-gpu",
			...(options.push ? [] : ["--disable-background-networking"]),
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
			env: { ...process.env, HOME: dir, USERPROFILE: dir, LOCALAPPDATA: local, APPDATA: roaming },
		},
	);
	let stderr = "";
	const endpoint = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			processHandle.kill();
			reject(new Error("Owned Chrome deadline: " + stderr));
		}, 10000);
		processHandle.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		processHandle.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error("Owned Chrome exit " + code + ": " + stderr));
		});
		processHandle.stderr.on("data", (chunk) => {
			stderr = (stderr + String(chunk)).slice(-8192);
			const match = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/);
			if (match) {
				clearTimeout(timer);
				resolve(match[1]!);
			}
		});
	});
	const ws = new WebSocket(endpoint),
		pending = new Map<number, { resolve: (value: Value) => void; reject: (error: Error) => void }>();
	let next = 0;
	await new Promise<void>((resolve, reject) => {
		ws.addEventListener("open", () => resolve(), { once: true });
		ws.addEventListener("error", () => reject(new Error("Owned Chrome CDP failed")), { once: true });
	});
	const workers = new Map<string, { registrationId: string; scopeURL: string }>();
	ws.addEventListener("message", (event) => {
		try {
			const v: unknown = JSON.parse(String(event.data));
			if (
				v &&
				typeof v === "object" &&
				"method" in v &&
				v.method === "ServiceWorker.workerRegistrationUpdated" &&
				"sessionId" in v &&
				typeof v.sessionId === "string" &&
				"params" in v &&
				v.params &&
				typeof v.params === "object" &&
				"registrations" in v.params &&
				Array.isArray(v.params.registrations)
			) {
				for (const row of v.params.registrations)
					if (
						row &&
						typeof row === "object" &&
						typeof row.registrationId === "string" &&
						typeof row.scopeURL === "string"
					)
						workers.set(v.sessionId + ":" + row.scopeURL, {
							registrationId: row.registrationId,
							scopeURL: row.scopeURL,
						});
			}
			if (!v || typeof v !== "object" || !("id" in v) || typeof v.id !== "number") return;
			const waiter = pending.get(v.id);
			if (!waiter) return;
			pending.delete(v.id);
			if ("error" in v) waiter.reject(new Error("Owned CDP command failed: " + JSON.stringify(v.error)));
			else if ("result" in v && v.result && typeof v.result === "object") waiter.resolve(v.result as Value);
			else waiter.reject(new Error("Invalid CDP result"));
		} catch {
			for (const item of pending.values()) item.reject(new Error("Invalid CDP message"));
			pending.clear();
		}
	});
	const call = (method: string, params: Value = {}, sessionId?: string): Promise<Value> =>
		new Promise((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	return {
		page: async (url: string, viewport = { width: 1440, height: 900 }) => {
			const context: Value = options.push ? {} : await call("Target.createBrowserContext"),
				target = await call("Target.createTarget", {
					url: "about:blank",
					browserContextId: context.browserContextId,
				});
			const attached = await call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
			const id = String(attached.sessionId);
			await call("Page.enable", {}, id);
			await call("Runtime.enable", {}, id);
			await call("ServiceWorker.enable", {}, id);
			await call(
				"Emulation.setDeviceMetricsOverride",
				{ ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 600 },
				id,
			);
			const evaluate = async (expression: string) => {
				const value = await call(
					"Runtime.evaluate",
					{ expression, awaitPromise: true, returnByValue: true },
					id,
				);
				if (value.exceptionDetails)
					throw new Error("Browser evaluation failed: " + JSON.stringify(value.exceptionDetails));
				return (value.result as Value)?.value;
			};
			await call("Page.navigate", { url }, id);
			return {
				evaluate,
				allowNotifications: async () => {
					const origin = await evaluate("location.origin");
					if (typeof origin !== "string" || !/^https?:\/\/127\.0\.0\.1:\d+$/.test(origin))
						throw Error("Unexpected owned notification origin");
					await call("Browser.grantPermissions", {
						origin,
						browserContextId: context.browserContextId,
						permissions: ["notifications"],
					});
				},
				pushNotification: async (wake: { eventId: string; deviceId: string }) => {
					const origin = await evaluate("location.origin");
					if (typeof origin !== "string") throw Error("Missing owned origin");
					const worker = workers.get(id + ":" + origin + "/");
					if (!worker) throw Error("Owned notification worker not registered");
					await call(
						"ServiceWorker.deliverPushMessage",
						{ origin, registrationId: worker.registrationId, data: JSON.stringify(wake) },
						id,
					);
				},
				navigate: async (target: string) => {
					await call("Page.navigate", { url: target }, id);
				},
				reload: async () => {
					await call("Page.reload", {}, id);
				},
				type: async (selector: string, text: string) => {
					await evaluate("document.querySelector(" + JSON.stringify(selector) + ").focus()");
					await call("Input.insertText", { text }, id);
				},
				click: async (selector: string) => {
					const point = await evaluate(
						"(()=>{const e=document.querySelector(" +
							JSON.stringify(selector) +
							");if(!e||e.disabled)return null;e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,p=document.elementFromPoint(x,y);return r.width&&r.height&&p&&e.contains(p)?{x,y}:null})()",
					);
					if (
						!point ||
						typeof point !== "object" ||
						!("x" in point) ||
						!("y" in point) ||
						typeof point.x !== "number" ||
						typeof point.y !== "number"
					)
						throw new Error("Browser control not interactable: " + selector);
					await call(
						"Input.dispatchMouseEvent",
						{ type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 },
						id,
					);
					await call(
						"Input.dispatchMouseEvent",
						{ type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 },
						id,
					);
				},
				wait: async (expression: string) => {
					const deadline = Date.now() + 8000;
					while (Date.now() < deadline) {
						if (await evaluate(expression)) return;
						await new Promise((resolve) => setTimeout(resolve, 40));
					}
					throw new Error(
						"Browser condition deadline: " + expression + ": " + (await evaluate("document.body.innerText")),
					);
				},
				screenshot: async () => {
					const result = await call("Page.captureScreenshot", { format: "png" }, id);
					return Buffer.from(String(result.data), "base64");
				},
				close: async () => {
					if (typeof context.browserContextId === "string")
						await call("Target.disposeBrowserContext", { browserContextId: context.browserContextId });
					else await call("Target.closeTarget", { targetId: target.targetId });
				},
			};
		},
		close: async () => {
			try {
				await call("Browser.close");
			} finally {
				ws.close();
				processHandle.kill();
			}
		},
	};
}
