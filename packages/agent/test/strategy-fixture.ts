import assert from "node:assert/strict";
import type { Client, ContextFrame, StrategyBinding, HostOptions } from "../src/index.ts";
export function binding(client: Client, id = "strategy"): StrategyBinding {
	assert.equal(typeof client.bindStrategy, "function", "Client must expose scoped strategy binding");
	return client.bindStrategy(id);
}
export function target(frame: ContextFrame): string {
	return frame.projection.find((e) => e.messages.some((m) => m.role === "user"))!.sourceEntryId;
}
export function inferencePolicy(endpoint: string): Partial<HostOptions> {
	return {
		inference: {
			models: [
				{
					key: "summary",
					model: "summary-model",
					endpoint,
					apiKey: "SUMMARY-SECRET",
					maxTokens: 512,
					contextWindow: 16000,
				},
			],
			policies: [
				{
					strategyId: "strategy",
					modelKeys: ["summary"],
					maxCalls: 3,
					maxJobCalls: 2,
					maxOutputTokens: 256,
					timeoutMs: 5000,
				},
			],
		},
	};
}
