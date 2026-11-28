import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalExecutionEnvironment } from "../src/index.ts";
import { fixture, text } from "./fixture.ts";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const powershell = process.platform === "win32" ? "C:/Program Files/PowerShell/7/pwsh.exe" : "/usr/bin/pwsh";
for (const [tool, program, command] of [
	["bash", bash, "printf SHELL-EFFECT > shell.txt; printf SHELL-OUTPUT"],
	[
		"powershell",
		powershell,
		"[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'shell.txt'),'SHELL-EFFECT'); [Console]::Write('SHELL-OUTPUT')",
	],
] as const) {
	// Registering only a custom exec facade, or selecting the wrong env/cwd, cannot satisfy this native tool call.
	test(
		`execution: native ${tool} produces a real file and returns its output`,
		{ skip: !existsSync(program) && `${program} unavailable` },
		async () => {
			const f = await fixture(
				{
					execution: {
						id: `${tool}-v1`,
						tools: [tool],
						powershellPrograms: [powershell],
						open: (target) => createLocalExecutionEnvironment({ cwd: target.cwd, shellPath: bash }),
					},
				},
				(_body, n) => (n === 1 ? { tool, args: { command, timeout: 10 } } : { text: "DONE" }),
			);
			try {
				const host = await f.start();
				await host
					.connect("operator", ["input.submit"])
					.submit({ key: tool, text: "Execute the shell command" });
				await host.waitForIdle();
				assert.equal(await readFile(join(f.cwd, "shell.txt"), "utf8"), "SHELL-EFFECT");
				assert.match(text(f.requests[1]!), /SHELL-OUTPUT/);
				assert.equal(f.requests.length, 2);
				assert.equal(host.view().phase, "ready");
			} finally {
				await f.close();
			}
		},
	);
}
