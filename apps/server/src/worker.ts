import { createRuntime, type Runtime } from "@pakka/agent";
import {
	createMas,
	inProcessPlacement,
	type Mas,
	type Member,
	type MasGrant,
	type SessionEndpoint,
	type MemberSpec,
} from "@pakka/mas";
import { createMasDevPack } from "@pakka/mas-devpack";
import { createHash } from "node:crypto";
import {
	configuration,
	envelope,
	frozen,
	identity,
	object,
	request,
	type WorkerRequest,
} from "./worker-ipc.ts";

function principal(member: Member): string {
	return (
		"worker-agent-" +
		createHash("sha256")
			.update(JSON.stringify([member.ref.sessionId, member.ref.conversationId]))
			.digest("hex")
			.slice(0, 48)
	);
}
function effectiveGrants(
	member: Member,
	members: readonly Member[],
	profiles: Readonly<Record<string, readonly MasGrant[]>>,
): readonly MasGrant[] {
	const parents = new Map(members.map((candidate) => [principal(candidate), candidate]));
	let grants = [...(profiles[member.ref.profile] ?? [])],
		current = member;
	const seen = new Set<string>();
	while (current.owner.startsWith("worker-agent-")) {
		if (seen.has(current.owner)) throw new Error("Worker grant ownership cycle");
		seen.add(current.owner);
		const parent = parents.get(current.owner);
		if (!parent) throw new Error("Worker grant owner unknown");
		const ceiling = new Set(profiles[parent.ref.profile] ?? []);
		grants = grants.filter((grant) => ceiling.has(grant));
		current = parent;
	}
	return grants;
}
if (!process.send) throw new Error("Pakka worker requires its private manager IPC channel");
let generation: string | undefined,
	runtime: Runtime | undefined,
	endpoint: SessionEndpoint | undefined,
	initialized = false;
const pending = new Map<string, AbortController>();
function respond(id: string, ok: boolean, value?: unknown, error?: string, close = false) {
	process.send?.({ version: 1, generation, id, ok, ...(ok ? { value } : { error }) }, () => {
		if (close) {
			process.disconnect?.();
			process.exit(0);
		}
	});
}
async function execute(message: WorkerRequest, signal: AbortSignal): Promise<unknown> {
	if (message.command === "init") {
		if (initialized) throw new Error("Worker already initialized; identity cannot be replaced");
		initialized = true;
		generation = message.generation;
		configuration(message.payload);
		const preset = message.payload;
		let mas: Mas | undefined;
		const contributions = new Map(
			Object.entries(preset.devpack?.profiles ?? {}).map(
				([id]) =>
					[
						id,
						createMasDevPack({
							operationTimeoutMs: preset.devpack?.operationTimeoutMs,
							resolve: async (scope) => {
								if (!runtime || !mas) throw new Error("Worker DevPack not initialized");
								const members = (await mas.view()).members;
								for (const member of members) {
									if (member.ref.profile !== id) continue;
									// Member keys/profiles cannot mint stronger descendant authority.
									try {
										const grants = effectiveGrants(member, members, preset.devpack!.profiles);
										return mas
											.connect({ principal: principal(member), source: member.ref, grants })
											.forInvocation(scope);
									} catch {
										continue;
									}
								}
								throw new Error("Foreign worker DevPack invocation");
							},
						}),
					] as const,
			),
		);
		const main = contributions.get("default");
		runtime = await createRuntime({
			...preset.runtime,
			...(main
				? {
						tools: main.tools,
						systemPrompt: [preset.runtime.systemPrompt, main.instructions].filter(Boolean).join("\n\n"),
					}
				: {}),
			profiles: preset.runtime.profiles?.map((profile) => {
				const pack = contributions.get(profile.id);
				return pack
					? {
							...profile,
							tools: pack.tools,
							systemPrompt: [profile.systemPrompt, pack.instructions].filter(Boolean).join("\n\n"),
						}
					: profile;
			}),
		});
		if (contributions.size) mas = await createMas({ runtime, ...preset.catalog });
		endpoint = await inProcessPlacement({ runtime, ...message.payload.catalog }).open(
			message.payload.runtime.reservedSessionId,
		);
		return { sessionId: runtime.view().sessionId };
	}
	if (message.generation !== generation || !runtime || !endpoint)
		throw new Error("Worker generation unavailable");
	if (message.command === "view") return frozen({ ...(await endpoint.view()), isolation: "worker" as const });
	if (message.command === "prepare") {
		// SAFETY: request() validates every member's key/owner/profile and forbids unsupported lifetime/config fields.
		return endpoint.prepare(message.payload.members as unknown as readonly MemberSpec[]);
	}
	if (message.command === "activate") return endpoint.activate();
	if (message.command === "deliver" || message.command === "receipt" || message.command === "wait") {
		envelope(message.payload.envelope);
		if (message.command === "deliver") return endpoint.deliver(message.payload.envelope, signal);
		if (typeof message.payload.nativeId !== "string") throw new Error("Native receipt identity missing");
		if (message.command === "receipt")
			return endpoint.receipt(message.payload.envelope, message.payload.nativeId);
		return endpoint.wait(message.payload.envelope, message.payload.nativeId);
	}
	if (message.command === "close") {
		for (const controller of pending.values()) controller.abort();
		await runtime.close();
		return { closed: true };
	}
	throw new Error("Unsupported worker command");
}
process.on("message", (raw: unknown) => {
	void (async () => {
		let message: WorkerRequest;
		try {
			request(raw);
			message = raw;
		} catch {
			if (object(raw) && identity(raw.id) && identity(raw.generation)) {
				process.send?.({
					version: 1,
					generation: raw.generation,
					id: raw.id,
					ok: false,
					error: "Invalid/unsupported worker protocol",
				});
			}
			return;
		}
		if (generation !== undefined && message.generation !== generation) {
			respond(message.id, false, undefined, "Worker generation mismatch");
			return;
		}
		if (message.command === "cancel") {
			pending.get(String(message.payload.targetId))?.abort();
			return;
		}
		if (pending.has(message.id)) {
			respond(message.id, false, undefined, "Duplicate in-flight worker request");
			return;
		}
		const startsInitialization = message.command === "init" && !initialized;
		const controller = new AbortController();
		pending.set(message.id, controller);
		try {
			const value = await execute(message, controller.signal);
			respond(message.id, true, value, undefined, message.command === "close");
		} catch (error) {
			respond(message.id, false, undefined, String(error).slice(0, 4096));
			if (startsInitialization) {
				await runtime?.close();
				process.disconnect?.();
				process.exit(1);
			}
		} finally {
			pending.delete(message.id);
		}
	})().catch(() => {
		void runtime?.close().finally(() => process.exit(1));
	});
});
process.on("disconnect", () => {
	for (const controller of pending.values()) controller.abort();
	void (runtime?.close() ?? Promise.resolve()).then(
		() => process.exit(0),
		() => process.exit(1),
	);
});
