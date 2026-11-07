import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRuntime, type RuntimeOptions } from "../src/index.ts";

if (!process.send || !process.argv[2]) throw new Error("Requires isolated test IPC and options");
process.on("message", () => {});
const options = JSON.parse(await readFile(process.argv[2], "utf8")) as RuntimeOptions;
if (!options.endpoint?.startsWith("http://127.0.0.1:") || options.apiKey !== "local-only")
	throw new Error("Requires the deterministic local fixture");
const runtime = await createRuntime(options),
	file = runtime.view().sessionFile;
const wal = await readFile(file + "-wal");
if (wal.length <= 32) throw new Error("Requires committed WAL frames");
// Actual short-read corruption during checkpoint, not a mocked close implementation.
await writeFile(file + "-wal", wal.subarray(0, 32));
const closing = runtime.close();
let error: string | null = null;
try {
	await closing;
} catch (failure) {
	error = String(failure);
}
const retry = runtime.close();
await retry.catch(() => {});
process.send({
	file,
	error,
	writerRetained: existsSync(join(dirname(file), "pakka-writer.json")),
	sameClosePromise: retry === closing,
});
