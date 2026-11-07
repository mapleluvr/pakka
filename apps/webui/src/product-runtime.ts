import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	createLocalExecutionEnvironment,
	type ExecutionConfiguration,
	type ExecutionEnvironment,
} from "@pakka/agent";
import { realpath, stat } from "node:fs/promises";
import type { PocketProductOptions } from "./bootstrap.ts";
import { openProductModels } from "./product-models.ts";
import { localResources } from "./product-resources.ts";

/** Local tools retain the operator's OS access. This is environment hygiene, not a sandbox. */
function localExecution(readOnly: boolean): ExecutionConfiguration {
	const shell = process.platform === "win32" ? "powershell" : "bash";
	return {
		id: readOnly ? "pakka-local-readonly-v1" : "pakka-local-coding-v1",
		tools: readOnly ? ["read"] : ["read", "write", "edit", shell],
		open(target) {
			// Copy a positive list, not the model host's authentication or startup-hook environment.
			const safe: Record<string, string> = {};
			for (const key of [
				"PATH",
				"PATHEXT",
				"SystemRoot",
				"WINDIR",
				"COMSPEC",
				"TEMP",
				"TMP",
				"TMPDIR",
				"HOME",
				"USERPROFILE",
				"APPDATA",
				"LOCALAPPDATA",
				"PROGRAMFILES",
				"PROGRAMFILES(X86)",
				"ProgramData",
				"LANG",
				"LC_ALL",
				"TERM",
				"SHELL",
				"NUMBER_OF_PROCESSORS",
				"PROCESSOR_ARCHITECTURE",
			])
				if (process.env[key] !== undefined) safe[key] = process.env[key]!;
			const local = createLocalExecutionEnvironment({ cwd: target.cwd, shellEnv: safe });
			const env: ExecutionEnvironment = {
				...local,
				async exec(command, options, signal) {
					if (!local.exec)
						return {
							ok: false,
							error: { code: "not_supported", message: "Local command capability unavailable" },
						};
					return local.exec(
						command,
						{ ...options, inheritEnv: false, env: { ...safe, ...options?.env } },
						signal,
					);
				},
			};
			return Object.freeze(env);
		},
	};
}

/** Built-in product composition. The caller owns modelConfiguration until all its Sessions close. */
export async function createLocalProduct(options: {
	readonly cwd: string;
	readonly dataDir: string;
	readonly agentDir?: string;
}): Promise<PocketProductOptions> {
	const cwd = await realpath(options.cwd);
	if (!(await stat(cwd)).isDirectory()) throw new Error("Local workspace directory is unavailable");
	const agentDir = options.agentDir ?? getAgentDir();
	const modelConfiguration = await openProductModels({ cwd, agentDir });
	const defaults = modelConfiguration.defaults();
	return {
		owner: "Owner",
		profiles: ["default", "read-only"],
		modelConfiguration,
		runtime: {
			cwd,
			dataDir: options.dataDir,
			models: modelConfiguration.models,
			model: defaults.model ?? "",
			thinkingLevel: defaults.thinkingLevel,
			execution: localExecution(false),
			profiles: [{ id: "read-only", execution: localExecution(true) }],
			contextSources: [localResources(agentDir)],
			limits: { maxConversations: 64, maxPrimaryAttempts: 1000, maxAuxiliaryAttempts: 1000 },
		},
	};
}
