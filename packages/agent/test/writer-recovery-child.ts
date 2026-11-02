import { readFile } from "node:fs/promises";
import { createHost } from "../src/index.ts";
const options = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const host = await createHost(options);
process.send?.({ file: host.view().sessionFile, sessionId: host.view().sessionId, pid: process.pid });
process.on("message", () => {});
await new Promise(() => {});
