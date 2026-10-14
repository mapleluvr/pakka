import { createRuntime } from "@pakka/agent";
import type { RuntimeOptions } from "@pakka/agent";
import { createMas } from "@pakka/mas";
import type { MasGrant } from "@pakka/mas";
import { identity } from "@pakka/protocol";
import { createMasServer } from "./http-server.ts";
import type { MasServer, ServerRole } from "./http-server.ts";

interface RoleConfig {
	readonly token: string;
	readonly principal: string;
	readonly sourceKey: string | null;
	readonly grants: readonly MasGrant[];
	readonly canRevoke?: boolean;
	readonly expiresAt?: number;
}
export interface BootstrapConfig {
	readonly schema: "pakka.server.v1";
	readonly runtime: RuntimeOptions;
	readonly mas: { readonly namespace: string; readonly maxDeliveries: number; readonly maxPending: number };
	readonly members: readonly { readonly key: string; readonly owner: string; readonly profile?: string }[];
	readonly roles: readonly RoleConfig[];
	readonly http?: {
		readonly port?: number;
		readonly origins?: readonly string[];
		readonly maxPending?: number;
	};
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
function shape(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): value is Record<string, unknown> {
	return (
		record(value) &&
		required.every((key) => Object.hasOwn(value, key)) &&
		Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
	);
}
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 65536;
function runtimeConfig(value: unknown): value is RuntimeOptions {
	return (
		shape(
			value,
			["cwd", "dataDir", "endpoint", "model", "apiKey", "systemPrompt", "limits"],
			["reopenSessionFile", "reservedSessionId", "maxOutputTokens"],
		) &&
		["cwd", "dataDir", "endpoint", "model", "apiKey", "systemPrompt"].every((key) => text(value[key])) &&
		shape(value.limits, ["maxConversations", "maxPrimaryAttempts", "maxAuxiliaryAttempts"]) &&
		Object.values(value.limits).every(positive) &&
		(value.reopenSessionFile === undefined || text(value.reopenSessionFile)) &&
		(value.reservedSessionId === undefined || identity(value.reservedSessionId)) &&
		(value.maxOutputTokens === undefined || positive(value.maxOutputTokens))
	);
}
const grants: readonly MasGrant[] = [
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
export function decodeBootstrap(value: unknown): BootstrapConfig {
	if (
		!shape(value, ["schema", "runtime", "mas", "members", "roles"], ["http"]) ||
		value.schema !== "pakka.server.v1" ||
		!runtimeConfig(value.runtime) ||
		!shape(value.mas, ["namespace", "maxDeliveries", "maxPending"]) ||
		!identity(value.mas.namespace) ||
		!positive(value.mas.maxDeliveries) ||
		!positive(value.mas.maxPending) ||
		!Array.isArray(value.members) ||
		value.members.length === 0 ||
		value.members.length > 512 ||
		value.members.some(
			(member) =>
				!shape(member, ["key", "owner"], ["profile"]) ||
				!identity(member.key) ||
				!identity(member.owner) ||
				(member.profile !== undefined && !identity(member.profile)),
		) ||
		!Array.isArray(value.roles) ||
		value.roles.length === 0 ||
		value.roles.length > 128 ||
		value.roles.some(
			(role) =>
				!shape(role, ["token", "principal", "sourceKey", "grants"], ["canRevoke", "expiresAt"]) ||
				typeof role.token !== "string" ||
				!/^[-a-zA-Z0-9._]{32,256}$/.test(role.token) ||
				!identity(role.principal) ||
				(role.sourceKey !== null && !identity(role.sourceKey)) ||
				!Array.isArray(role.grants) ||
				role.grants.some((grant) => !grants.includes(grant)) ||
				(role.canRevoke !== undefined && typeof role.canRevoke !== "boolean") ||
				(role.expiresAt !== undefined && !positive(role.expiresAt)),
		)
	)
		throw new Error("Invalid explicit server configuration");
	if (value.http !== undefined) {
		if (
			!shape(value.http, [], ["port", "origins", "maxPending"]) ||
			(value.http.port !== undefined &&
				(!Number.isSafeInteger(value.http.port) ||
					Number(value.http.port) < 0 ||
					Number(value.http.port) > 65535)) ||
			(value.http.maxPending !== undefined && !positive(value.http.maxPending)) ||
			(value.http.origins !== undefined &&
				(!Array.isArray(value.http.origins) ||
					value.http.origins.some((origin) => typeof origin !== "string")))
		)
			throw new Error("Invalid explicit transport configuration");
	}
	// SAFETY: complete closed config/roles/limits validated; actual gate validates runtime/model/storage identity before opening.
	return value as unknown as BootstrapConfig;
}
/** Host-selected config only. No import-time startup, discovery or model request. */
export async function bootstrapServer(
	config: BootstrapConfig,
): Promise<{ readonly server: MasServer; close(): Promise<void> }> {
	const approved = decodeBootstrap(config),
		runtime = await createRuntime(approved.runtime);
	try {
		const mas = await createMas({ ...approved.mas, runtime });
		await mas.bootstrap(approved.members);
		await mas.activate();
		const view = await mas.view();
		const roles: ServerRole[] = approved.roles.map((role) => {
			const source =
				role.sourceKey === null ? null : view.members.find((member) => member.key === role.sourceKey)?.ref;
			if (source === undefined) throw new Error("Configured role source missing");
			return {
				token: role.token,
				principal: role.principal,
				source,
				grants: role.grants,
				...(role.canRevoke === undefined ? {} : { canRevoke: role.canRevoke }),
				...(role.expiresAt === undefined ? {} : { expiresAt: role.expiresAt }),
			};
		});
		const server = await createMasServer({
			mas,
			sessionId: runtime.view().sessionId,
			roles,
			...approved.http,
		});
		let closed: Promise<void> | undefined;
		return Object.freeze({
			server,
			close: () =>
				(closed ??= (async () => {
					try {
						await server.close();
					} finally {
						await runtime.close();
					}
				})()),
		});
	} catch (error) {
		await runtime.close();
		throw error;
	}
}
