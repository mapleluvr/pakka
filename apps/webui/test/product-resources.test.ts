import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startPocket } from "../src/bootstrap.ts";
import { createLocalProduct } from "../src/product-runtime.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { text } from "../../../packages/agent/test/fixture.ts";

// A missing context source loses the markers; reading full skill bodies or running extensions leaves a separate oracle.
test("local product reads native instructions and resource indexes without loading packages or extension code", async () => {
	const p = await isolated();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	let config: Awaited<ReturnType<typeof createLocalProduct>> | undefined;
	try {
		await configuration(p.agentDir, p.f.endpoint);
		const project = join(p.f.cwd, ".pi");
		const child = join(p.f.cwd, "child");
		const sentinel = join(p.f.root, "extension-executed");
		const extension = join(p.f.root, "forbidden-extension.mjs");
		for (const path of [
			join(p.agentDir, "skills", "global-check"),
			join(p.agentDir, "prompts"),
			join(project, "skills", "project-check"),
			join(project, "prompts"),
			child,
		])
			await mkdir(path, { recursive: true });
		await writeFile(
			extension,
			`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'EXECUTED'); export default function () {}`,
		);
		await writeFile(join(p.agentDir, "AGENTS.md"), "GLOBAL-INSTRUCTION-SENTINEL");
		await writeFile(join(p.f.cwd, "AGENTS.md"), "PROJECT-INSTRUCTION-SENTINEL");
		await writeFile(join(child, "AGENTS.md"), "CURRENT-CHILD-INSTRUCTION-SENTINEL");
		await writeFile(
			join(p.agentDir, "skills", "global-check", "SKILL.md"),
			"---\nname: global-check\ndescription: GLOBAL-SKILL-SUMMARY\n---\nGLOBAL-SKILL-BODY-NOT-AUTO-LOADED",
		);
		await writeFile(
			join(project, "skills", "project-check", "SKILL.md"),
			"---\nname: project-check\ndescription: PROJECT-SKILL-SUMMARY\n---\nPROJECT-SKILL-BODY-NOT-AUTO-LOADED",
		);
		await writeFile(
			join(p.agentDir, "prompts", "review.md"),
			"---\ndescription: GLOBAL-TEMPLATE-SUMMARY\n---\nGLOBAL-TEMPLATE-BODY-NOT-AUTO-LOADED $ARGUMENTS",
		);
		await writeFile(
			join(project, "prompts", "fix.md"),
			"---\ndescription: PROJECT-TEMPLATE-SUMMARY\n---\nPROJECT-TEMPLATE-BODY-NOT-AUTO-LOADED $ARGUMENTS",
		);
		const settings = JSON.stringify({
			defaultProvider: "alpha",
			defaultModel: "reasoner",
			defaultThinkingLevel: "high",
			// A local missing package deterministically catches accidental resolution, without accessing a registry.
			packages: [join(p.f.root, "missing-package")],
			extensions: [extension],
			mcpServers: { forbidden: { command: process.execPath, args: [extension] } },
		});
		await writeFile(join(p.agentDir, "settings.json"), settings);
		await writeFile(
			join(project, "settings.json"),
			JSON.stringify({ packages: [join(p.f.root, "another-missing-package")], extensions: [extension] }),
		);
		config = await createLocalProduct({ cwd: p.f.cwd, dataDir: p.f.dataDir, agentDir: p.agentDir });
		app = await startPocket(config);
		const catalog = app.runtime.catalog({
			namespace: "resources-regression",
			maxDeliveries: 16,
			maxPending: 4,
		});
		const [member] = await catalog.enroll(
			[{ key: "reader", profile: "default", data: { phase: "active" } }],
			() => {},
		);
		assert.ok(member);
		const host = await app.runtime.conversation(member.ref);
		const client = host.connect("operator", ["input.submit"]);
		await client.submit({ key: "resources-one", text: "List available local resources" });
		await host.waitForIdle();
		assert.equal(
			p.f.requests.length,
			1,
			"resource loading must not invoke an auxiliary model or run a package installer",
		);
		const first = text(p.f.requests[0]!);
		for (const marker of [
			"GLOBAL-INSTRUCTION-SENTINEL",
			"PROJECT-INSTRUCTION-SENTINEL",
			"GLOBAL-SKILL-SUMMARY",
			"PROJECT-SKILL-SUMMARY",
			"GLOBAL-TEMPLATE-SUMMARY",
			"PROJECT-TEMPLATE-SUMMARY",
		])
			assert.ok(first.includes(marker), marker);
		assert.doesNotMatch(first, /BODY-NOT-AUTO-LOADED|CURRENT-CHILD-INSTRUCTION-SENTINEL/);
		await assert.rejects(access(sentinel), { code: "ENOENT" });
		assert.equal(await readFile(join(p.agentDir, "settings.json"), "utf8"), settings);
		const configured = await catalog.configureAgent(member.ref, { cwd: child }, () => {});
		const current = await app.runtime.conversation(configured.ref);
		await current
			.connect("configured-operator", ["input.submit"])
			.submit({ key: "resources-two", text: "Read current project instructions" });
		await current.waitForIdle();
		assert.equal(p.f.requests.length, 2);
		assert.match(text(p.f.requests[1]!), /CURRENT-CHILD-INSTRUCTION-SENTINEL/);
		await assert.rejects(access(sentinel), { code: "ENOENT" });
	} finally {
		await app?.close();
		await config?.modelConfiguration?.close();
		await p.f.close();
	}
});
