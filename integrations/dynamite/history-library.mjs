import assert from "node:assert/strict";
import { join } from "node:path";
import { openMemo } from "@pakka/memo";
import { openPatchouli } from "@pakka/memo/patchouli";
import { createMasResearchDriver, createPatchouliTools } from "@pakka/memo/patchouli/mas";
import { createMas } from "@pakka/mas";
import { createHistoryTools, bindHistoryInvocation } from "@pakka/dynamite";
import { createDynamiteSourceProvider } from "@pakka/memo/dynamite";
import { historyFixture } from "./history-fixture.mjs";

let research,
	runId,
	mode = false,
	stage = 0,
	sourceRef,
	entryId,
	target,
	fixture;
const tools = createPatchouliTools(() => research),
	historyTools = createHistoryTools({
		resolve(scope) {
			return bindHistoryInvocation(
				{
					runtime: fixture.runtime,
					source: target,
					service: fixture.book,
					actor: { id: "patchouli", check() {} },
				},
				scope,
			);
		},
	});
function parse(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error("Invalid local tool result", { cause: error });
	}
}
const f = (fixture = await historyFixture(process.argv[2], {
	tools: [...tools.tools, ...historyTools.tools],
	reply: (payload) => {
		if (!mode) return { text: "MAIN-ANSWER" };
		const results = payload.messages.filter((m) => m.role === "tool");
		if (stage === 0) {
			stage = 1;
			return { tool: "memo_search", args: { libraryId: "work", query: "unconfirmed", limit: 4 } };
		}
		if (stage === 1) {
			const result = parse(results.at(-1).content);
			assert.equal(result.status, "ok");
			const page = result.value;
			if (!page.items.length && page.cursor)
				return {
					tool: "memo_search",
					args: { libraryId: "work", query: "unconfirmed", limit: 4, cursor: page.cursor },
				};
			sourceRef = page.items.find((item) => item.ref.kind === "source").ref;
			stage = 2;
			return { tool: "memo_read", args: { ref: sourceRef, limit: 16384 } };
		}
		if (stage === 2) {
			const read = parse(results.at(-1).content);
			assert.equal(read.status, "ok");
			assert.match(read.value.text, /Tests remain unconfirmed/);
			stage = 3;
			return {
				tool: "history_annotate",
				args: {
					requestId: "research-note",
					revision: 1,
					targetId: entryId,
					text: "Read for research; test success is still unconfirmed",
					sources: [],
				},
			};
		}
		if (stage === 3) {
			assert.equal(parse(results.at(-1).content).status, "ok");
			stage = 4;
			return {
				tool: "wiki_write",
				args: {
					libraryId: "work",
					requestId: runId + ":publication",
					baseRevision: 0,
					path: "verification.md",
					title: "Verification boundary",
					markdown:
						"The candidate exists; tests remain unconfirmed. Keep observation separate from verification.",
					summary: "Source-based research note",
					sources: [sourceRef],
				},
			};
		}
		if (stage === 4) {
			assert.equal(parse(results.at(-1).content).status, "ok");
			stage = 5;
			return { tool: "research_finish", args: { runId } };
		}
		return { text: "Research completed with one library publication and a separate Book annotation." };
	},
}));
const file = join(f.root, "library.sqlite"),
	owner = { id: "owner", check() {} };
let memo;
const providers = () => ({
	history: createDynamiteSourceProvider({
		book: f.book,
		check(input) {
			if (!["owner", "patchouli"].includes(input.actorId) || input.libraryId !== "work")
				throw Error("Source denied");
			if (input.action === "share" && input.actorId !== "owner") throw Error("Share denied");
		},
	}),
});
async function assemble() {
	const mas = await createMas({ runtime: f.runtime, namespace: "history-library", maxPending: 4 });
	await mas.bootstrap([{ key: "patchouli", owner: "owner", lifetime: "persistent" }]);
	await mas.activate();
	target = (await mas.view()).members[0].ref;
	const client = mas.connect({ principal: "owner", source: null, grants: ["send", "observe", "abort"] }),
		driver = await createMasResearchDriver({ runtime: f.runtime, mas, client, target });
	research = openPatchouli({
		file,
		id: "historian-library",
		actorId: "patchouli",
		scope: [{ libraryId: "work", write: true }],
		providers: providers(),
		driver,
		authorize(id) {
			if (id !== "owner") throw Error("Denied");
		},
	});
	return research.connect(owner);
}
try {
	const entry = await f.produce();
	entryId = entry.id;
	memo = openMemo({ file, providers: providers() });
	memo.createLibrary({ id: "work", title: "Library", ownerId: "owner" });
	const manager = memo.connect(owner);
	await manager.grant({ libraryId: "work", actorId: "patchouli", role: "editor", requestId: "grant" });
	await manager.registerSource({
		libraryId: "work",
		sourceId: "history",
		requestId: "register",
		baseVersion: 0,
		provider: "history",
		address: f.book.bookId,
		version: "1",
		title: "Execution history",
		summary: "Fixed conversation history",
	});
	assert.equal(
		(await manager.list({ libraryId: "work" })).items.filter((item) => item.ref.kind === "wiki").length,
		0,
	);
	let client = await assemble();
	runId = (
		await client.request({
			requestId: "study",
			subject: "Read the Book, preserve uncertainty and publish useful knowledge only",
			refs: [{ kind: "source", libraryId: "work", sourceId: "history", version: "1" }],
		})
	).runId;
	const before = f.requests.length;
	assert.equal((await client.get(runId)).state, "queued");
	assert.equal(f.requests.length, before);
	mode = true;
	await client.setEnabled(true);
	await client.advance();
	await f.runtime.waitForIdle();
	await client.advance();
	const run = await client.get(runId);
	assert.equal(run.state, "completed");
	assert.equal(run.publications.length, 1);
	const wiki = (await manager.list({ libraryId: "work" })).items.find((item) => item.ref.kind === "wiki");
	assert.ok(wiki);
	const content = await manager.read(wiki.ref);
	assert.match(content.text, /tests remain unconfirmed/);
	assert.deepEqual(content.sources, [sourceRef]);
	assert.equal((await f.book.connect(owner).open()).revision, 1);
	assert.equal(
		(await f.book.connect(owner).annotations({ revision: 1 })).items[0].text,
		"Read for research; test success is still unconfirmed",
	);
	const requests = f.requests.length;
	research.close();
	memo.close();
	await f.reopen();
	memo = openMemo({ file, providers: providers() });
	client = await assemble();
	assert.equal((await client.get(runId)).state, "completed");
	assert.equal((await memo.connect(owner).read(wiki.ref)).text, content.text);
	assert.equal(f.requests.length, requests);
	console.log(
		JSON.stringify({
			status: "passed",
			realCompresser: true,
			realHistorian: true,
			realPatchouli: true,
			requests,
			libraryPublications: 1,
			bookRevision: 1,
			bookAnnotations: 1,
			reopenRequests: 0,
		}),
	);
} finally {
	tools.revoke();
	historyTools.revoke();
	research?.close();
	memo?.close();
	await f.close();
}
