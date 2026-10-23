// CDP pipe framing adapted from pi-pocket@de612d5622cd (MIT); see apps/webui/LICENSE.pi-pocket.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { ConversationRef, JsonObject, Runtime } from "@pakka/agent";
import { browserNetwork } from "./pocket-browser-network.ts";
import type { PocketAuthority, PocketPeople } from "./pocket-people.ts";

export interface PocketBrowserView {
	readonly open: boolean;
	readonly url: string;
	readonly title: string;
	readonly text: string;
}
export interface PocketBrowserEffect {
	readonly requestId: string;
	readonly state: "done" | "unknown";
}
export interface PocketBrowserClient {
	snapshot(target: ConversationRef): Promise<PocketBrowserView>;
	frame(target: ConversationRef): Promise<{ readonly type: "image/png"; readonly base64: string }>;
	navigate(
		target: ConversationRef,
		input: { readonly requestId: string; readonly url: string },
	): Promise<PocketBrowserEffect>;
	click(
		target: ConversationRef,
		input: { readonly requestId: string; readonly selector: string },
	): Promise<PocketBrowserEffect>;
	fill(
		target: ConversationRef,
		input: { readonly requestId: string; readonly selector: string; readonly text: string },
	): Promise<PocketBrowserEffect>;
	receipt(target: ConversationRef, requestId: string): Promise<PocketBrowserEffect>;
}
export interface PocketBrowser {
	bind(actor: PocketAuthority, check?: () => void): PocketBrowserClient;
	close(): Promise<void>;
}
export interface PocketBrowserOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly namespace: string;
	readonly executable: string;
	readonly origins: readonly string[];
	readonly resources: "*" | readonly string[];
}
type ObjectValue = Record<string, unknown>;
const record = (v: unknown): v is ObjectValue => !!v && typeof v === "object" && !Array.isArray(v);
const identity = (v: unknown): v is string => typeof v === "string" && /^[-a-zA-Z0-9._:]{1,160}$/.test(v);
const same = (a: ConversationRef, b: ConversationRef) =>
	a.key === b.key &&
	a.sessionId === b.sessionId &&
	a.conversationId === b.conversationId &&
	a.incarnation === b.incarnation &&
	a.profile === b.profile;
function deny(): never {
	throw Error("WebUI browser authority/origin denied");
}
function checkedRef(v: unknown): ConversationRef {
	if (
		!record(v) ||
		Object.keys(v).sort().join(",") !== "conversationId,incarnation,key,profile,sessionId" ||
		!identity(v.key) ||
		!identity(v.sessionId) ||
		!identity(v.conversationId) ||
		!identity(v.incarnation) ||
		!identity(v.profile)
	)
		throw Error("Unconfirmed browser reference");
	return {
		key: v.key,
		sessionId: v.sessionId,
		conversationId: v.conversationId,
		incarnation: v.incarnation,
		profile: v.profile,
	};
}
function httpUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return deny();
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || raw.length > 2048)
		return deny();
	return url;
}

class ExpiredInterception extends Error {
	constructor() {
		super("Owned browser interception already revoked");
	}
}

/** One owned pipe, bounded commands, no debugger listener or public evaluate API. */
class Pipe {
	private buffer = "";
	private next = 0;
	private ended = false;
	private pending = new Map<
		number,
		{
			method: string;
			resolve: (v: ObjectValue) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	onEvent?: (method: string, params: ObjectValue, session?: string) => void;
	private readonly output: Writable;
	constructor(output: Writable, input: Readable) {
		this.output = output;
		input.setEncoding("utf8");
		input.on("data", (chunk: string) => {
			this.buffer += chunk;
			if (this.buffer.length > 4 * 1024 * 1024) {
				this.close();
				return;
			}
			for (let split = this.buffer.indexOf("\0"); split !== -1; split = this.buffer.indexOf("\0")) {
				const raw = this.buffer.slice(0, split);
				this.buffer = this.buffer.slice(split + 1);
				let value: unknown;
				try {
					value = JSON.parse(raw);
				} catch {
					this.close();
					return;
				}
				if (!record(value)) {
					this.close();
					return;
				}
				if (typeof value.id === "number") {
					const pending = this.pending.get(value.id);
					if (!pending) continue;
					clearTimeout(pending.timer);
					this.pending.delete(value.id);
					if (value.error || !record(value.result)) {
						const expired =
							(pending.method === "Fetch.failRequest" || pending.method === "Fetch.continueRequest") &&
							record(value.error) &&
							value.error.code === -32602 &&
							value.error.message === "Invalid InterceptionId.";
						pending.reject(expired ? new ExpiredInterception() : Error("Owned browser command unconfirmed"));
					} else pending.resolve(value.result);
				} else if (typeof value.method === "string" && record(value.params))
					this.onEvent?.(
						value.method,
						value.params,
						typeof value.sessionId === "string" ? value.sessionId : undefined,
					);
			}
		});
		input.on("error", () => this.close());
		input.on("close", () => this.close());
		output.on("error", () => this.close());
	}
	send(method: string, params: ObjectValue = {}, sessionId?: string): Promise<ObjectValue> {
		if (this.ended) return Promise.reject(Error("Owned browser unavailable"));
		return new Promise((resolve, reject) => {
			const id = ++this.next,
				timer = setTimeout(() => {
					this.pending.delete(id);
					reject(Error("Owned browser command deadline"));
				}, 5000);
			this.pending.set(id, { method, resolve, reject, timer });
			this.output.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
		});
	}
	close() {
		if (this.ended) return;
		this.ended = true;
		this.output.destroy();
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(Error("Owned browser unavailable"));
		}
		this.pending.clear();
	}
}
type Page = { ref: ConversationRef; sessionId: string; contextId: string; targetId: string };
type Intent = {
	requestId: string;
	actor: string;
	ref: ConversationRef;
	fingerprint: string;
	state: "running" | "done" | "unknown";
};
function decode(data: JsonObject, version: number, configuration: string): Intent[] {
	if (version === 0 && Object.keys(data).length === 0) return [];
	if (
		data.schema !== 1 ||
		data.configuration !== configuration ||
		Object.keys(data).sort().join(",") !== "configuration,rows,schema" ||
		!Array.isArray(data.rows) ||
		data.rows.length > 512
	)
		throw Error("Unconfirmed browser operation storage");
	const rows: Intent[] = data.rows.map((v) => {
		if (
			!record(v) ||
			Object.keys(v).sort().join(",") !== "actor,fingerprint,ref,requestId,state" ||
			!identity(v.requestId) ||
			!identity(v.actor) ||
			typeof v.fingerprint !== "string" ||
			!/^[a-f0-9]{64}$/.test(v.fingerprint) ||
			(v.state !== "running" && v.state !== "done" && v.state !== "unknown")
		)
			throw Error("Unconfirmed browser operation");
		return {
			requestId: v.requestId,
			actor: v.actor,
			ref: checkedRef(v.ref),
			fingerprint: v.fingerprint,
			state: v.state,
		};
	});
	if (new Set(rows.map((row) => row.actor + ":" + row.requestId)).size !== rows.length)
		throw Error("Unconfirmed browser operation identity");
	return rows;
}

/** Explicit host-owned isolated browser. No executable, profile path, origin grant or script comes from a request. */
export async function createPocketBrowser(options: PocketBrowserOptions): Promise<PocketBrowser> {
	const { runtime, people } = options;
	if (
		!isAbsolute(options.executable) ||
		!options.origins.length ||
		options.origins.length > 32 ||
		new Set(options.origins).size !== options.origins.length ||
		(options.resources !== "*" &&
			(!Array.isArray(options.resources) ||
				!options.resources.length ||
				options.resources.length > 128 ||
				options.resources.some((v) => !identity(v))))
	)
		throw Error("Invalid approved browser configuration");
	const executable = options.executable,
		namespace = options.namespace,
		resources = options.resources === "*" ? "*" : Object.freeze([...options.resources]);
	const origins = new Set(
		options.origins.map((raw) => {
			const url = httpUrl(raw);
			if (url.origin !== raw) throw Error("Invalid approved browser origin");
			return raw;
		}),
	);
	await access(executable);
	if (!(await lstat(executable)).isFile() || (await lstat(executable)).isSymbolicLink())
		throw Error("Invalid approved browser executable");
	const configuration = createHash("sha256")
			.update(JSON.stringify([executable, [...origins], resources]))
			.digest("hex"),
		store = runtime.store({ namespace, maxBytes: 262144 });
	let closed = false,
		failed = false,
		tail: Promise<unknown> = Promise.resolve(),
		child: ChildProcess | undefined,
		pipe: Pipe | undefined,
		profile: string | undefined,
		starting: Promise<Pipe> | undefined,
		network: Awaited<ReturnType<typeof browserNetwork>> | undefined;
	const pages = new Map<string, Page>();
	const ready = () => {
		if (closed || failed || runtime.view().phase !== "ready")
			throw Error("WebUI browser closed or unavailable");
	};
	const permitted = (raw: string) => {
		try {
			return origins.has(httpUrl(raw).origin);
		} catch {
			return false;
		}
	};
	async function saved() {
		ready();
		try {
			const value = await store.snapshot();
			return { version: value.version, rows: decode(value.data, value.version, configuration) };
		} catch (error) {
			failed = true;
			throw error;
		}
	}
	async function save(effect: (rows: Intent[]) => void, check: () => void) {
		for (let retry = 0; retry < 64; retry++) {
			const value = await saved();
			effect(value.rows);
			if (value.rows.length > 512) throw Error("Browser operation capacity reached");
			check();
			const data: JsonObject = {
				schema: 1,
				configuration,
				rows: value.rows.map((row) => ({ ...row, ref: { ...row.ref } })),
			};
			try {
				await store.compareAndSet(value.version, data, check);
				return;
			} catch (error) {
				if ((await saved()).version <= value.version) throw error;
			}
		}
		throw Error("Unconfirmed browser contention");
	}
	const initial = await saved();
	if (initial.rows.some((row) => row.state === "running"))
		await save((rows) => {
			for (const row of rows) if (row.state === "running") row.state = "unknown";
		}, ready);
	async function stop() {
		let networkError: unknown;
		try {
			await network?.close();
		} catch (error) {
			networkError = error;
		}
		if (pipe) {
			try {
				await pipe.send("Browser.close");
			} catch {
				/* The pipe often closes before the close response. */
			}
			pipe.close();
		}
		if (child && child.exitCode === null && child.signalCode === null)
			await new Promise<void>((resolve, reject) => {
				const target = child!;
				const force = setTimeout(() => target.kill(), 2000),
					deadline = setTimeout(() => reject(Error("Owned browser exit unconfirmed")), 5000);
				target.once("exit", () => {
					clearTimeout(force);
					clearTimeout(deadline);
					resolve();
				});
			});
		if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
		pages.clear();
		if (networkError) throw Error("Owned browser network shutdown unconfirmed");
	}
	async function start(): Promise<Pipe> {
		ready();
		if (starting) return starting;
		starting = (async () => {
			profile = await mkdtemp(join(dirname(runtime.view().sessionFile), "pocket-owned-browser-"));
			const local = join(profile, "AppData", "Local"),
				roaming = join(profile, "AppData", "Roaming");
			await Promise.all([mkdir(local, { recursive: true }), mkdir(roaming, { recursive: true })]);
			network = await browserNetwork(origins);
			ready();
			child = spawn(
				executable,
				[
					"--headless=new",
					"--disable-gpu",
					"--remote-debugging-pipe",
					"--proxy-server=" + network.endpoint,
					"--proxy-bypass-list=<-loopback>",
					"--disable-quic",
					"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
					"--block-new-web-contents",
					"--disable-background-networking",
					"--disable-component-update",
					"--disable-extensions",
					"--disable-sync",
					"--no-first-run",
					"--no-default-browser-check",
					"--user-data-dir=" + profile,
					"about:blank",
				],
				{
					windowsHide: true,
					stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
					env: {
						...Object.fromEntries(
							["SystemRoot", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].map((key) => [
								key,
								process.env[key],
							]),
						),
						HOME: profile,
						USERPROFILE: profile,
						LOCALAPPDATA: local,
						APPDATA: roaming,
					},
				},
			);
			child.stderr?.resume();
			const out = child.stdio[3],
				input = child.stdio[4];
			if (!out || !input) throw Error("Owned browser pipe unavailable");
			// SAFETY: the fixed spawn stdio contract uses fd 3 for CDP writes and fd 4 for CDP reads.
			pipe = new Pipe(out as Writable, input as Readable);
			child.on("error", () => pipe?.close());
			child.once("exit", () => pipe?.close());
			pipe.onEvent = (method, params, sessionId) => {
				if (method === "Fetch.requestPaused" && sessionId && typeof params.requestId === "string") {
					const allowed =
						record(params.request) && typeof params.request.url === "string" && permitted(params.request.url);
					void pipe!
						.send(
							allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
							{ requestId: params.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}) },
							sessionId,
						)
						.catch((error) => {
							// A new navigation can revoke the old request before its rejection is acknowledged.
							// Only that explicit CDP lifecycle response is expected; unknown failures seal the pipe.
							if (error instanceof ExpiredInterception) return;
							failed = true;
							pipe?.close();
						});
				}
			};
			await pipe.send("Browser.getVersion");
			await pipe.send("Browser.setDownloadBehavior", { behavior: "deny" });
			ready();
			return pipe;
		})();
		try {
			return await starting;
		} catch (error) {
			failed = true;
			await stop();
			throw error;
		}
	}
	async function page(ref: ConversationRef, check: () => void, create = false): Promise<Page | undefined> {
		const existing = pages.get(ref.conversationId);
		if (existing) {
			if (!same(ref, existing.ref)) return deny();
			return existing;
		}
		if (!create) return;
		const cdp = await start();
		check();
		if (pages.size >= 8) throw Error("Owned browser page capacity reached");
		const context = await cdp.send("Target.createBrowserContext"),
			target = await cdp.send("Target.createTarget", {
				url: "about:blank",
				browserContextId: context.browserContextId,
			});
		const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
		if (
			typeof context.browserContextId !== "string" ||
			typeof target.targetId !== "string" ||
			typeof attached.sessionId !== "string"
		)
			throw Error("Unconfirmed owned page identity");
		const value: Page = {
			ref: checkedRef(ref),
			contextId: context.browserContextId,
			targetId: target.targetId,
			sessionId: attached.sessionId,
		};
		await cdp.send("Page.enable", {}, value.sessionId);
		await cdp.send("Runtime.enable", {}, value.sessionId);
		await cdp.send(
			"Fetch.enable",
			{ patterns: [{ urlPattern: "*", requestStage: "Request" }] },
			value.sessionId,
		);
		await cdp.send(
			"Emulation.setDeviceMetricsOverride",
			{ width: 960, height: 640, deviceScaleFactor: 1, mobile: false },
			value.sessionId,
		);
		check();
		pages.set(ref.conversationId, value);
		return value;
	}
	const evaluate = async (p: Page, expression: string): Promise<unknown> => {
		const response = await pipe!.send("Runtime.evaluate", { expression, returnByValue: true }, p.sessionId);
		if (response.exceptionDetails || !record(response.result)) throw Error("Owned page state unconfirmed");
		return response.result.value;
	};
	const service: PocketBrowser = {
		bind(actor, check = () => {}) {
			const authorize = (ref: ConversationRef, write = false) => {
				check();
				ready();
				if (
					!runtime.view().conversations.some((row) => same(row, ref)) ||
					(resources !== "*" && !resources.includes(ref.conversationId))
				)
					return deny();
				people.check(actor, write ? "send" : "read", ref.conversationId);
			};
			const mutate = (
				ref: ConversationRef,
				input: Record<string, unknown>,
				method: string,
				fields: string[],
				effect: (guard: () => void) => Promise<void>,
			): Promise<PocketBrowserEffect> => {
				const verify = () => authorize(ref, true);
				verify();
				if (
					!identity(input.requestId) ||
					Object.keys(input).sort().join(",") !== ["requestId", ...fields].sort().join(",")
				)
					return Promise.reject(Error("Invalid finite browser command"));
				const requestId = input.requestId,
					actorId = people.current(actor).id,
					fingerprint = createHash("sha256")
						.update(JSON.stringify([ref, method, input]))
						.digest("hex");
				const run = tail.then(async () => {
					verify();
					const rows = (await saved()).rows,
						previous = rows.find((row) => row.actor === actorId && row.requestId === requestId);
					if (previous) {
						if (!same(previous.ref, ref) || previous.fingerprint !== fingerprint) return deny();
						verify();
						return Object.freeze({
							requestId,
							state: previous.state === "done" ? ("done" as const) : ("unknown" as const),
						});
					}
					await save((rows) => {
						if (rows.some((row) => row.actor === actorId && row.requestId === requestId)) return deny();
						rows.push({ requestId, actor: actorId, ref: checkedRef(ref), fingerprint, state: "running" });
					}, verify);
					let state: "done" | "unknown" = "unknown";
					try {
						verify();
						await effect(verify);
						verify();
						state = "done";
					} catch {
						/* An admitted browser action may have executed. Never replay it. */
					}
					await save((rows) => {
						const row = rows.find((r) => r.actor === actorId && r.requestId === requestId);
						if (!row || row.state !== "running") throw Error("Unconfirmed browser outcome");
						row.state = state;
					}, ready);
					verify();
					return Object.freeze({ requestId, state });
				});
				tail = run.then(
					() => {},
					() => {},
				);
				return run;
			};
			const selector = (v: unknown): string => {
				if (typeof v !== "string" || !v.trim() || v.length > 256 || /[\x00-\x1f]/.test(v)) return deny();
				return v;
			};
			const client: PocketBrowserClient = {
				snapshot: async (ref) => {
					authorize(ref);
					const p = await page(ref, () => authorize(ref));
					if (!p) return Object.freeze({ open: false, url: "", title: "", text: "" });
					const data = await evaluate(
						p,
						"({url:location.href,title:document.title.slice(0,512),text:(document.body?.innerText??'').slice(0,16000)})",
					);
					authorize(ref);
					if (
						!record(data) ||
						typeof data.url !== "string" ||
						typeof data.title !== "string" ||
						typeof data.text !== "string" ||
						(data.url !== "about:blank" && !permitted(data.url))
					)
						return deny();
					return Object.freeze({ open: true, url: data.url, title: data.title, text: data.text });
				},
				frame: async (ref) => {
					authorize(ref);
					const p = await page(ref, () => authorize(ref));
					if (!p) throw Error("Owned page not open");
					const value = await pipe!.send(
						"Page.captureScreenshot",
						{ format: "png", captureBeyondViewport: false },
						p.sessionId,
					);
					authorize(ref);
					if (typeof value.data !== "string" || value.data.length > 196608 || !value.data.startsWith("iVBOR"))
						throw Error("Unconfirmed bounded page frame");
					return Object.freeze({ type: "image/png", base64: value.data });
				},
				navigate: (ref, input) => {
					const url = httpUrl(input.url);
					if (!origins.has(url.origin)) return Promise.reject(Error("WebUI browser origin denied"));
					return mutate(ref, input, "navigate", ["url"], async (guard) => {
						const p = await page(ref, guard, true);
						guard();
						const result = await pipe!.send("Page.navigate", { url: url.href }, p!.sessionId);
						if (result.errorText) throw Error("Navigation unconfirmed");
					});
				},
				click: (ref, input) => {
					const target = selector(input.selector);
					return mutate(ref, input, "click", ["selector"], async (guard) => {
						const p = await page(ref, guard);
						if (!p) throw Error("Owned page not open");
						const point = await evaluate(
							p,
							`(()=>{const e=document.querySelector(${JSON.stringify(target)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return r.width&&r.height&&hit&&e.contains(hit)?{x,y}:null;})()`,
						);
						if (!record(point) || typeof point.x !== "number" || typeof point.y !== "number")
							throw Error("Owned page control not interactable");
						guard();
						await pipe!.send(
							"Input.dispatchMouseEvent",
							{ type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 },
							p.sessionId,
						);
						guard();
						await pipe!.send(
							"Input.dispatchMouseEvent",
							{ type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 },
							p.sessionId,
						);
					});
				},
				fill: (ref, input) => {
					const target = selector(input.selector);
					if (typeof input.text !== "string" || input.text.length > 4096)
						return Promise.reject(Error("Invalid bounded browser input"));
					return mutate(ref, input, "fill", ["selector", "text"], async (guard) => {
						const p = await page(ref, guard);
						if (!p) throw Error("Owned page not open");
						const focused = await evaluate(
							p,
							`(()=>{const e=document.querySelector(${JSON.stringify(target)});if(!e||e.disabled||e.readOnly||!['INPUT','TEXTAREA'].includes(e.tagName))return false;e.focus();e.select();return true;})()`,
						);
						if (focused !== true) throw Error("Owned page field unavailable");
						guard();
						await pipe!.send("Input.insertText", { text: input.text }, p.sessionId);
					});
				},
				receipt: async (ref, requestId) => {
					authorize(ref);
					if (!identity(requestId)) return deny();
					const actorId = people.current(actor).id,
						row = (await saved()).rows.find(
							(r) => r.actor === actorId && r.requestId === requestId && same(r.ref, ref),
						);
					authorize(ref);
					if (!row) return deny();
					return Object.freeze({ requestId, state: row.state === "done" ? "done" : "unknown" });
				},
			};
			return Object.freeze(client);
		},
		close: async () => {
			if (closed) return;
			closed = true;
			await stop();
		},
	};
	return Object.freeze(service);
}
