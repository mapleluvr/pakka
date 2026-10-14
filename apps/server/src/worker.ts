import { createRuntime, type Runtime } from "@pakka/agent";
import { createMas, inProcessPlacement, type Mas, type SessionEndpoint, type MemberSpec } from "@pakka/mas";
import { profileDevPacks } from "./profile-devpack.ts";
import {
	configuration,
	envelope,
	frozen,
	identity,
	object,
	request,
	type WorkerRequest,
} from "./worker-ipc.ts";

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
		const contributions = profileDevPacks(preset.devpack, () => (runtime ? mas : undefined));
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
					: contributions.size
						? { ...profile, tools: profile.tools ?? [] }
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
