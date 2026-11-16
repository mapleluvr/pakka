import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgentFacet, createRuntime, type Runtime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { deferred } from "./fixture.ts";

// A label-only toggle, wrong profile publication, or stale native registry must fail on real payloads/effects.
test(
	"Agent facets: native requests and tool effects follow only the approved active profile",
	{ timeout: 20000 },
	async () => {
		let marker = "";
		const facet = createAgentFacet({
			id: "sample-agent",
			version: "1.0.0",
			profiles: ["worker"],
			instructions: "FACET-INSTRUCTIONS-FOR-WORKER",
			tools: [
				{
					name: "facet_echo",
					description: "Write the controlled effect",
					parameters: { type: "object", properties: {}, additionalProperties: false },
					execute: async () => {
						await writeFile(marker, "NATIVE-TOOL-EFFECT");
						return "FACET-TOOL-RESULT";
					},
				},
			],
		});
		const m = await runtimeFixture(
			{ profiles: [{ id: "worker" }, { id: "plain" }], agentFacets: [facet] },
			undefined,
			(payload) => {
				const last = [...payload.messages].reverse().find((message) => message.role !== "system");
				return last?.role === "user" && JSON.stringify(last.content).includes("CALL-FACET")
					? { tool: "facet_echo" }
					: { text: "LOCAL-ANSWER" };
			},
		);
		try {
			marker = join(m.f.root, "facet-effect.txt");
			const ref = await m.runtime.createConversation({ key: "worker", profile: "worker" });
			const worker = await m.runtime.conversation(ref);
			const plain = await m.runtime.conversation(
				await m.runtime.createConversation({ key: "plain", profile: "plain" }),
			);
			const client = worker.connect("operator", ["input.submit"]);
			await client.submit({ key: "disabled", text: "BEFORE-ACTIVATION" });
			await worker.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.equal(JSON.stringify(m.f.requests[0]).includes("facet_echo"), false);
			facet.setEnabled(true);
			assert.equal(m.f.requests.length, 1, "activation does not submit work");
			await client.submit({ key: "enabled", text: "CALL-FACET" });
			await worker.waitForIdle();
			assert.match(JSON.stringify(m.f.requests[1]?.tools ?? []), /facet_echo/);
			assert.match(JSON.stringify(m.f.requests[1]?.messages), /FACET-INSTRUCTIONS-FOR-WORKER/);
			assert.equal(await readFile(marker, "utf8"), "NATIVE-TOOL-EFFECT");
			assert.match(JSON.stringify(m.f.requests[2]?.messages), /FACET-TOOL-RESULT/);
			await plain.connect("operator", ["input.submit"]).submit({ key: "plain", text: "PLAIN-PROFILE" });
			await plain.waitForIdle();
			assert.equal(JSON.stringify(m.f.requests[3]).includes("facet_echo"), false);
			assert.equal(JSON.stringify(m.f.requests[3]).includes("FACET-INSTRUCTIONS-FOR-WORKER"), false);
			facet.setEnabled(false);
			await client.submit({ key: "off", text: "AFTER-DEACTIVATION" });
			await worker.waitForIdle();
			assert.equal(JSON.stringify(m.f.requests[4]?.tools ?? []).includes("facet_echo"), false);
			// Durable publishes a section-removal message; prior transcript text remains historical evidence.
			assert.equal(
				[...(m.f.requests[4]?.messages ?? [])].reverse().find((message) => message.role === "system")
					?.content,
				'Removed system prompt section "facet-sample-agent".',
			);
			facet.setEnabled(true);
			await client.submit({ key: "again", text: "AFTER-REACTIVATION" });
			await worker.waitForIdle();
			assert.match(JSON.stringify(m.f.requests[5]?.tools ?? []), /facet_echo/);
			assert.deepEqual(
				m.runtime.view().conversations.find((row) => row.key === "worker"),
				ref,
			);
			assert.equal(m.runtime.view().phase, "ready");
		} finally {
			await m.close();
		}
		assert.equal(facet.status().bindings, 0);
	},
);

// Deactivation is not cancellation of a native tool already admitted by its own service contract.
test(
	"Agent facets: deactivation retains an admitted tool result and reopen preserves the fixed approval ceiling",
	{ timeout: 20000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		const definition = {
			id: "waiting-agent",
			version: "1.0.0",
			profiles: ["default"],
			tools: [
				{
					name: "facet_wait",
					description: "Complete admitted work",
					parameters: { type: "object", properties: {}, additionalProperties: false },
					execute: async () => {
						entered.resolve();
						await release.promise;
						return "ACCEPTED-WORK-FINISHED";
					},
				},
			],
		};
		const facet = createAgentFacet(definition);
		const m = await runtimeFixture({ agentFacets: [facet] }, undefined, (_payload, n) =>
			n === 1 ? { tool: "facet_wait" } : { text: "FINISHED" },
		);
		let reopened: Runtime | undefined;
		try {
			facet.setEnabled(true);
			const host = m.runtime.root();
			await host.connect("operator", ["input.submit"]).submit({ key: "accepted", text: "ADMIT-TOOL" });
			await entered.promise;
			facet.setEnabled(false);
			release.resolve();
			await host.waitForIdle();
			assert.match(JSON.stringify(m.f.requests[1]?.messages), /ACCEPTED-WORK-FINISHED/);
			assert.equal(JSON.stringify(m.f.requests[1]?.tools ?? []).includes("facet_wait"), false);
			const file = m.runtime.view().sessionFile;
			await m.runtime.close();
			await assert.rejects(
				createRuntime({
					...m.config,
					reopenSessionFile: file,
					agentFacets: [createAgentFacet({ ...definition, version: "2.0.0" })],
				}),
				/profile|bootstrap/i,
			);
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			await reopened
				.root()
				.connect("operator", ["input.submit"])
				.submit({ key: "reopened", text: "REOPENED-DISABLED" });
			await reopened.waitForIdle();
			assert.equal(JSON.stringify(m.f.requests[2]?.tools ?? []).includes("facet_wait"), false);
			assert.equal(reopened.view().phase, "ready");
		} finally {
			release.resolve();
			await reopened?.close();
			await m.close();
		}
	},
);
