import { createDynamite, createDynamiteTool, type DynamiteService, type RuntimeFrame } from "@pakka/dynamite";
import type { ContextFrame, HostOptions, StrategyBinding } from "@pakka/agent";

// Compile only against installed public declarations, never workspace sources.
export function install(binding: StrategyBinding): DynamiteService {
	const frame: ContextFrame = binding.readFrame();
	const service = createDynamite(binding, {
		config: { compressionModel: "summary", compressionMaxOutputTokens: 64 },
	});
	const tool: NonNullable<HostOptions["tools"]>[number] = createDynamiteTool(() => service);
	void frame;
	void tool;
	return service;
}

export function inspect(frame: RuntimeFrame) {
	return { entries: frame.fileEntries, messages: frame.rawMessages, projection: frame.contextEntries };
}
