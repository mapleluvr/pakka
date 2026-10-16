import { createRuntime } from "@pakka/agent";
import type { RuntimeOptions } from "@pakka/agent";
import { createMas } from "@pakka/mas";
import type { Mas, MasGrant } from "@pakka/mas";
import { profileDevPacks, retainedProductRoots } from "./profile-devpack.ts";
import type { ProfileDevPackConfig } from "./profile-devpack.ts";
import { productDynamite, validProductDynamite } from "./product-dynamite.ts";
import type { ProductDynamiteConfig } from "./product-dynamite.ts";
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
	readonly devpack?: ProfileDevPackConfig;
	readonly dynamite?: ProductDynamiteConfig;
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
function inferenceConfig(value: unknown): boolean {
	if (
		!shape(value, ["models", "policies"]) ||
		!Array.isArray(value.models) ||
		!Array.isArray(value.policies) ||
		value.models.length < 1 ||
		value.models.length > 128 ||
		value.policies.length < 1 ||
		value.policies.length > 128
	)
		return false;
	if (
		value.models.some(
			(model) =>
				!shape(
					model,
					["key", "model", "endpoint", "apiKey", "contextWindow", "maxTokens"],
					["name", "reasoning", "headers"],
				) ||
				!identity(model.key) ||
				!["model", "endpoint", "apiKey"].every((key) => text(model[key])) ||
				!positive(model.contextWindow) ||
				!positive(model.maxTokens) ||
				(model.name !== undefined && !text(model.name)) ||
				(model.reasoning !== undefined && typeof model.reasoning !== "boolean") ||
				(model.headers !== undefined &&
					(!record(model.headers) ||
						Object.keys(model.headers).length > 128 ||
						Object.values(model.headers).some((header) => !text(header)))),
		)
	)
		return false;
	const keys = value.models.map((model) => model.key);
	return (
		new Set(keys).size === keys.length &&
		new Set(value.policies.map((policy) => (record(policy) ? policy.strategyId : null))).size ===
			value.policies.length &&
		value.policies.every(
			(policy) =>
				shape(policy, [
					"strategyId",
					"modelKeys",
					"maxCalls",
					"maxJobCalls",
					"maxOutputTokens",
					"timeoutMs",
				]) &&
				identity(policy.strategyId) &&
				Array.isArray(policy.modelKeys) &&
				policy.modelKeys.length > 0 &&
				new Set(policy.modelKeys).size === policy.modelKeys.length &&
				policy.modelKeys.every((key) => keys.includes(key)) &&
				["maxCalls", "maxJobCalls", "maxOutputTokens", "timeoutMs"].every((key) => positive(policy[key])),
		)
	);
}
function runtimeConfig(value: unknown): value is RuntimeOptions {
	return (
		shape(
			value,
			["cwd", "dataDir", "endpoint", "model", "apiKey", "systemPrompt", "limits"],
			["reopenSessionFile", "reservedSessionId", "maxOutputTokens", "profiles", "inference"],
		) &&
		["cwd", "dataDir", "endpoint", "model", "apiKey", "systemPrompt"].every((key) => text(value[key])) &&
		shape(value.limits, ["maxConversations", "maxPrimaryAttempts", "maxAuxiliaryAttempts"]) &&
		Object.values(value.limits).every(positive) &&
		(value.reopenSessionFile === undefined || text(value.reopenSessionFile)) &&
		(value.reservedSessionId === undefined || identity(value.reservedSessionId)) &&
		(value.maxOutputTokens === undefined || positive(value.maxOutputTokens)) &&
		(value.inference === undefined || inferenceConfig(value.inference)) &&
		(value.profiles === undefined ||
			(Array.isArray(value.profiles) &&
				value.profiles.length <= 128 &&
				value.profiles.every(
					(profile) =>
						shape(profile, ["id", "systemPrompt"], ["model"]) &&
						(profile.model === undefined ||
							(typeof profile.model === "string" &&
								profile.model.length > 0 &&
								profile.model.length <= 256 &&
								profile.model.trim() === profile.model &&
								!/[\x00-\x1f\x7f]/.test(profile.model))) &&
						identity(profile.id) &&
						profile.id !== "default" &&
						text(profile.systemPrompt),
				)))
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
		!shape(value, ["schema", "runtime", "mas", "members", "roles"], ["http", "devpack", "dynamite"]) ||
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
	if (value.devpack !== undefined) {
		const pack = value.devpack;
		const approvedProfiles = new Set([
			"default",
			...(value.runtime.profiles ?? []).map((profile) => profile.id),
		]);
		if (
			!shape(pack, ["profiles"], ["operationTimeoutMs"]) ||
			!record(pack.profiles) ||
			Object.keys(pack.profiles).length === 0 ||
			Object.keys(pack.profiles).length > 128 ||
			Object.entries(pack.profiles).some(
				([id, allowed]) =>
					!identity(id) ||
					!approvedProfiles.has(id) ||
					!Array.isArray(allowed) ||
					allowed.some((grant) => !grants.includes(grant)),
			) ||
			(pack.operationTimeoutMs !== undefined &&
				(!positive(pack.operationTimeoutMs) || Number(pack.operationTimeoutMs) > 60000))
		)
			throw new Error("Invalid approved product DevPack configuration");
		// Remote profile selection cannot mint a model's root authority in this mode.
		if (
			value.roles.some((role) =>
				role.grants.some((grant: MasGrant) => ["spawn", "configure", "fork"].includes(grant)),
			)
		)
			throw new Error("RPC profile management with DevPack is unsupported");
	}
	if (value.dynamite !== undefined) {
		// Root/member shape above is checked before this identity/selection validation.
		if (!validProductDynamite(value.dynamite, value.members))
			throw new Error("Invalid approved product Dynamite configuration");
		if (
			value.roles.some((role) =>
				role.grants.some((grant: MasGrant) => ["spawn", "configure", "fork"].includes(grant)),
			)
		)
			throw new Error("RPC profile management with Dynamite is unsupported");
	}
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
export async function bootstrapServer(config: BootstrapConfig): Promise<{
	readonly server: MasServer;
	readonly revokeDynamite?: (key: string) => void;
	close(): Promise<void>;
}> {
	const approved = decodeBootstrap(config);
	let mas: Mas | undefined;
	const dynamite = await productDynamite(approved);
	const packs = profileDevPacks(approved.devpack, () => mas),
		main = packs.get("default");
	const tools = (profile: string) => {
		const selected = [...(packs.get(profile)?.tools ?? []), ...(dynamite?.tools(profile) ?? [])];
		if (new Set(selected.map((tool) => tool.name)).size !== selected.length)
			throw new Error("Conflicting approved product tools");
		return selected;
	};
	const runtime = await createRuntime({
		...approved.runtime,
		...(main || dynamite ? { tools: tools("default") } : {}),
		...(main ? { systemPrompt: [approved.runtime.systemPrompt, main.instructions].join("\n\n") } : {}),
		profiles: approved.runtime.profiles?.map((profile) => {
			const pack = packs.get(profile.id);
			return pack
				? {
						...profile,
						tools: tools(profile.id),
						systemPrompt: [profile.systemPrompt, pack.instructions].join("\n\n"),
					}
				: { ...profile, tools: dynamite ? tools(profile.id) : (profile.tools ?? []) };
		}),
	});
	try {
		mas = await createMas({ ...approved.mas, runtime });
		const existing = await mas.view();
		if (
			approved.devpack &&
			approved.runtime.reopenSessionFile &&
			existing.members.length > approved.members.length
		) {
			retainedProductRoots(existing.members, approved.members);
			const catalog = runtime.catalog(approved.mas);
			for (const member of existing.members) {
				if (
					member.lifetime === "persistent" &&
					member.phase === "active" &&
					(await catalog.readiness(member.ref)).phase !== "ready"
				)
					throw new Error("Product reopen persistent readiness unconfirmed");
			}
		} else {
			await mas.bootstrap(approved.members);
			await mas.activate();
		}
		await dynamite?.install(runtime, mas);
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
			...(dynamite ? { revokeDynamite: (key: string) => dynamite.revoke(key) } : {}),
			close: () =>
				(closed ??= (async () => {
					try {
						await server.close();
					} finally {
						try {
							await dynamite?.close();
						} finally {
							await runtime.close();
						}
					}
				})()),
		});
	} catch (error) {
		try {
			await dynamite?.close();
		} finally {
			await runtime.close();
		}
		throw error;
	}
}
