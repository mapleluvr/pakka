import {
	DefaultResourceLoader,
	SettingsManager,
	formatSkillsForPrompt,
} from "@earendil-works/pi-coding-agent";
import type { RuntimeContextSource } from "@pakka/agent";

/** Data-only view: disabling extensions alone would still let Pi resolve and install packages. */
function resourceSettings(settings: ReturnType<SettingsManager["getGlobalSettings"]>): string {
	return JSON.stringify({ skills: settings.skills ?? [], prompts: settings.prompts ?? [] });
}

/** Native local discovery per generation, never a Coding Agent session or an executable extension loader. */
export function localResources(agentDir: string): RuntimeContextSource {
	return {
		id: "pakka.local-resources",
		version: 1,
		profiles: ["default", "read-only"],
		async render({ cwd, signal }) {
			signal?.throwIfAborted();
			const native = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
			if (native.drainErrors().length) throw new Error("Local resource settings are unavailable");
			const global = resourceSettings(native.getGlobalSettings());
			const project = resourceSettings(native.getProjectSettings());
			const settings = SettingsManager.fromStorage(
				{
					withLock(scope, fn) {
						const current = scope === "global" ? global : project;
						const next = fn(current);
						if (next !== undefined && next !== current)
							throw new Error("Local resource settings are read-only");
					},
				},
				{ projectTrusted: true },
			);
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager: settings,
				noExtensions: true,
				noThemes: true,
			});
			await loader.reload();
			signal?.throwIfAborted();
			const skills = loader.getSkills();
			const prompts = loader.getPrompts();
			const parts = [
				...loader
					.getAgentsFiles()
					.agentsFiles.map((file) => `# Local instructions: ${file.path}\n${file.content}`),
				loader.getSystemPrompt(),
				...loader.getAppendSystemPrompt(),
				formatSkillsForPrompt(skills.skills),
				...(prompts.prompts.length
					? [
							"# Local prompt templates\nRead a selected template with the read tool when relevant. Templates are not executed or automatically expanded by Pakka.",
							...prompts.prompts.map(
								(prompt) => `- ${prompt.name}: ${prompt.description}\n  File: ${prompt.filePath}`,
							),
						]
					: []),
				...([...skills.diagnostics, ...prompts.diagnostics].length
					? [
							"# Local resource diagnostics",
							...[...skills.diagnostics, ...prompts.diagnostics]
								.slice(0, 16)
								.map((issue) => `- ${issue.type}: ${issue.message}${issue.path ? ` (${issue.path})` : ""}`),
						]
					: []),
			];
			// This is an immutable data snapshot for one generation, not a permission grant.
			// Runtime separately rechecks the original Conversation, cwd and request authority at dispatch.
			return { text: parts.filter(Boolean).join("\n\n") || null, check: () => signal?.throwIfAborted() };
		},
	};
}
