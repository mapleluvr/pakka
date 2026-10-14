import { createHash } from "node:crypto";
import type { Mas, Member, MasGrant } from "@pakka/mas";
import { createMasDevPack } from "@pakka/mas-devpack";

export interface ProfileDevPackConfig {
	readonly profiles: Readonly<Record<string, readonly MasGrant[]>>;
	readonly operationTimeoutMs?: number;
}
function principal(member: Member): string {
	return (
		"worker-agent-" +
		createHash("sha256")
			.update(JSON.stringify([member.ref.sessionId, member.ref.conversationId]))
			.digest("hex")
			.slice(0, 48)
	);
}
/** Validate retained descendants against the trusted initial roots; owner data is never a new grant. */
export function retainedProductRoots(
	members: readonly Member[],
	roots: readonly { readonly key: string; readonly owner: string; readonly profile?: string }[],
): readonly Member[] {
	const expected = new Map(roots.map((root) => [root.key, root]));
	const configured = members.filter((member) => expected.has(member.key));
	if (
		configured.length !== roots.length ||
		configured.some((member) => {
			const root = expected.get(member.key)!;
			return (
				member.owner !== root.owner ||
				member.ref.profile !== (root.profile ?? "default") ||
				member.lifetime !== "persistent" ||
				member.phase !== "active"
			);
		})
	)
		throw new Error("Product reopen roots conflict");
	const parents = new Map(members.map((member) => [principal(member), member]));
	for (const member of members) {
		if (["preparing", "ready", "stopping", "failed", "unknown"].includes(member.phase))
			throw new Error("Product reopen member state unconfirmed");
		let current = member;
		const seen = new Set<string>();
		while (!expected.has(current.key)) {
			if (seen.has(current.owner)) throw new Error("Product reopen ownership cycle");
			seen.add(current.owner);
			const parent = parents.get(current.owner);
			if (!parent) throw new Error("Product reopen descendant owner unknown");
			current = parent;
		}
	}
	return configured;
}
function effectiveGrants(
	member: Member,
	members: readonly Member[],
	profiles: ProfileDevPackConfig["profiles"],
): readonly MasGrant[] {
	const parents = new Map(members.map((candidate) => [principal(candidate), candidate]));
	let grants = [...(profiles[member.ref.profile] ?? [])],
		current = member;
	const seen = new Set<string>();
	while (current.owner.startsWith("worker-agent-")) {
		if (seen.has(current.owner)) throw new Error("DevPack grant ownership cycle");
		seen.add(current.owner);
		const parent = parents.get(current.owner);
		if (!parent) throw new Error("DevPack grant owner unknown");
		const ceiling = new Set(profiles[parent.ref.profile] ?? []);
		grants = grants.filter((grant) => ceiling.has(grant));
		current = parent;
	}
	return grants;
}
/** Private app wiring only: no native handles or refreshable invocation escapes. */
export function profileDevPacks(config: ProfileDevPackConfig | undefined, getMas: () => Mas | undefined) {
	const profiles = Object.fromEntries(
		Object.entries(config?.profiles ?? {}).map(([id, grants]) => [id, [...grants]]),
	);
	return new Map(
		Object.keys(profiles).map(
			(id) =>
				[
					id,
					createMasDevPack({
						operationTimeoutMs: config?.operationTimeoutMs,
						resolve: async (scope) => {
							const mas = getMas();
							if (!mas) throw new Error("DevPack service not initialized");
							const members = (await mas.view()).members;
							for (const member of members) {
								if (member.ref.profile !== id) continue;
								try {
									return mas
										.connect({
											principal: principal(member),
											source: member.ref,
											grants: effectiveGrants(member, members, profiles),
										})
										.forInvocation(scope);
								} catch {
									continue;
								}
							}
							throw new Error("Foreign DevPack invocation");
						},
					}),
				] as const,
		),
	);
}
