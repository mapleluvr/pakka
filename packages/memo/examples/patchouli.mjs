import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createMas } from "@pakka/mas";
import { openMemo } from "@pakka/memo";
import { openPatchouli } from "@pakka/memo/patchouli";
import { createMasResearchDriver, createPatchouliTools } from "@pakka/memo/patchouli/mas";

/** Host-owned composition; only execute:true authorizes this invocation to advance work. */
export async function runPatchouli({ directory, runtimeOptions, requestId, subject, execute = false }) {
	directory = resolve(directory);
	await mkdir(directory, { recursive: true });
	const identityFile = join(directory, "runtime.json");
	let saved;
	try {
		saved = JSON.parse(await readFile(identityFile, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const memo = openMemo({ file: join(directory, "memo.sqlite") });
	let runtime, research;
	const tools = createPatchouliTools(() => {
		if (!research) throw Error("Librarian is not bound");
		return research;
	});
	try {
		const owner = { id: "operator", check() {} };
		memo.createLibrary({ id: "knowledge", title: "Research knowledge", ownerId: "operator" });
		await memo.connect(owner).grant({
			libraryId: "knowledge",
			actorId: "patchouli",
			role: "editor",
			requestId: "grant-patchouli-v1",
		});
		runtime = await createRuntime({
			...runtimeOptions,
			cwd: directory,
			dataDir: join(directory, "runtime"),
			...(saved ? { reopenSessionFile: saved.sessionFile } : {}),
			tools: [],
			profiles: [
				{
					id: "librarian",
					systemPrompt:
						"You are Patchouli. Read the approved library, research the supplied subject, and optionally publish useful knowledge. " +
						tools.instructions,
					tools: tools.tools,
				},
			],
		});
		if (runtime.view().phase !== "ready") throw Error(runtime.view().lastError ?? "Runtime unavailable");
		if (!saved)
			await writeFile(identityFile, JSON.stringify({ sessionFile: runtime.view().sessionFile }), {
				flag: "wx",
				mode: 0o600,
			});
		const mas = await createMas({ runtime, namespace: "memo-example", maxPending: 4 });
		if (!saved)
			await mas.bootstrap([
				{ key: "patchouli", owner: "operator", profile: "librarian", lifetime: "persistent" },
			]);
		const retained = await mas.view();
		if (
			retained.members.length !== 1 ||
			retained.members[0].key !== "patchouli" ||
			retained.members[0].owner !== "operator" ||
			retained.members[0].lifetime !== "persistent"
		)
			throw Error("Original librarian membership differs");
		await mas.activate();
		const target = (await mas.view()).members[0].ref;
		const sender = mas.connect({ principal: "operator", source: null, grants: ["send", "observe", "abort"] });
		const driver = await createMasResearchDriver({ runtime, mas, client: sender, target });
		research = openPatchouli({
			file: join(directory, "memo.sqlite"),
			id: "patchouli",
			actorId: "patchouli",
			scope: [{ libraryId: "knowledge", write: true }],
			driver,
			authorize(actor) {
				if (actor !== "operator") throw Error("Only the owner controls this example");
			},
		});
		const client = research.connect(owner),
			requested = await client.request({ requestId, subject, refs: [] });
		if (execute) {
			await client.setEnabled(true);
			await client.advance();
			await runtime.waitForIdle();
			await client.advance();
		}
		return {
			sessionFile: runtime.view().sessionFile,
			run: await client.get(requested.runId),
			modelAttempts: runtime.view().budget.primaryAttempts,
		};
	} finally {
		tools.revoke();
		research?.close();
		await runtime?.close();
		memo.close();
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const [directory, requestId, subject, ...flags] = process.argv.slice(2);
	if (!directory || !requestId || !subject || flags.some((f) => f !== "--execute"))
		throw Error("Usage: node patchouli.mjs <private-directory> <requestId> <subject> [--execute]");
	const endpoint = process.env.PAKKA_ENDPOINT,
		model = process.env.PAKKA_MODEL,
		apiKey = process.env.PAKKA_API_KEY;
	if (!endpoint || !model || !apiKey)
		throw Error("Explicit host-supplied PAKKA_ENDPOINT, PAKKA_MODEL and PAKKA_API_KEY are required");
	console.log(
		JSON.stringify(
			await runPatchouli({
				directory,
				requestId,
				subject,
				execute: flags.includes("--execute"),
				runtimeOptions: {
					endpoint,
					model,
					apiKey,
					limits: { maxConversations: 2, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
				},
			}),
			null,
			2,
		),
	);
}
