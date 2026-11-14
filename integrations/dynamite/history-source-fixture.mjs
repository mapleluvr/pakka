import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function deferred() {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
/** Real Runtime/SQLite with an isolated local-only endpoint; these reads must be model-free. */
export async function fixture(name) {
	const parent = process.env.PAKKA_HISTORY_EVIDENCE ?? tmpdir();
	await mkdir(parent, { recursive: true });
	const root = await mkdtemp(join(parent, "pakka-history-source-")),
		cwd = join(root, "workspace"),
		dataDir = join(root, "profile"),
		requests = [];
	await mkdir(cwd);
	await mkdir(dataDir);
	const server = createServer((request, response) => {
		requests.push(request.url);
		response.writeHead(500, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: { message: "Source reads must not call a model" } }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		root,
		cwd,
		dataDir,
		requests,
		endpoint: `http://127.0.0.1:${server.address().port}/v1`,
		async close() {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			await writeFile(join(root, "source-test.json"), JSON.stringify({ name, requests }));
			assert.equal(requests.length, 0, "Source adaptation is passive");
		},
	};
}
