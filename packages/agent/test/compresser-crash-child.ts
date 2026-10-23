import { join } from "node:path";
import { createCompresserSession, createHost } from "../src/index.ts";
import { seed } from "./fixture.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";

const [root, cwd, dataDir, endpoint] = process.argv.slice(2);
if (!root || !cwd || !dataDir || !endpoint || new URL(endpoint).hostname !== "127.0.0.1")
	throw new Error("Synthetic crash fixture arguments required");
const compresserSession = await createCompresserSession({
	storageDir: join(root, "compresser"),
	toolCallingTolerance: 3,
	unresolvedErrorTolerance: 4,
});
const approved = inferencePolicy(endpoint).inference!;
const host = await createHost({
	cwd,
	dataDir,
	endpoint,
	model: "local-model",
	apiKey: "synthetic-local-only",
	inference: { ...approved, compresserSession },
});
await seed(host);
const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
const b = binding(owner),
	frame = b.readFrame();
const job = b.createJob(frame.basis, {
	planId: "crash-before-response",
	targetEntryIds: [target(frame)],
	maxCalls: 2,
	requireArtifactReceipt: true,
});
process.stdout.write(JSON.stringify({ sessionFile: host.view().sessionFile, jobId: job.id }) + "\n");
await job.converse({
	modelKey: "summary",
	prompt: "FIXED CRASH SOURCE",
	outputTool: {
		name: "submit_candidate",
		description: "Submit a complete candidate",
		parameters: {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
			additionalProperties: false,
		},
	},
});
throw new Error("The parent must terminate this fixture while the real HTTP response is unresolved");
