import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { Mas, MasClient, MasGrant } from "@pakka/mas";
import { MasRequestDenied } from "@pakka/mas";
import { decodeRequest, decodeResponse, identity, MAX_WIRE_BYTES } from "@pakka/protocol";
import type { AgentRef, Command, Failure, Member, Receipt, Request, Response, Result } from "@pakka/protocol";

export interface ServerRole {
	readonly token: string;
	readonly principal: string;
	readonly source: AgentRef | null;
	readonly grants: readonly MasGrant[];
	readonly canRevoke?: boolean;
	readonly expiresAt?: number;
}
export interface MasServerOptions {
	readonly mas: Mas;
	readonly sessionId: string;
	readonly roles: readonly ServerRole[];
	readonly origins?: readonly string[];
	readonly port?: number;
	readonly maxPending?: number;
}
export interface MasServer {
	readonly endpoint: string;
	readonly serverId: string;
	revoke(principal: string): void;
	close(): Promise<void>;
}
const grantNames: readonly MasGrant[] = [
	"discover",
	"send",
	"reply",
	"observe",
	"spawn",
	"steer",
	"abort",
	"retire",
	"configure",
	"fork",
];
function secretKey(token: string) {
	return createHash("sha256").update(token).digest("hex");
}
function visibleMember(value: Member): Member {
	const { key, ref, owner, lifetime, phase, reason } = value;
	return {
		key,
		ref,
		owner,
		lifetime,
		phase,
		...(reason === undefined ? {} : { reason: "Resource state unavailable" }),
	};
}
function visibleReceipt(value: Receipt): Receipt {
	const { reason, ...receipt } = value;
	return reason === undefined ? receipt : { ...receipt, reason: "Delivery outcome unconfirmed" };
}

/** Explicit trusted composition. Roles are issuer state; serialized refs never confer authority. */
export async function createMasServer(options: MasServerOptions): Promise<MasServer> {
	const maxPending = options.maxPending ?? 32,
		port = options.port ?? 0;
	if (
		!identity(options.sessionId) ||
		!Number.isSafeInteger(maxPending) ||
		maxPending < 1 ||
		maxPending > 256 ||
		!Number.isSafeInteger(port) ||
		port < 0 ||
		port > 65535 ||
		!options.roles.length ||
		options.roles.length > 128
	)
		throw new Error("Invalid finite server options");
	const mas = options.mas,
		serverId = randomUUID(),
		origins = new Set(options.origins ?? []);
	for (const origin of origins) {
		try {
			const url = new URL(origin);
			if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
				throw new Error("Invalid approved origin");
		} catch {
			throw new Error("Invalid approved origin");
		}
	}
	const roles = new Map<string, { readonly config: ServerRole; active: boolean }>();
	for (const role of options.roles) {
		if (
			!identity(role.principal) ||
			typeof role.token !== "string" ||
			!/^[-a-zA-Z0-9._]{32,256}$/.test(role.token) ||
			!Array.isArray(role.grants) ||
			role.grants.some((grant) => !grantNames.includes(grant)) ||
			(role.expiresAt !== undefined && (!Number.isSafeInteger(role.expiresAt) || role.expiresAt < 1))
		)
			throw new Error("Invalid server role");
		const key = secretKey(role.token);
		if (roles.has(key)) throw new Error("Duplicate server credential");
		const source = role.source === null ? null : Object.freeze({ ...role.source });
		const config = Object.freeze({ ...role, source, grants: Object.freeze([...role.grants]) });
		mas.connect(config); // Existing MAS validates principal/source membership; no grant is minted here.
		roles.set(key, { config, active: true });
	}
	let closing = false,
		host = "";
	const active = new Set<AbortController>();
	const revoke = (principal: string) => {
		for (const role of roles.values()) if (role.config.principal === principal) role.active = false;
		mas.revoke(principal);
	};
	function write(res: ServerResponse, id: string, result: Result | Failure, status = 200) {
		if (res.destroyed || res.writableEnded) return;
		const response: Response =
			"kind" in result
				? { version: 1, requestId: id, serverId, result }
				: { version: 1, requestId: id, serverId, error: result };
		// Validate outbound fields and byte bounds too. Never ship arbitrary internal error objects.
		const safe = decodeResponse(response, id);
		res.writeHead(status, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		});
		res.end(JSON.stringify(safe));
	}
	function refused(res: ServerResponse, id: string, code: Failure["code"], status: number) {
		write(res, id, { code, outcome: "denied", message: "Request refused" }, status);
	}
	async function body(req: IncomingMessage): Promise<string> {
		let bytes = 0;
		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			bytes += buffer.length;
			if (bytes > MAX_WIRE_BYTES) throw new Error("Request size limit");
			chunks.push(buffer);
		}
		return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
	}
	async function dispatch(
		client: MasClient,
		command: Command,
		role: ServerRole,
		check: () => void,
		signal: AbortSignal,
	): Promise<Result> {
		switch (command.op) {
			case "hello":
				return { kind: "hello", principal: role.principal, sessionId: options.sessionId, versions: [1] };
			case "snapshot": {
				client.authorize("discover");
				const view = await mas.view();
				check();
				const members = client.discover().map(visibleMember);
				return {
					kind: "snapshot",
					sessionId: options.sessionId,
					namespace: view.namespace,
					version: view.version,
					phase: view.phase,
					members,
				};
			}
			case "send":
				return { kind: "receipt", receipt: visibleReceipt(await client.send(command.target, command.input)) };
			case "reply":
				return {
					kind: "receipt",
					receipt: visibleReceipt(await client.reply(command.receiptId, command.input)),
				};
			case "receipt":
				return { kind: "receipt", receipt: visibleReceipt(await client.receipt(command.id)) };
			case "wait":
				return { kind: "receipt", receipt: visibleReceipt(await client.wait(command.id, signal)) };
			case "withdraw":
				return { kind: "receipt", receipt: visibleReceipt(await client.withdraw(command.id)) };
			case "spawn":
				return {
					kind: "member",
					member: visibleMember(
						await client.spawn({
							key: command.key,
							...(command.profile === undefined ? {} : { profile: command.profile }),
							lifetime: "persistent",
						}),
					),
				};
			case "inspect":
				return { kind: "member", member: visibleMember(await client.inspect(command.target)) };
			case "abort":
				return { kind: "member", member: visibleMember(await client.abort(command.target)) };
			case "retire":
				return { kind: "member", member: visibleMember(await client.retire(command.target)) };
			case "configure":
				return {
					kind: "member",
					member: visibleMember(await client.configure(command.target, command.profile)),
				};
			case "fork":
				return {
					kind: "member",
					member: visibleMember(
						await client.fork(command.target, { key: command.key, entryId: command.entryId }),
					),
				};
			case "revoke":
				if (!role.canRevoke) throw new MasRequestDenied("Host role administration unavailable");
				check();
				revoke(command.principal);
				return { kind: "revoked", principal: command.principal };
		}
	}
	async function handle(req: IncomingMessage, res: ServerResponse) {
		if (req.headers.host !== host) {
			refused(res, "invalid", "FORBIDDEN", 403);
			return;
		}
		const origin = req.headers.origin;
		if (origin !== undefined && !origins.has(origin)) {
			refused(res, "invalid", "FORBIDDEN", 403);
			return;
		}
		if (origin) {
			res.setHeader("Access-Control-Allow-Origin", origin);
			res.setHeader("Vary", "Origin");
		}
		if (req.url !== "/rpc") {
			refused(res, "invalid", "INVALID_REQUEST", 404);
			return;
		}
		if (req.method === "OPTIONS") {
			if (!origin || req.headers["access-control-request-method"] !== "POST") {
				refused(res, "invalid", "FORBIDDEN", 403);
				return;
			}
			res.writeHead(204, {
				"Access-Control-Allow-Methods": "POST",
				"Access-Control-Allow-Headers": "Authorization, Content-Type",
				"Access-Control-Max-Age": "0",
			});
			res.end();
			return;
		}
		if (req.method !== "POST" || req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
			refused(res, "invalid", "INVALID_REQUEST", 400);
			return;
		}
		if (closing || active.size >= maxPending) {
			refused(res, "invalid", "CAPACITY", 429);
			return;
		}
		const controller = new AbortController();
		active.add(controller);
		req.once("aborted", () => controller.abort());
		res.once("close", () => {
			if (!res.writableEnded) controller.abort();
		});
		let id = "invalid",
			attempted = false;
		try {
			let request: Request;
			try {
				const raw: unknown = JSON.parse(await body(req));
				// A bounded descriptive identity may correlate a refusal; it grants no command authority.
				if (raw !== null && typeof raw === "object" && "requestId" in raw && identity(raw.requestId))
					id = raw.requestId;
				request = decodeRequest(raw);
			} catch {
				refused(res, id, "INVALID_REQUEST", 400);
				return;
			}
			id = request.requestId;
			const authorization = req.headers.authorization;
			const bearer =
				typeof authorization === "string" && /^Bearer [-a-zA-Z0-9._]{1,256}$/.test(authorization)
					? authorization.slice(7)
					: "";
			const entry = roles.get(secretKey(bearer));
			if (!entry?.active || (entry.config.expiresAt !== undefined && Date.now() >= entry.config.expiresAt)) {
				refused(res, id, "UNAUTHORIZED", 401);
				return;
			}
			const check = () => {
				if (
					closing ||
					controller.signal.aborted ||
					!entry.active ||
					(entry.config.expiresAt !== undefined && Date.now() >= entry.config.expiresAt)
				)
					throw new Error("Remote authority inactive");
			};
			const client = mas.connect(entry.config).withAuthority(check);
			const op = request.command.op;
			const grant: MasGrant | undefined =
				op === "hello" || op === "revoke"
					? undefined
					: op === "snapshot"
						? "discover"
						: op === "receipt" || op === "wait" || op === "inspect"
							? "observe"
							: op === "withdraw"
								? "send"
								: op;
			if (grant) client.authorize(grant);
			if (
				(op === "send" || op === "reply") &&
				request.command.input.mode &&
				request.command.input.mode !== "prompt"
			)
				client.authorize("steer");
			check();
			attempted = true;
			const result = await dispatch(client, request.command, entry.config, check, controller.signal);
			// A confirmed native outcome is not reclassified as non-delivery if authority expired afterwards.
			write(res, id, result);
		} catch (error) {
			const known = !attempted || error instanceof MasRequestDenied;
			write(
				res,
				id,
				{
					code: known ? "FORBIDDEN" : "UNKNOWN",
					outcome: known ? "denied" : "unknown",
					message: known ? "Request refused" : "Operation outcome unconfirmed",
				},
				known ? 403 : 503,
			);
		} finally {
			active.delete(controller);
		}
	}
	const server = createServer(
		{ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 },
		(req, res) => {
			void handle(req, res).catch(() => {
				if (!res.destroyed && !res.writableEnded) {
					res.writeHead(503, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							version: 1,
							requestId: "invalid",
							serverId,
							error: { code: "UNKNOWN", outcome: "unknown", message: "Operation outcome unconfirmed" },
						}),
					);
				}
			});
		},
	);
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(port, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Loopback address unavailable");
		host = "127.0.0.1:" + address.port;
	} catch (error) {
		server.close();
		throw error;
	}
	return Object.freeze({
		endpoint: "http://" + host + "/rpc",
		serverId,
		revoke,
		close: async () => {
			if (closing) return;
			closing = true;
			for (const controller of active) controller.abort();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
		},
	});
}
