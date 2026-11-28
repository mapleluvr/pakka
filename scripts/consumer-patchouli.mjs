import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const consumer = process.argv[2];
if (!consumer) throw Error("Consumer directory required");
const { runPatchouli } = await import(
	pathToFileURL(join(consumer, "node_modules/@pakka/memo/examples/patchouli.mjs")).href
);
let requests = 0;
const server = createServer((req, res) => {
	void (async () => {
		let text = "";
		for await (const chunk of req) text += chunk;
		const payload = JSON.parse(text);
		requests++;
		const input = payload.messages.filter((m) => m.role === "user").at(-1);
		const raw = typeof input.content === "string" ? input.content : JSON.stringify(input.content);
		const matched = /"runId"\s*:\s*"([a-f0-9-]+)"/.exec(raw);
		assert.ok(matched);
		const toolDone = payload.messages.some((m) => m.role === "tool");
		const delta = toolDone
			? { role: "assistant", content: "Completed with no publication." }
			: {
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "finish-" + requests,
							type: "function",
							function: { name: "research_finish", arguments: JSON.stringify({ runId: matched[1] }) },
						},
					],
				};
		res.writeHead(200, { "content-type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: toolDone ? "stop" : "tool_calls" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "research-local",
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
					}) +
					"\n\n",
			);
		res.end("data: [DONE]\n\n");
	})().catch((error) => res.destroy(error));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
	const options = {
		directory: join(consumer, "research"),
		requestId: "first-research",
		subject: "Read without mandatory publication.",
		runtimeOptions: {
			endpoint: "http://127.0.0.1:" + server.address().port + "/v1",
			model: "local",
			apiKey: "local-only",
			limits: { maxConversations: 2, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
		},
	};
	const passive = await runPatchouli(options);
	assert.equal(requests, 0);
	assert.equal(passive.run.state, "queued");
	const executed = await runPatchouli({ ...options, execute: true });
	assert.equal(executed.run.state, "completed");
	assert.equal(executed.run.publications.length, 0);
	assert.equal(requests, 2);
	const reopened = await runPatchouli(options);
	assert.equal(reopened.sessionFile, executed.sessionFile);
	assert.deepEqual(reopened.run, executed.run);
	assert.equal(requests, 2);
	console.log(
		JSON.stringify({
			status: "passed",
			requests,
			reopenAdditionalRequests: 0,
			completeWithoutPublication: true,
		}),
	);
} finally {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
}
