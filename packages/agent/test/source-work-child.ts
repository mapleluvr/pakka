import { readFile } from "node:fs/promises";
import { createHost } from "../src/index.ts";
const options = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const host = await createHost(options);
const owner = host.connect("work-owner", ["context_artifacts.write", "model.infer"]);
owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
const binding = owner.bindStrategy("strategy"),
	frame = binding.readFrame();
const target = frame.projection.find((e) => e.messages.some((m) => m.role === "assistant"))!.sourceEntryId;
const job = binding.createJob(frame.basis, {
	planId: "crashed-fixed-plan",
	targetEntryIds: [target],
	maxCalls: 2,
	requireArtifactReceipt: true,
	metadata: { configuration: "fixed-config" },
});
await job.prepare();
process.send?.({ jobId: job.id });
void job
	.infer({ modelKey: "summary", prompt: "FIXED-SOURCE-REQUEST", maxOutputTokens: 32 })
	.catch((error) => {
		process.stderr.write(String(error));
		process.exitCode = 1;
	});
