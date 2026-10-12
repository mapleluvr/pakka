import { createRuntime } from "../src/index.ts";
import type { RuntimeLimits, RuntimeOptions } from "../src/index.ts";
import { fixture } from "./fixture.ts";

export const runtimeLimits: RuntimeLimits = {
	maxConversations: 8,
	maxPrimaryAttempts: 32,
	maxAuxiliaryAttempts: 8,
};
export async function runtimeFixture(
	options: Partial<RuntimeOptions> | ((endpoint: string) => Partial<RuntimeOptions>) = {},
	limits: RuntimeLimits = runtimeLimits,
	respond?: Parameters<typeof fixture>[1],
) {
	const f = await fixture(typeof options === "function" ? {} : options, respond);
	try {
		const config: RuntimeOptions = {
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			systemPrompt: "PAKKA-SYSTEM",
			...(typeof options === "function" ? options(f.endpoint) : options),
			limits,
		};
		const runtime = await createRuntime(config);
		return {
			f,
			runtime,
			config,
			close: async () => {
				try {
					await runtime.close();
				} finally {
					await f.close();
				}
			},
		};
	} catch (error) {
		await f.close();
		throw error;
	}
}
