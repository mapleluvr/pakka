import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { oracleFixture as fixture, seed, raw, text } from "./fixture.ts";
import type { ProjectionPlan } from "../src/index.ts";

async function recordedBash(f: Awaited<ReturnType<typeof fixture>>) {
	const initial = await f.start();
	await seed(initial);
	const file = initial.view().sessionFile;
	await initial.dispose();
	const manager = SessionManager.open(file);
	const sentinel = join(f.cwd, "must-not-execute.txt");
	const command = `node -e "require('fs').writeFileSync(${JSON.stringify(sentinel)},'executed')"`;
	const id = manager.appendMessage({
		role: "bashExecution",
		command,
		output: "BASH-RAW",
		cancelled: true,
		truncated: true,
		fullOutputPath: "RAW-PATH",
		exitCode: 7,
		timestamp: 2,
	});
	const excluded = manager.appendMessage({
		role: "bashExecution",
		command: "EXCLUDED-CMD",
		output: "EXCLUDED-RAW",
		excludeFromContext: true,
		cancelled: false,
		truncated: false,
		exitCode: 0,
		timestamp: 3,
	});
	const checkpoint = manager.appendMessage({ role: "system", content: "MID-SYSTEM", timestamp: 4 });
	const original = manager.getEntry(id);
	const host = await f.start({ reopenSessionFile: file });
	const owner = host.connect("owner", ["real_context.write"]);
	owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
	return {
		host,
		owner,
		binding: owner.bindStrategy("strategy"),
		id,
		excluded,
		checkpoint,
		original,
		sentinel,
		file,
	};
}

for (const mode of ["number", "reduce"] as const)
	test(`bash request rendering ${mode} changes wire only and never executes a command`, async () => {
		const f = await fixture();
		try {
			const s = await recordedBash(f),
				before = await raw(s.host);
			s.binding.installProjector(
				(frame) =>
					({
						status: "apply",
						basis: frame.basis,
						renderPatches: [
							{
								kind: "bashExecution",
								sourceEntryId: s.id,
								messageIndex: 0,
								command: mode === "number" ? "[#3] DISPLAY-CMD" : "[#3 omitted]",
								output: mode === "number" ? "DISPLAY-OUTPUT" : "",
								cancelled: false,
								truncated: false,
								fullOutputPath: null,
								exitCode: 0,
							},
						],
					}) as ProjectionPlan,
			);
			const user = s.host.connect("next", ["input.submit"]);
			await user.submit({ key: mode, text: "TAIL" });
			await s.host.waitForIdle();
			assert.equal(s.host.view().phase, "ready", s.host.view().lastError ?? "Host should be ready");
			assert.equal(f.requests.length, 2);
			assert.match(text(f.requests[1]), mode === "number" ? /\[#3\] DISPLAY-CMD/ : /\[#3 omitted\]/);
			if (mode === "number") assert.match(text(f.requests[1]), /DISPLAY-OUTPUT/);
			assert.match(text(f.requests[1]), /PAKKA-SYSTEM/);
			assert.match(text(f.requests[1]), /MID-SYSTEM/);
			assert.doesNotMatch(
				text(f.requests[1]),
				/BASH-RAW|RAW-PATH|EXCLUDED-RAW|command cancelled|exited with code 7/,
			);
			assert.equal((await raw(s.host)).startsWith(before), true);
			assert.deepEqual(SessionManager.open(s.file).getEntry(s.id), s.original);
			assert.doesNotMatch(
				await readFile(s.file, "utf8"),
				/DISPLAY-OUTPUT|\[#3 omitted\]|"type":"context_edit"|"type":"compaction"/,
			);
			await assert.rejects(access(s.sentinel), /ENOENT/);
		} finally {
			await f.close();
		}
	});

for (const bad of [
	"excluded",
	"system",
	"wrong-role",
	"forged-field",
	"forged-kind",
	"bad-exit",
	"copied-basis",
	"stale-basis",
	"duplicate",
])
	test(`bash rendering ${bad} is rejected before HTTP`, async () => {
		const f = await fixture();
		try {
			const s = await recordedBash(f),
				stale = s.binding.readFrame().basis;
			s.binding.installProjector((frame) => {
				const patch = {
					kind: "bashExecution",
					sourceEntryId:
						bad === "excluded"
							? s.excluded
							: bad === "system"
								? s.checkpoint
								: bad === "wrong-role"
									? frame.projection.find((e) => e.messages.some((m) => m.role === "user"))!.sourceEntryId
									: s.id,
					messageIndex: 0,
					command: "FORGED",
					output: "FORGED",
					cancelled: false,
					truncated: false,
					fullOutputPath: null,
					exitCode: 0,
					...(bad === "forged-field" ? { excludeFromContext: false } : {}),
					...(bad === "forged-kind" ? { kind: "user" } : {}),
					...(bad === "bad-exit" ? { exitCode: "0" } : {}),
				};
				return {
					status: "apply",
					basis: bad === "copied-basis" ? {} : bad === "stale-basis" ? stale : frame.basis,
					renderPatches: bad === "duplicate" ? [patch, patch] : [patch],
				} as unknown as ProjectionPlan;
			});
			const user = s.host.connect("next", ["input.submit"]);
			await user.submit({ key: bad, text: "BLOCKED" });
			await s.host.waitForIdle();
			assert.equal(f.requests.length, 1);
			assert.equal(s.host.view().phase, "failed");
			await assert.rejects(access(s.sentinel), /ENOENT/);
		} finally {
			await f.close();
		}
	});
