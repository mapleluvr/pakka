import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { isIP } from "node:net";
import type { Runtime } from "@pakka/agent";
import type {
	PocketAuthority,
	PocketPeople,
	PocketPermission,
	PocketSession,
	PocketWorkspace,
} from "@pakka/server/pocket";
import {
	decodePocketRequest,
	decodePocketResponse,
	decodePocketEvent,
	POCKET_MAX_BYTES,
} from "@pakka/protocol/pocket";
import { identity } from "@pakka/protocol";
import QRCode from "qrcode";
import {
	PocketCollaborationConflict,
	PocketCredentialConflict,
	type PocketCollaboration,
	type PocketCredentials,
} from "@pakka/server/pocket";
import type { PocketCommand, PocketErrorCode } from "@pakka/protocol/pocket";
import type { ExtensionHost } from "./backend.ts";
import { ExtensionRefusal } from "./extension-host.ts";
import { decodeExtensionRequest, decodeExtensionResponse } from "./extension-rpc.ts";
import { decodeValue, publicPath } from "./extension.ts";

export interface PocketHttpOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly workspace: PocketWorkspace;
	readonly collaboration?: PocketCollaboration;
	readonly credentials?: PocketCredentials;
	readonly host?: string;
	readonly port?: number;
	readonly publicOrigin?: string;
	readonly allowInsecureRemote?: boolean;
	readonly trustedProxyPeers?: readonly string[];
	readonly pollMs?: number;
	readonly maxConnections?: number;
	/** Host-approved sources only; browser requests cannot supply modules or paths. */
	readonly extensions?: ExtensionHost;
	/** Host-accepted fixed public bytes only, no provider/configuration files. */
	readonly assets?: ReadonlyMap<string, { readonly type: string; readonly body: string | Uint8Array }>;
}
export interface PocketHttp {
	readonly origin: string;
	readonly serverId: string;
	close(): Promise<void>;
}
class Refusal extends Error {
	readonly status: number;
	readonly code: PocketErrorCode;
	readonly confirmedNoEffect: boolean;
	constructor(status: number, code: PocketErrorCode, confirmedNoEffect = false) {
		super("Pocket request refused");
		this.status = status;
		this.code = code;
		this.confirmedNoEffect = confirmedNoEffect;
	}
}
const header = (req: IncomingMessage, name: string) =>
	typeof req.headers[name] === "string" ? (req.headers[name] as string) : "";
const secret = (v: string) => /^[A-Za-z0-9_-]{43}$/.test(v);
const local = (host: string) => ["127.0.0.1", "::1", "localhost"].includes(host);
const normalizePeer = (peer: string) => (peer.startsWith("::ffff:") ? peer.slice(7) : peer);
function guard(check: () => void, status = 403) {
	try {
		check();
	} catch {
		throw new Refusal(status, status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
	}
}
function cookie(req: IncomingMessage, key: string): string {
	const values = header(req, "cookie")
		.split(";")
		.map((v) => v.trim())
		.filter((v) => v.startsWith(key + "="));
	if (values.length !== 1) throw new Refusal(401, "UNAUTHORIZED");
	const value = values[0]!.slice(key.length + 1);
	if (!secret(value)) throw new Refusal(401, "UNAUTHORIZED");
	return value;
}
async function json(req: IncomingMessage): Promise<unknown> {
	if (
		header(req, "content-type").split(";")[0]?.trim() !== "application/json" ||
		header(req, "content-encoding")
	)
		throw new Refusal(400, "INVALID_REQUEST");
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let bytes = 0,
		text = "";
	try {
		for await (const chunk of req) {
			bytes += chunk.length;
			if (bytes > POCKET_MAX_BYTES) throw new Refusal(413, "CAPACITY");
			text += decoder.decode(chunk, { stream: true });
		}
		text += decoder.decode();
		return JSON.parse(text) as unknown;
	} catch (error) {
		if (error instanceof Refusal) throw error;
		throw new Refusal(400, "INVALID_REQUEST");
	}
}
function originValue(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("Invalid explicit Pocket public origin");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.origin !== raw ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error("Invalid explicit Pocket public origin");
	return url;
}

/** A product-only cookie listener; never changes or delegates authorization to the v1 listener. */
export async function createPocketHttp(options: PocketHttpOptions): Promise<PocketHttp> {
	const { runtime, people, workspace } = options,
		host = options.host ?? "127.0.0.1",
		port = options.port ?? 0;
	const external = options.publicOrigin ? originValue(options.publicOrigin) : undefined,
		peers = [...(options.trustedProxyPeers ?? [])];
	if (
		!Number.isSafeInteger(port) ||
		port < 0 ||
		port > 65535 ||
		(!local(host) && !isIP(host)) ||
		peers.length > 16 ||
		peers.some((p) => !isIP(p)) ||
		(peers.length && (!external || external.protocol !== "https:")) ||
		((!local(host) || (external && !local(external.hostname))) &&
			external?.protocol !== "https:" &&
			!options.allowInsecureRemote)
	)
		throw new Error("Explicit Pocket remote/TLS boundary required");
	const pollMs = options.pollMs ?? 100,
		capacity = options.maxConnections ?? 32;
	if (
		!Number.isSafeInteger(pollMs) ||
		pollMs < 20 ||
		pollMs > 5000 ||
		!Number.isSafeInteger(capacity) ||
		capacity < 1 ||
		capacity > 128
	)
		throw new Error("Invalid finite Pocket transport options");
	const assets = new Map(
		[...(options.assets ?? [])].map(([path, value]) => [
			path,
			{
				type: value.type,
				body: typeof value.body === "string" ? Buffer.from(value.body) : Buffer.from(value.body),
			},
		]),
	);
	const importMap = assets
		.get("/")
		?.body.toString()
		.match(/<script type="importmap">([^<]+)<\/script>/)?.[1];
	const mapPolicy = importMap
		? " 'sha256-" + createHash("sha256").update(importMap).digest("base64") + "'"
		: "";
	const serverId = randomUUID(),
		streams = new Set<ServerResponse>();
	let origin = "",
		listeningHost = "",
		publicHost = "",
		busy = 0,
		closed = false;
	function boundary(req: IncomingMessage, requireOrigin: boolean) {
		const forwarding = ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for"].some(
			(name) => !!req.headers[name],
		);
		const peer = normalizePeer(req.socket.remoteAddress ?? "");
		if (forwarding) {
			if (
				!external ||
				!peers.includes(peer) ||
				header(req, "forwarded") ||
				header(req, "x-forwarded-host") !== external.host ||
				header(req, "x-forwarded-proto") !== external.protocol.slice(0, -1) ||
				header(req, "x-forwarded-for").includes(",")
			)
				throw new Refusal(403, "FORBIDDEN");
		} else if (peers.length || external?.protocol === "https:") {
			throw new Refusal(403, "FORBIDDEN");
		}
		const actualHost = header(req, "host");
		if (actualHost !== listeningHost && actualHost !== publicHost) throw new Refusal(403, "FORBIDDEN");
		const sentOrigin = header(req, "origin");
		if (
			(requireOrigin && sentOrigin !== origin) ||
			(sentOrigin && sentOrigin !== origin) ||
			header(req, "sec-fetch-site") === "cross-site"
		)
			throw new Refusal(403, "FORBIDDEN");
	}
	async function actor(req: IncomingMessage) {
		let bound: PocketAuthority;
		try {
			bound = await people.authenticate(cookie(req, "pakka_pocket"));
		} catch {
			throw new Refusal(401, "UNAUTHORIZED");
		}
		return bound;
	}
	function cookies(res: ServerResponse, session?: PocketSession) {
		const security = external?.protocol === "https:" ? "; Secure" : "";
		const age = session ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)) : 0;
		res.setHeader("Set-Cookie", [
			`pakka_pocket=${session?.token ?? ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${security}`,
			`pakka_csrf=${session?.csrf ?? ""}; Path=/; SameSite=Strict; Max-Age=${age}${security}`,
		]);
	}
	function send(res: ServerResponse, status: number, value: unknown) {
		if (res.destroyed) return;
		res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(value));
	}
	function preflight(a: PocketAuthority, command: PocketCommand) {
		let permission: PocketPermission | undefined, resource: string | undefined;
		switch (command.op) {
			case "configuration":
			case "read":
				permission = "read";
				resource = command.target.conversationId;
				break;
			case "collaboration.read":
			case "collaboration.post":
			case "collaboration.react":
			case "collaboration.presence":
				permission = "read";
				resource = command.target.conversationId;
				break;
			case "collaboration.note":
			case "collaboration.pin":
				permission = "send";
				resource = command.target.conversationId;
				break;
			case "collaboration.driver":
				permission = command.input.action === "take" ? "manage" : "steer";
				resource = command.target.conversationId;
				break;
			case "display":
				permission = "send";
				resource = command.target.conversationId;
				break;
			case "submit":
				permission = command.input.mode === "prompt" ? "send" : "steer";
				resource = command.target.conversationId;
				break;
			case "abort":
			case "configure":
				permission = "manage";
				resource = command.target.conversationId;
				break;
			case "create":
			case "fork":
				permission = "create";
				break;
			case "credential.status":
			case "credential.replace":
			case "credential.clear":
				permission = "extensions.install";
				break;
			case "invite":
			case "invite.revoke":
			case "person.revoke":
			case "person.set":
			case "people":
				permission = "invite";
				break;
		}
		guard(() => {
			people.current(a);
			if (permission) people.check(a, permission, resource);
			if (command.op === "fork") people.check(a, "manage", command.target.conversationId);
			if (command.op === "submit") options.collaboration?.checkInput(a, command.target);
		});
	}
	async function execute(
		a: PocketAuthority,
		command: PocketCommand,
		res: ServerResponse,
		signal: AbortSignal,
	): Promise<unknown> {
		const client = workspace.bind(a);
		if (
			command.op === "collaboration.read" ||
			command.op === "collaboration.post" ||
			command.op === "collaboration.note" ||
			command.op === "collaboration.react" ||
			command.op === "collaboration.pin" ||
			command.op === "collaboration.driver" ||
			command.op === "collaboration.presence"
		) {
			if (!options.collaboration) throw new Refusal(404, "UNSUPPORTED");
			const human = options.collaboration.bind(a);
			switch (command.op) {
				case "collaboration.read":
					break;
				case "collaboration.post":
					await human.post(command.target, command.input);
					break;
				case "collaboration.note":
					try {
						await human.editNote(command.target, command.input);
					} catch (failure) {
						if (failure instanceof PocketCollaborationConflict) throw new Refusal(409, "CONFLICT", true);
						throw failure;
					}
					break;
				case "collaboration.react":
					await human.react(command.target, command.input);
					break;
				case "collaboration.pin":
					await human.pin(command.target, command.input);
					break;
				case "collaboration.driver":
					await human.setDriver(command.target, command.input);
					break;
				case "collaboration.presence":
					await human.presence(command.target, command.input);
					break;
			}
			return { kind: "collaboration", snapshot: await human.snapshot(command.target) };
		}
		switch (command.op) {
			case "hello":
				return {
					kind: "hello",
					versions: [2],
					person: people.current(a),
					sessionId: runtime.view().sessionId,
				};
			case "list": {
				const rows = await client.navigation();
				return {
					kind: "list",
					conversations: rows.map((row) => row.ref),
					titles: Object.fromEntries(rows.map((row) => [row.ref.conversationId, row.name])),
				};
			}
			case "configuration":
				return { kind: "configuration", configuration: await client.configuration(command.target) };
			case "credential.status":
			case "credential.replace":
			case "credential.clear": {
				if (!options.credentials) throw new Refusal(404, "UNSUPPORTED", true);
				const privateClient = options.credentials.bind(a, () => {
					if (signal.aborted) throw new Error("Private configuration request ended");
				});
				try {
					const status =
						command.op === "credential.status"
							? await privateClient.status()
							: command.op === "credential.replace"
								? await privateClient.replace(command.input)
								: await privateClient.clear(command.input);
					return { kind: "credential", status };
				} catch (failure) {
					if (failure instanceof PocketCredentialConflict) throw new Refusal(409, "CONFLICT", true);
					throw failure;
				}
			}
			case "create":
				return {
					kind: "reference",
					ref: await client.create({
						requestId: command.requestId,
						name: command.name,
						profile: command.profile,
					}),
				};
			case "configure":
				return { kind: "reference", ref: await client.configure(command.target, command.profile) };
			case "fork":
				return {
					kind: "reference",
					ref: await client.fork(command.target, {
						requestId: command.requestId,
						name: command.name,
						profile: command.profile,
						entryId: command.entryId,
					}),
				};
			case "read":
				return { kind: "conversation", snapshot: await client.read(command.target, command.page) };
			case "display":
				return {
					kind: "display",
					receipt: await client.display(command.target, {
						requestId: command.requestId,
						kind: command.kind,
						text: command.text,
					}),
				};
			case "submit":
				return { kind: "receipt", receipt: await client.submit(command.target, command.input) };
			case "receipt":
				return { kind: "receipt", receipt: await client.receipt(command.id) };
			case "wait":
				return { kind: "receipt", receipt: await client.wait(command.id, signal) };
			case "withdraw":
				return { kind: "receipt", receipt: await client.withdraw(command.id) };
			case "abort":
				await client.abort(command.target);
				return { kind: "updated" };
			case "people":
				return { kind: "people", ...(await people.list(a)) };
			case "invite": {
				const value = await people.invite(a, {
					requestId: command.requestId,
					role: command.role,
					resources: command.resources,
					ttlMs: command.ttlMs,
					...(command.personId ? { personId: command.personId } : {}),
				});
				const qr = value.token
					? await QRCode.toDataURL(origin + "/#invite=" + value.token, {
							width: 256,
							margin: 2,
							errorCorrectionLevel: "M",
						})
					: undefined;
				return { kind: "invite", ...value, ...(qr ? { qr } : {}) };
			}
			case "invite.revoke":
				await people.revokeInvite(a, command.id);
				return { kind: "updated" };
			case "person.revoke":
				await people.revokePerson(a, command.id);
				return { kind: "updated" };
			case "person.set":
				await people.setPerson(a, command.personId, { role: command.role, resources: command.resources });
				return { kind: "updated" };
			case "session.rotate": {
				const session = await people.rotate(a);
				cookies(res, session);
				return { kind: "session", person: session.person, expiresAt: session.expiresAt };
			}
			case "session.logout":
				await people.logout(a);
				cookies(res);
				return { kind: "updated" };
		}
	}
	const server = createServer((req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Referrer-Policy", "no-referrer");
		res.setHeader(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'" +
				mapPolicy +
				"; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
		);
		const controller = new AbortController();
		res.once("close", () => controller.abort());
		let requestId = "invalid",
			dispatched = false;
		void (async () => {
			if (closed || busy >= capacity) throw new Refusal(503, "CAPACITY");
			busy++;
			try {
				boundary(req, req.method !== "GET");
				let url: URL;
				try {
					url = new URL(req.url ?? "", origin);
				} catch {
					throw new Refusal(400, "INVALID_REQUEST");
				}
				if (req.method === "POST" && url.pathname === "/pocket/exchange" && !url.search) {
					const input = await json(req);
					if (!input || typeof input !== "object" || Array.isArray(input))
						throw new Refusal(400, "INVALID_REQUEST");
					const v = input as Record<string, unknown>;
					if (
						Object.keys(v).some((k) => !["kind", "token", "name"].includes(k)) ||
						typeof v.token !== "string" ||
						!secret(v.token) ||
						!["session", "invite"].includes(v.kind as string) ||
						(v.kind === "invite" && (typeof v.name !== "string" || !v.name.trim() || v.name.length > 80))
					)
						throw new Refusal(400, "INVALID_REQUEST");
					let session: PocketSession;
					try {
						if (v.kind === "invite") {
							dispatched = true;
							session = await people.redeem(v.token, v.name as string);
						} else {
							const a = await people.authenticate(v.token);
							dispatched = true;
							session = await people.rotate(a);
						}
					} catch {
						if (runtime.view().phase !== "ready") throw new Error("Unconfirmed exchange");
						throw new Refusal(401, "UNAUTHORIZED");
					}
					cookies(res, session);
					send(res, 200, { version: 2, person: session.person, expiresAt: session.expiresAt });
					return;
				}
				if (req.method === "POST" && url.pathname === "/pocket/extensions/rpc" && !url.search) {
					if (!options.extensions) throw new Refusal(404, "UNSUPPORTED");
					const raw = await json(req);
					if (raw && typeof raw === "object" && "requestId" in raw && identity(raw.requestId))
						requestId = raw.requestId;
					let parsed;
					try {
						parsed = decodeExtensionRequest(raw);
					} catch {
						throw new Refusal(400, "INVALID_REQUEST");
					}
					const a = await actor(req);
					guard(() => a.verifyCsrf(header(req, "x-pakka-csrf")));
					const command = parsed.command,
						extensions = options.extensions;
					let result;
					try {
						switch (command.op) {
							case "list":
								result = { kind: "registrations", registrations: extensions.list(a, command.target) };
								break;
							case "operationByRequest":
								result = {
									kind: "operation",
									operation: await extensions.operationByRequest(a, command.request),
								};
								break;
							case "operation":
								result = { kind: "operation", operation: await extensions.operation(a, command.id) };
								break;
							case "call": {
								const call = command.call,
									registration = extensions
										.list(a, call.target)
										.find(
											(row) =>
												row.manifest.id === call.extension &&
												row.generation === call.generation &&
												row.phase === "ready",
										);
								const action = registration?.manifest.actions.find((row) => row.id === call.action);
								if (!action) throw new Refusal(403, "FORBIDDEN");
								try {
									decodeValue(action.input, call.input);
								} catch {
									throw new Refusal(400, "INVALID_REQUEST");
								}
								dispatched = true;
								result = { kind: "operation", operation: await extensions.call(a, call, controller.signal) };
								break;
							}
							default:
								guard(() => people.check(a, "extensions.install"));
								dispatched = true;
								if (command.op === "reload") await extensions.reload(a, command.extension);
								else await extensions.setEnabled(a, command.extension, command.op === "enable");
								result = { kind: "updated" };
						}
					} catch (error) {
						if (error instanceof ExtensionRefusal && !dispatched)
							throw new Refusal(error.code === "INVALID_REQUEST" ? 400 : 403, error.code);
						throw error;
					}
					guard(() => people.current(a));
					send(res, 200, decodeExtensionResponse({ version: 2, requestId, serverId, result }, requestId));
					return;
				}
				if (req.method === "GET" && url.pathname.startsWith("/pocket/extensions/assets/")) {
					if (!options.extensions) throw new Refusal(404, "UNSUPPORTED");
					const a = await actor(req),
						parts = url.pathname.slice("/pocket/extensions/assets/".length).split("/");
					const [id, generation, ...path] = parts,
						resource = url.searchParams.get("conversationId");
					if (
						!id ||
						!generation ||
						!publicPath(path.join("/")) ||
						[...url.searchParams.keys()].some((key) => key !== "conversationId") ||
						url.searchParams.getAll("conversationId").length > 1
					)
						throw new Refusal(400, "INVALID_REQUEST");
					const target = resource
						? runtime.view().conversations.find((ref) => ref.conversationId === resource)
						: undefined;
					if (resource && !target) throw new Refusal(403, "FORBIDDEN");
					try {
						const asset = await options.extensions.asset(a, id, generation, path.join("/"), target);
						guard(() => people.current(a));
						res.writeHead(200, { "Content-Type": asset.type });
						res.end(asset.body);
					} catch (error) {
						if (error instanceof ExtensionRefusal) throw new Refusal(403, error.code);
						throw error;
					}
					return;
				}
				if (req.method === "POST" && url.pathname === "/pocket/rpc" && !url.search) {
					const raw = await json(req);
					if (raw && typeof raw === "object" && "requestId" in raw && identity(raw.requestId))
						requestId = raw.requestId;
					let parsed;
					try {
						parsed = decodePocketRequest(raw);
					} catch {
						throw new Refusal(400, "INVALID_REQUEST");
					}
					const a = await actor(req);
					guard(() => a.verifyCsrf(header(req, "x-pakka-csrf")));
					requestId = parsed.requestId;
					preflight(a, parsed.command);
					dispatched = true;
					const result = await execute(a, parsed.command, res, controller.signal);
					if (!["session.rotate", "session.logout"].includes(parsed.command.op))
						guard(() => people.current(a));
					const response = decodePocketResponse({ version: 2, serverId, requestId, result }, requestId);
					send(res, 200, response);
					return;
				}
				if (req.method === "GET" && url.pathname === "/pocket/events") {
					const a = await actor(req),
						id = url.searchParams.get("conversationId");
					if (!id || !identity(id) || [...url.searchParams.keys()].some((key) => key !== "conversationId"))
						throw new Refusal(400, "INVALID_REQUEST");
					guard(() => people.check(a, "read", id));
					const ref = runtime.view().conversations.find((ref) => ref.conversationId === id);
					if (!ref) throw new Refusal(403, "FORBIDDEN");
					streams.add(res);
					res.once("close", () => streams.delete(res));
					res.writeHead(200, {
						"Content-Type": "text/event-stream; charset=utf-8",
						Connection: "keep-alive",
						"X-Accel-Buffering": "no",
					});
					res.flushHeaders();
					const streamId = randomUUID();
					let sequence = 0,
						prior = "",
						priorHuman = "",
						lastSent = 0;
					const emit = async (data: Record<string, unknown>) => {
						people.check(a, "read", id);
						const value = decodePocketEvent({
							version: 2,
							serverId,
							streamId,
							sequence: ++sequence,
							...data,
						});
						if (
							!res.write(
								"id: " +
									serverId +
									":" +
									streamId +
									":" +
									sequence +
									"\nevent: pocket\ndata: " +
									JSON.stringify(value) +
									"\n\n",
							)
						) {
							await new Promise<void>((resolve, reject) => {
								const finish = (failure?: Error) => {
									clearTimeout(timer);
									res.removeListener("drain", drained);
									controller.signal.removeEventListener("abort", aborted);
									if (failure) reject(failure);
									else resolve();
								};
								const drained = () => finish(),
									aborted = () => finish(new Error("Pocket stream closed"));
								const timer = setTimeout(
									() => finish(new Error("Slow Pocket reader requires resnapshot")),
									1000,
								);
								res.once("drain", drained);
								controller.signal.addEventListener("abort", aborted, { once: true });
								if (controller.signal.aborted || res.destroyed || res.writableEnded) aborted();
							});
							people.check(a, "read", id);
						}
						lastSent = Date.now();
					};
					try {
						// Every reconnect establishes a fresh scoped snapshot; never replay a mutation.
						if (header(req, "last-event-id")) await emit({ kind: "resnapshot" });
						while (!controller.signal.aborted) {
							const snapshot = await workspace.bind(a).read(ref),
								bytes = JSON.stringify(snapshot);
							people.check(a, "read", id);
							if (bytes !== prior || Date.now() - lastSent >= 5000) {
								await emit({ kind: "conversation", snapshot });
								prior = bytes;
							}
							if (options.collaboration) {
								const shared = await options.collaboration.bind(a).snapshot(ref),
									bytesHuman = JSON.stringify(shared);
								if (bytesHuman !== priorHuman) {
									await emit({ kind: "collaboration", snapshot: shared });
									priorHuman = bytesHuman;
								}
							}
							await new Promise<void>((resolve) => {
								const finish = () => {
									clearTimeout(timer);
									controller.signal.removeEventListener("abort", finish);
									resolve();
								};
								const timer = setTimeout(finish, pollMs);
								controller.signal.addEventListener("abort", finish, { once: true });
								if (controller.signal.aborted) finish();
							});
						}
					} catch {
						if (res.writableNeedDrain)
							res.destroy(); /* Stale authority or a bounded slow/disconnected reader ends this generation. */
					} finally {
						streams.delete(res);
						if (!res.destroyed) res.end();
					}
					return;
				}
				if (req.method === "GET" && !url.search) {
					const asset = assets.get(url.pathname);
					if (asset) {
						res.writeHead(200, { "Content-Type": asset.type });
						res.end(asset.body);
						return;
					}
				}
				throw new Refusal(404, "UNSUPPORTED");
			} finally {
				busy--;
			}
		})().catch((error) => {
			if (res.headersSent) {
				res.end();
				return;
			}
			const refusal = error instanceof Refusal,
				status = refusal ? error.status : 500;
			send(res, status, {
				version: 2,
				requestId,
				serverId,
				error: {
					code: refusal ? error.code : "UNKNOWN",
					outcome: refusal && (!dispatched || error.confirmedNoEffect) ? "denied" : "unknown",
					message: refusal ? "Pocket request refused" : "Pocket operation outcome unconfirmed",
				},
			});
		});
	});
	server.requestTimeout = 15000;
	server.headersTimeout = 10000;
	server.keepAliveTimeout = 5000;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Pocket listener missing");
	}
	listeningHost = `${host.includes(":") ? `[${host}]` : host}:${address.port}`;
	publicHost = external?.host ?? listeningHost;
	origin = external?.origin ?? `http://${listeningHost}`;
	return Object.freeze({
		origin,
		serverId,
		close: async () => {
			if (closed) return;
			closed = true;
			for (const stream of streams) stream.end();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
		},
	});
}
